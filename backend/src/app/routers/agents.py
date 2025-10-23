# backend/src/app/routers/agents.py
import importlib, json, sys
from typing import Any, AsyncGenerator, Dict, Optional, Tuple, List
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field
from fastapi.encoders import jsonable_encoder

router = APIRouter(prefix="/agents", tags=["agents"])

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
async def agent_outline(name: str):
    mod = load_agent_module(name)
    fn = getattr(mod, "get_outline", None)
    if not callable(fn):
        raise HTTPException(status_code=404, detail=f"Agent '{name}' missing get_outline()")
    try:
        data = await fn()  # should return {"outline": ..., "indices": ...}
        return JSONResponse(content=jsonable_encoder(data), status_code=200)
    except Exception as e:
        # Return a JSON error, not HTML
        raise HTTPException(status_code=500, detail=f"outline failed: {e}")
