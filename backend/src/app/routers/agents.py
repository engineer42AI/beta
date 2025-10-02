from fastapi import APIRouter, HTTPException
from ..agents import registry

router = APIRouter(prefix="/agents", tags=["agents"])

@router.post("/{name}/run")
async def run_agent(name: str, payload: dict):
    agent = registry.get(name)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Unknown agent '{name}'")
    try:
        return await agent.run(payload)  # each agent implements .run(dict) -> dict
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))