# backend/src/app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import agents, health
from dotenv import load_dotenv, find_dotenv
import os

# Load env vars at startup (supports .env.local if you want that naming)
load_dotenv(find_dotenv(".env.local") or find_dotenv(".env"))

app = FastAPI(title="Engineer42 Agents")

# Dev CORS only; in prod proxy /api via Nginx and you can remove this.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173","http://localhost:3000"],
    allow_methods=["*"], allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(agents.router, prefix="/api")
