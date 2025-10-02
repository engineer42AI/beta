from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import agents

app = FastAPI(title="Engineer42 Agents")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"], allow_headers=["*"],
)

app.include_router(agents.router, prefix="/api")