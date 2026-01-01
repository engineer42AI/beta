# backend/src/app/routers/router_cs25_needs_panel.py


from typing import Any, Dict, Optional, AsyncGenerator
import asyncio
import json
import time

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field

# ✅ NO crossover to agent_langgraph_v2
from src.graphs.cs25_graph.agent_langgraph.needs_panel_langgraph_v1 import (
    stream_needs_panel_scan_response,
    get_store,  # comes from needs_panel_langgraph_v1 runtime
)

router = APIRouter(prefix="/cs25/needs_panel")


# ----------------------- NDJSON helpers -----------------------

def _line(obj: Dict[str, Any]) -> bytes:
    encoded = jsonable_encoder(obj)
    return (json.dumps(encoded, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def _envelope(
    *,
    type_: str,
    tab_id: str,
    payload: Any = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "type": type_,
        "tab_id": tab_id,
        "payload": payload if payload is not None else {},
        "metadata": metadata or {},
    }


# ----------------------- Models -----------------------

class NeedsPanelIn(BaseModel):
    tab_id: str = Field(..., description="Frontend tab/session id")
    payload: Dict[str, Any] = Field(default_factory=dict, description="Opaque business payload (query, UI state, overrides)")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Opaque metadata (runId, pageId, version, etc.)")


# ----------------------- Streaming endpoint -----------------------

@router.post("/run/stream")
async def needs_panel_run_stream(req: NeedsPanelIn):
    """
    Streams NDJSON envelopes:
      { type, tab_id, payload, metadata }

    Expectations:
    - query: req.payload["query"] (string)
    - optional node overrides: req.payload["node_kwargs"] (dict) -> forwarded to graph via config["configurable"]
    """

    async def event_stream() -> AsyncGenerator[bytes, None]:
        ping_interval = 20.0
        last_ping = asyncio.get_event_loop().time()

        query = str((req.payload or {}).get("query", "") or "").strip()
        node_kwargs = (req.payload or {}).get("node_kwargs")
        node_kwargs = node_kwargs if isinstance(node_kwargs, dict) else {}

        # Keep a stable metadata block for FE correlation
        meta = dict(req.metadata or {})
        meta.setdefault("sink", "needs_panel")

        # immediate paint
        yield _line(_envelope(
            type_="needsPanel.runStart",
            tab_id=req.tab_id,
            payload={
                "query_present": bool(query),
                "node_kwargs_keys": list(node_kwargs.keys()),
            },
            metadata=meta,
        ))

        try:
            # ✅ stream from needs_panel graph only
            async for evt in stream_needs_panel_scan_response(
                tab_id=req.tab_id,
                query=query,
                payload=req.payload,
                metadata=req.metadata,
                node_kwargs=node_kwargs,
            ):
                etype = str(evt.get("type") or "needsPanel.event")

                # Pass through event payload/metadata (already in your {type,payload,metadata} format)
                yield _line(_envelope(
                    type_=etype,
                    tab_id=req.tab_id,
                    payload=evt.get("payload", {}),
                    metadata=evt.get("metadata", meta),
                ))

                await asyncio.sleep(0)

                now = asyncio.get_event_loop().time()
                if now - last_ping > ping_interval:
                    yield _line(_envelope(type_="ping", tab_id=req.tab_id, payload={}, metadata=meta))
                    last_ping = now

        except asyncio.CancelledError:
            yield _line(_envelope(type_="needsPanel.aborted", tab_id=req.tab_id, payload={}, metadata=meta))
            return
        except Exception as e:
            yield _line(_envelope(
                type_="needsPanel.error",
                tab_id=req.tab_id,
                payload={"message": str(e)},
                metadata=meta,
            ))
        finally:
            yield _line(_envelope(type_="needsPanel.runEnd", tab_id=req.tab_id, payload={}, metadata=meta))

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson; charset=utf-8",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # nginx: disable proxy buffering
        },
    )


# ----------------------- Optional: persist panel draft/state -----------------------

@router.post("/state/sync")
async def needs_panel_state_sync(req: NeedsPanelIn):
    store = await get_store()

    # store canonical draft where scan_needs_panel reads it
    draft = jsonable_encoder(req.payload)  # expects items/view/clusters/strands at top-level
    draft["ts"] = time.time()
    draft["metadata"] = jsonable_encoder(req.metadata)

    await store.aput(
        ("cs25_needs_sandbox", req.tab_id),   # ✅ MATCH scan_needs_panel
        "latest",
        draft,                                # ✅ items live at draft["items"]
    )

    #item = await store.aget(("cs25_needs_sandbox", req.tab_id), "latest")
    #print(item)

    return {"ok": True, "tab_id": req.tab_id}