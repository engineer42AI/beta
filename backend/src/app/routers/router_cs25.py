# backend/src/app/routers/router_cs25.py
from typing import Any, Dict, Optional, AsyncGenerator
import asyncio
import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from src.graphs.cs25_graph.agent_langgraph.agent_langgraph_v2 import stream_agent_response
from fastapi.encoders import jsonable_encoder

def _line(obj: Dict[str, Any]) -> bytes:
    encoded = jsonable_encoder(obj)
    return (json.dumps(encoded, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")

router = APIRouter(prefix="/cs25/agent_langgraph")

class RunIn(BaseModel):
    tab_id: str = Field(..., description="Frontend tab/session id")
    query: str = Field(..., description="User's instruction for the agent")
    context: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional tab-scoped context (e.g., selections) to persist before run",
    )

def _line(obj: Dict[str, Any]) -> bytes:
    # compact NDJSON line
    return (json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")

@router.post("/run/stream")
async def run_agent_stream(payload: RunIn):
    async def event_stream():
        ping_interval = 20  # seconds
        last = asyncio.get_event_loop().time()
        try:
            async for chunk in stream_agent_response(
                tab_id=payload.tab_id,
                query=payload.query,
                context=payload.context,
            ):
                yield _line(chunk)
                last = asyncio.get_event_loop().time()
                await asyncio.sleep(0)  # tiny yield to flush
                # (no-op; actual flushing is handled by server transport)
                # keepalive handled below
                now = asyncio.get_event_loop().time()
                if now - last > ping_interval:
                    yield _line({"type": "ping"})
                    last = now
        except asyncio.CancelledError:
            return
        except Exception as e:
            yield _line({"type": "error", "message": str(e)})

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