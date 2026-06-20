"""
Incogenome explanation proxy.

Receives an anonymized question (gene + phenotype + drug only) from the browser,
calls Claude, returns the plain-language explanation. The browser never holds
the API key. The proxy never sees DNA, rsIDs, or anything identifying.

Run:
    cd server
    pip install -r requirements.txt
    cp .env.example .env  # then put your key in
    uvicorn proxy:app --reload --port 8001
"""

import os
from typing import Literal

from anthropic import Anthropic, APIError
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 500

SYSTEM_PROMPT = (
    "You explain pharmacogenomic results in plain language for patients. "
    "Be clear and calm, always recommend confirming with a clinician, and do not "
    "invent clinical claims beyond the provided result. Keep responses under "
    "120 words. Do not use medical jargon without immediately defining it. "
    "End every response with one concrete question the patient could ask "
    "their doctor or pharmacist."
)

app = FastAPI(title="Incogenome explanation proxy")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))


class ExplainRequest(BaseModel):
    gene: str = Field(..., max_length=20)
    phenotype: str = Field(..., max_length=40)
    drug: str = Field(..., max_length=60)


class ExplainResponse(BaseModel):
    explanation: str
    source: Literal["claude", "fallback"]


@app.get("/")
def health() -> dict:
    return {"ok": True, "model": MODEL}


@app.post("/api/explain", response_model=ExplainResponse)
def explain(req: ExplainRequest) -> ExplainResponse:
    user_message = (
        f"Explain in simple terms what it means to be a {req.gene} "
        f"{req.phenotype} taking {req.drug}, and what to ask the doctor."
    )

    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user_message}],
        )
    except APIError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    text = "".join(
        block.text for block in response.content if block.type == "text"
    ).strip()
    return ExplainResponse(explanation=text, source="claude")
