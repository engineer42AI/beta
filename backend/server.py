import os
import logging
import traceback

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

from backend.src.app.routers import InlineWorkflowAgent, InlineInputs

# -------- Logging --------
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("e42-agents")

app = FastAPI(title="Engineer42 Agents")

# Keep agent config inside the agent file (model/temperature/env)
inline = InlineWorkflowAgent()

class InlineRequest(BaseModel):
    task: str                     # "guidance" | "smart" | "assumptions" | "lint"
    section_title: str
    section_markdown: str
    tdp_markdown: Optional[str] = None

@app.get("/healthz")
async def healthz():
    return {"ok": True}

@app.post("/tdp/inline")
async def tdp_inline(req: InlineRequest, request: Request):
    try:
        # Helpful server-side diagnostics (will not expose secret content to the client)
        log.info("Inline task=%s | section_title=%s | section_len=%d | doc_len=%d",
                 req.task,
                 req.section_title,
                 len(req.section_markdown or ""),
                 len(req.tdp_markdown or ""))

        result = await inline.run(
            req.task,
            InlineInputs(
                section_title=req.section_title,
                section_markdown=req.section_markdown,
                tdp_markdown=req.tdp_markdown,
            ),
        )

        # Agent may return {"error": "..."} by contract
        if isinstance(result, dict) and result.get("error"):
            log.warning("Agent returned error: %s", result["error"])
            return JSONResponse({"error": result["error"]}, status_code=400)

        return JSONResponse(result, status_code=200)

    except Exception as e:
        # Print full traceback to the server console (super useful)
        log.error("Unhandled exception in /tdp/inline: %s", e)
        traceback.print_exc()

        # Return a JSON error (client will see this string)
        return JSONResponse({"error": str(e)}, status_code=500)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
