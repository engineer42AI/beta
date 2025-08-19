import os, uuid
import openai
from openai import OpenAI
from pydantic import BaseModel
from typing import Optional
from dotenv import load_dotenv, find_dotenv

# Load from .env.local
load_dotenv(dotenv_path=".env.local")
# Grab the key
api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    raise RuntimeError("OPENAI_API_KEY not found in .env.local")
# Assign to client
openai.api_key = api_key

# init OpenAI
client = OpenAI()

class InlineInputs(BaseModel):
    section_title: str
    section_markdown: str
    tdp_markdown: Optional[str] = None

class InlineWorkflowAgent:
    """Inline panel agent for section guidance, SMART-ify, assumptions, and linting."""

    def __init__(self, model: str = "gpt-4o-mini"):
        self.model = model

    async def run(self, task: str, inp: InlineInputs) -> dict:
        run_id = f"inl-{uuid.uuid4().hex[:8]}"

        if task == "guidance":
            system_prompt = """You are an aerospace TDP writing assistant.
Return **BLUF-style, guidance about how to make this section better. 
Do not restate the section verbatim. Context is only for meaning, not for expansion."""

        elif task == "smart":
            system_prompt = """Rewrite the Section content into 3–6 **SMART goals** (Specific, Measurable, Achievable, Relevant, Time-bound).
- Use concise markdown bullets.
- Keep each goal 1–2 lines max.
- Focus only on the Section content; use project context only if it clarifies intent."""

        elif task == "assumptions":
            system_prompt = """Extract **only clear, implied assumptions** from the Section content.
Group as markdown headings:
### Technical
### Operational / Use-case
### Regulatory / Compliance
### Constraints & Interfaces

- Keep each bullet to one line (BLUF).
- Use project context only if it sharpens meaning, not to add noise."""

        elif task == "lint":
            system_prompt = """Lint the Section content for **clarity and completeness**."""

        else:
            return {"run_id": run_id, "error": f"Unknown task '{task}'"}

        user_content = f"""Section: {inp.section_title}
Content:
{inp.section_markdown}

Project context:
{inp.tdp_markdown or ""}

"""

        response = client.responses.create(
            model=self.model,
            input=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
        )

        # The markdown string
        markdown_out = response.output_text.strip()

        return {"run_id": run_id, "markdown": markdown_out}

class InlineWorkflowAgentTester:
    """Simple tester for InlineWorkflowAgent simulating a backend request."""

    def __init__(self):
        self.req_payload = {
            "task": "guidance",
            "section_title": "Technology Goals",
            "section_markdown": "Develop a lightweight heat exchanger for hydrogen fuel cell aircraft.",
            "tdp_markdown": "The TDP focuses on propulsion and thermal management subsystems."
        }

    async def run(self):
        inp = InlineInputs(
            section_title=self.req_payload["section_title"],
            section_markdown=self.req_payload["section_markdown"],
            tdp_markdown=self.req_payload.get("tdp_markdown"),
        )

        agent = InlineWorkflowAgent()
        result = await agent.run(self.req_payload["task"], inp)

        print("=== Simulated API Call ===")
        print("Task:", self.req_payload["task"])
        print("Run ID:", result["run_id"])
        print("Markdown:\n", result["markdown"])
        return result


# Optional: run when you execute the file directly
if __name__ == "__main__":
    import asyncio

    tester = InlineWorkflowAgentTester()
    asyncio.run(tester.run())
