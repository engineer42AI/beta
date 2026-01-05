# backend/src/app/routers/agents.py
import importlib, json, sys
from typing import Any, AsyncGenerator, Dict, Optional, Tuple, List
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field
from fastapi.encoders import jsonable_encoder

router = APIRouter(prefix="/agents", tags=["agents"])

# Module-level cache (server-side)
_OUTLINE_CACHE: dict[tuple[str, str], bytes] = {}
# If outline never changes unless you rebuild, just bump this manually when you regenerate
OUTLINE_VERSION = "cs25-outline-v1"   # fallback only

def _get_outline_version(mod, fallback: str) -> str:
    """
    Prefer a dynamic corpus version exposed by the agent module.
    Fallback to the manual OUTLINE_VERSION if not available.
    """
    version_fn = getattr(mod, "get_corpus_version", None)
    if callable(version_fn):
        try:
            v = version_fn()
            if v:
                return str(v)
        except Exception:
            pass
    return fallback


def _compact_json_bytes(data) -> bytes:
    return json.dumps(
        jsonable_encoder(data),
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")

# ---------- request payload (matches your real call) ----------
class CS25Payload(BaseModel):
    query: str = Field(..., description="User query for CS-25 relevance")
    model: str = "gpt-5-nano"
    batch_size: int = 5
    # Important: don't cap by default; the UI will send null/None anyway
    limit: Optional[int] = None
    pricing_per_million: Tuple[float, float] = (0.05, 0.40)
    # NEW: the traces the user chose
    selected_trace_ids: Optional[List[str]] = None

def _json_dumps(x):  # compact JSON for NDJSON lines
    return json.dumps(x, ensure_ascii=False, separators=(",", ":"))

# map nice URL names to real module names
ALIASES = {
    "cs25": "cs25_graph",
}

def load_agent_module(name: str):
    """
    Load the known agent module for a given alias, without searching.
    """
    resolved = ALIASES.get(name, name)
    module_path = f"src.graphs.{resolved}.agent"  # ✅ single explicit target

    try:
        return importlib.import_module(module_path)
    except ModuleNotFoundError as e:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "Agent module not found",
                "name": name,
                "resolved": resolved,
                "expected_module": module_path,
                "hint": "Check that agent.py exists and that all __init__.py files are present.",
                "sys_path_head": sys.path[:5],
            },
        ) from e

# -------- non-stream (returns final report dict) --------
@router.post("/{name}/run")
async def run_agent(name: str, payload: CS25Payload):
    mod = load_agent_module(name)
    fn = getattr(mod, "run_once", None)
    if not callable(fn):
        raise HTTPException(status_code=404, detail=f"Agent '{name}' missing run_once()")
    try:
        result = await fn(**payload.model_dump())  # includes selected_trace_ids now
        return JSONResponse(result, status_code=200)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# -------- stream NDJSON (newline-delimited JSON objects) --------
@router.post("/{name}/stream")
async def stream_agent(name: str, payload: CS25Payload):
    mod = load_agent_module(name)
    fn = getattr(mod, "stream", None)
    if not callable(fn):
        raise HTTPException(status_code=404, detail=f"Agent '{name}' missing stream()")

    async def gen() -> AsyncGenerator[bytes, None]:
        try:
            async for evt in fn(**payload.model_dump()):  # forwards selected_trace_ids
                yield (_json_dumps(evt) + "\n").encode("utf-8")
        except Exception as e:
            yield (_json_dumps({"type":"error","error":str(e)}) + "\n").encode("utf-8")

    return StreamingResponse(gen(), media_type="application/json")

@router.get("/{name}/outline")
async def agent_outline(name: str, request: Request):
    mod = load_agent_module(name)
    fn = getattr(mod, "get_outline", None)
    if not callable(fn):
        raise HTTPException(status_code=404, detail=f"Agent '{name}' missing get_outline()")

    # ✅ dynamic version (changes when you rebuild corpus)
    version = _get_outline_version(mod, OUTLINE_VERSION)

    # ✅ ETag should include name + version
    safe_version = version.replace("sha256:", "sha256-").replace(":", "-")
    etag = f'"{name}-{safe_version}"'

    # If client already has it, short-circuit
    if request.headers.get("if-none-match") == etag:
        resp = Response(status_code=304)
        resp.headers["ETag"] = etag
        # ✅ don’t use immutable; allow periodic revalidation
        resp.headers["Cache-Control"] = "public, max-age=0, must-revalidate"
        resp.headers["Vary"] = "Accept-Encoding"
        return resp

    # ✅ server-side cached bytes keyed by (name, version)
    cache_key = (name, version)
    body = _OUTLINE_CACHE.get(cache_key)
    if body is None:
        data = await fn()
        body = _compact_json_bytes(data)
        _OUTLINE_CACHE[cache_key] = body

    resp = Response(content=body, media_type="application/json")
    resp.headers["ETag"] = etag
    resp.headers["Cache-Control"] = "public, max-age=0, must-revalidate"
    resp.headers["Vary"] = "Accept-Encoding"
    return resp
