# src/app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os, logging, asyncio

from langgraph.store.redis.aio import AsyncRedisStore
from langgraph.checkpoint.redis.aio import AsyncRedisSaver
from langgraph.checkpoint.memory import InMemorySaver

from .routers import agents, health
from .routers.router_cs25 import router as cs25_router
from .routers.router_cs25_outline import router as cs25_outline_router
from .routers.router_cs25_needs_panel import router as cs25_needs_panel_router  # ✅ NEW

from src.graphs.cs25_graph.agent_langgraph.agent_langgraph_v2 import init_runtime as init_agent_runtime
from src.graphs.cs25_graph.agent_langgraph.needs_panel_langgraph_v1 import init_runtime as init_needs_panel_runtime

from dotenv import load_dotenv, find_dotenv

# Load .env.local if present; else .env. Do this BEFORE creating the app.
load_dotenv(find_dotenv(".env.local") or find_dotenv(".env") or find_dotenv(".env.production"))

logger = logging.getLogger("uvicorn.error")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

# tiny in-memory store for dev fallback
class _InMemoryStore:
    def __init__(self): self._ns = {}
    def _key(self, ns): return tuple(ns) if isinstance(ns, (list,tuple)) else (ns,)
    async def aput(self, namespace, key, value):
        ns = self._key(namespace); self._ns.setdefault(ns, {})[key] = value
    async def aget(self, namespace, key):
        ns = self._key(namespace); return self._ns.get(ns, {}).get(key)
    async def asearch(self, namespace, query: str, limit: int = 10):
        ns = self._key(namespace); space = self._ns.get(ns, {})
        # shape matches LangGraph examples (has .value)
        return [type("Res", (), {"key": k, "value": v}) for k, v in list(space.items())[:limit]]

async def _maybe_setup(store: AsyncRedisStore, checkpointer: AsyncRedisSaver):
    """
    Run LangGraph Redis setup once. Uses a simple Redis key guard to avoid repeats.
    """
    try:
        redis = store._redis  # underlying redis client
        guard_key = "langgraph:bootstrap_done:v1"
        already = await redis.get(guard_key)
        if already:
            return

        # LangGraph docs: first-time setup
        # store.setup() in docs is awaited (no 'a' prefix there); be liberal:
        if hasattr(store, "asetup") and callable(getattr(store, "asetup")):
            await store.asetup()  # if provided in your version
        elif hasattr(store, "setup"):
            maybe = store.setup()
            if asyncio.iscoroutine(maybe):
                await maybe

        if hasattr(checkpointer, "asetup") and callable(getattr(checkpointer, "asetup")):
            await checkpointer.asetup()
        elif hasattr(checkpointer, "setup"):
            maybe = checkpointer.setup()
            if asyncio.iscoroutine(maybe):
                await maybe

        await redis.set(guard_key, "1")
        logger.info("LangGraph Redis store/checkpointer setup completed.")
    except Exception as e:
        # Non-fatal; you can choose to re-raise in prod
        logger.warning(f"LangGraph setup skipped or failed: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        logger.info(f"Connecting to Redis at {REDIS_URL}…")
        async with AsyncRedisStore.from_conn_string(REDIS_URL) as store, \
                   AsyncRedisSaver.from_conn_string(REDIS_URL) as checkpointer:
            # one-time setup (safe to run many times thanks to guard key)
            await _maybe_setup(store, checkpointer)

            # hand live contexts to your graph module
            await init_agent_runtime(store, checkpointer)
            await init_needs_panel_runtime(store, checkpointer)
            logger.info("LangGraph initialized with Redis store/checkpointer.")
            yield
    except Exception as e:
        logger.warning(f"Redis unavailable ({e}); using in-memory store/checkpointer.")
        mem_store = _InMemoryStore()
        mem_checkpointer = InMemorySaver()
        await init_agent_runtime(mem_store, mem_checkpointer)
        await init_needs_panel_runtime(mem_store, mem_checkpointer)
        yield

app = FastAPI(title="Engineer42 Agents", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173","http://localhost:3000"],
    allow_methods=["*"], allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(agents.router, prefix="/api")
app.include_router(cs25_router,   prefix="/api")
app.include_router(cs25_outline_router, prefix="/api")
app.include_router(cs25_needs_panel_router, prefix="/api")  # ✅ NEW