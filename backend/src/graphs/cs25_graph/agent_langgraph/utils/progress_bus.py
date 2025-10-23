# src/graphs/cs25_graph/agent_langgraph/utils/progress_bus.py

import asyncio
from typing import Awaitable, Callable, Dict, Any, Optional

# One emitter per key. Key can be just tab_id, or f"{tab_id}:{run_id}" if you want multi-run safety.
_emitters: Dict[str, Callable[[Dict[str, Any]], Awaitable[None]]] = {}
_lock = asyncio.Lock()

def _key(tab_id: str, run_scope: Optional[str] = None) -> str:
    return f"{tab_id}:{run_scope}" if run_scope else tab_id

async def register(tab_id: str, emit: Callable[[Dict[str, Any]], Awaitable[None]], run_scope: Optional[str] = None) -> None:
    """Register a per-tab (or per-run) emitter callback."""
    async with _lock:
        _emitters[_key(tab_id, run_scope)] = emit

async def unregister(tab_id: str, run_scope: Optional[str] = None) -> None:
    """Remove an emitter when its stream finishes."""
    async with _lock:
        _emitters.pop(_key(tab_id, run_scope), None)

async def emit(tab_id: str, event: Dict[str, Any], run_scope: Optional[str] = None) -> None:
    """
    Emit an event to the registered emitter for the given tab/run if present.
    This is best-effort: missing or failing emitters won't crash the node.
    """
    fn: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = _emitters.get(_key(tab_id, run_scope))
    if fn is None:
        return
    try:
        await fn(event)
    except asyncio.CancelledError:
        raise
    except Exception:
        # Swallow to avoid breaking node execution if the stream has gone away.
        # (Optional) add a logger here.
        pass