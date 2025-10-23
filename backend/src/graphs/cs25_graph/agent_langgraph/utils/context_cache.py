# backend/src/graphs/cs25_graph/agent_langgraph/utils/context_cache.py
import os, json, time, asyncio
from typing import Optional, Dict, Any

try:
    import redis.asyncio as aioredis
except ImportError:
    aioredis = None

REDIS_URL = os.getenv("REDIS_URL")
TTL_SECONDS = int(os.getenv("CS25_CONTEXT_TTL", "3600"))  # 1 hour default

class _MemoryCache:
    def __init__(self):
        self._d: Dict[str, tuple[float, str]] = {}
        self._lock = asyncio.Lock()

    async def set(self, key: str, value: dict, ttl: int):
        async with self._lock:
            self._d[key] = (time.time() + ttl, json.dumps(value, ensure_ascii=False))

    async def get(self, key: str) -> Optional[dict]:
        async with self._lock:
            item = self._d.get(key)
            if not item:
                return None
            exp, s = item
            if exp < time.time():
                self._d.pop(key, None)
                return None
            return json.loads(s)

    async def delete(self, key: str):
        async with self._lock:
            self._d.pop(key, None)

class ContextCache:
    def __init__(self):
        self._mem = _MemoryCache()
        self._redis = None

    async def _ensure_redis(self):
        if REDIS_URL and aioredis and self._redis is None:
            self._redis = aioredis.from_url(REDIS_URL, decode_responses=True)
        return self._redis

    async def upsert(self, tab_id: str, payload: dict):
        r = await self._ensure_redis()
        key = f"cs25:ctx:{tab_id}"
        s = json.dumps(payload, ensure_ascii=False)
        if r:
            await r.set(key, s, ex=TTL_SECONDS)
        else:
            await self._mem.set(key, payload, TTL_SECONDS)

    async def fetch(self, tab_id: str) -> Optional[dict]:
        r = await self._ensure_redis()
        key = f"cs25:ctx:{tab_id}"
        if r:
            s = await r.get(key)
            return json.loads(s) if s else None
        return await self._mem.get(key)

    async def clear(self, tab_id: str):
        r = await self._ensure_redis()
        key = f"cs25:ctx:{tab_id}"
        if r:
            await r.delete(key)
        else:
            await self._mem.delete(key)

context_cache = ContextCache()