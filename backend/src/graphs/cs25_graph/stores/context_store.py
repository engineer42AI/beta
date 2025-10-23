# backend/src/graphs/cs25_graph/stores/context_store.py

import json, os, asyncio, time
from typing import Any, Optional, Dict

try:
    import redis.asyncio as redis  # redis>=5
except Exception:
    redis = None


class ContextStore:
    """
    Keyed by tab_id. Values are arbitrary JSON blobs (selected_ids, metadata, etc.)
    """

    def __init__(self, uri: Optional[str] = None, ttl_seconds: int = 3600):
        self.ttl = ttl_seconds
        self._mem: Dict[str, tuple[float, dict]] = {}
        self._redis_uri = uri or os.getenv("REDIS_URL")
        self._r = None

    async def _get_redis(self):
        if self._redis_uri and redis and self._r is None:
            self._r = redis.from_url(self._redis_uri, decode_responses=True)
        return self._r

    async def set(self, tab_id: str, payload: Dict[str, Any]) -> None:
        r = await self._get_redis()
        data = json.dumps(payload, ensure_ascii=False)
        if r:
            await r.setex(f"ctx:{tab_id}", self.ttl, data)
            return
        # fallback memory
        self._mem[tab_id] = (time.time() + self.ttl, payload)

    async def get(self, tab_id: str) -> Optional[Dict[str, Any]]:
        r = await self._get_redis()
        if r:
            raw = await r.get(f"ctx:{tab_id}")
            return json.loads(raw) if raw else None
        # fallback memory with TTL
        exp, val = self._mem.get(tab_id, (0, None))
        if time.time() > exp:
            self._mem.pop(tab_id, None)
            return None
        return val

    async def delete(self, tab_id: str) -> None:
        r = await self._get_redis()
        if r:
            await r.delete(f"ctx:{tab_id}")
            return
        self._mem.pop(tab_id, None)