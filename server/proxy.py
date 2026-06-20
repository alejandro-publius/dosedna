"""
Incogenome explanation + reasoning proxy.

Holds the Anthropic API key. Browser calls into here. The proxy NEVER sees
DNA, rsIDs, or any identifier. Only sees {gene, phenotype, drug, meds[]}.

Run:
    cd server
    pip install -r requirements.txt
    cp .env.example .env  # put your key in
    uvicorn proxy:app --reload --port 8001
"""

import json
import os
import re
import sys
from typing import Literal

from anthropic import Anthropic, APIError
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ValidationError, field_validator

load_dotenv()

MODEL = "claude-sonnet-4-6"

if not os.environ.get("ANTHROPIC_API_KEY"):
    sys.exit("ANTHROPIC_API_KEY not set. Copy .env.example to .env and add a key.")

SENTRY_DSN = os.environ.get("SENTRY_DSN")
if SENTRY_DSN:
    import sentry_sdk

    sentry_sdk.init(dsn=SENTRY_DSN, traces_sample_rate=1.0)

EXPLAIN_SYSTEM = (
    "You explain pharmacogenomic results in plain language for patients. "
    "Be clear and calm, always recommend confirming with a clinician, and do not "
    "invent clinical claims beyond the provided result. Keep responses under "
    "120 words. Do not use medical jargon without immediately defining it. "
    "End every response with one concrete question the patient could ask "
    "their doctor or pharmacist."
)

QUESTIONS_SYSTEM = (
    "You generate a short bulleted list of questions a patient could bring to "
    "their doctor or pharmacist, based on a summary of their pharmacogenomic "
    "results and current medications. Questions should be specific, actionable, "
    "and answerable in a clinical visit. Output 4-6 bullets, nothing else. "
    "Do not give medical advice or make clinical claims."
)

INTERACTIONS_SYSTEM = (
    "You analyze potential pharmacogenomic interactions for a patient. "
    "You are given: their metabolizer phenotypes for a handful of pharmacogenes "
    "and a list of medications they currently take. "
    "Flag three categories: "
    "(1) DRUG-GENE conflicts where a current med is affected by a phenotype; "
    "(2) DRUG-DRUG interactions between current meds that are well-documented; "
    "(3) PHENOCONVERSION where one of the meds inhibits or induces a metabolizing "
    "enzyme, effectively changing the patient's phenotype for other drugs they take "
    "(e.g. a strong CYP2C19 inhibitor making a normal metabolizer behave as poor). "
    "Format output as JSON with keys: drug_gene, drug_drug, phenoconversion. "
    "Each value is an array of {flag, severity, explanation, ask_clinician}. "
    "severity is one of: info, caution, avoid. "
    "Be conservative. Only flag things with documented evidence. If nothing to "
    "flag in a category, return an empty array for it. Output ONLY the JSON object "
    "with no surrounding text or markdown fences. If you cannot answer, return "
    '{"drug_gene":[], "drug_drug":[], "phenoconversion":[]}.'
)

app = FastAPI(title="Incogenome proxy")

# Any localhost / 127.0.0.1 origin works. Any external origin is blocked.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


class ExplainRequest(BaseModel):
    gene: str = Field(..., max_length=20)
    phenotype: str = Field(..., max_length=40)
    drug: str = Field(..., max_length=60)


class ExplainResponse(BaseModel):
    explanation: str
    source: Literal["claude", "fallback"]


class PhenotypeSummary(BaseModel):
    gene: str = Field(..., max_length=20)
    phenotype: str = Field(..., max_length=40)


class QuestionsRequest(BaseModel):
    phenotypes: list[PhenotypeSummary] = Field(..., max_length=20)
    medications: list[str] = Field(default_factory=list, max_length=30)


class QuestionsResponse(BaseModel):
    questions: list[str]


class InteractionsRequest(BaseModel):
    phenotypes: list[PhenotypeSummary] = Field(..., max_length=20)
    medications: list[str] = Field(..., min_length=1, max_length=30)


SEVERITY_MAP = {
    "warning": "caution",
    "warn": "caution",
    "moderate": "caution",
    "high": "avoid",
    "severe": "avoid",
    "low": "info",
    "minor": "info",
}


class Flag(BaseModel):
    flag: str
    severity: Literal["info", "caution", "avoid"]
    explanation: str
    ask_clinician: str = ""

    @field_validator("severity", mode="before")
    @classmethod
    def coerce_severity(cls, v):
        if not isinstance(v, str):
            return "caution"
        v = v.lower().strip()
        if v in {"info", "caution", "avoid"}:
            return v
        return SEVERITY_MAP.get(v, "caution")


class InteractionsResponse(BaseModel):
    drug_gene: list[Flag] = Field(default_factory=list)
    drug_drug: list[Flag] = Field(default_factory=list)
    phenoconversion: list[Flag] = Field(default_factory=list)


JSON_FENCE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)
JSON_OBJECT = re.compile(r"\{[\s\S]*\}")


def _extract_json(text: str) -> str | None:
    fence = JSON_FENCE.search(text)
    if fence:
        return fence.group(1)
    brace = JSON_OBJECT.search(text)
    return brace.group(0) if brace else None


def _call_claude(system_text: str, user_message: str, max_tokens: int = 500) -> str:
    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=max_tokens,
            system=system_text,
            messages=[{"role": "user", "content": user_message}],
        )
    except APIError as exc:
        raise HTTPException(status_code=503, detail="upstream model error") from exc
    return "".join(b.text for b in response.content if b.type == "text").strip()


@app.get("/")
def health() -> dict:
    return {"ok": True, "model": MODEL}


@app.post("/api/explain", response_model=ExplainResponse)
def explain(req: ExplainRequest) -> ExplainResponse:
    user_message = (
        f"Explain in simple terms what it means to be a {req.gene} "
        f"{req.phenotype} taking {req.drug}, and what to ask the doctor."
    )
    text = _call_claude(EXPLAIN_SYSTEM, user_message)
    return ExplainResponse(explanation=text, source="claude")


@app.post("/api/questions", response_model=QuestionsResponse)
def questions(req: QuestionsRequest) -> QuestionsResponse:
    pheno_lines = "\n".join(f"- {p.gene}: {p.phenotype}" for p in req.phenotypes)
    meds = ", ".join(req.medications) if req.medications else "(none provided)"
    user_message = (
        "Pharmacogenomic phenotypes:\n"
        f"{pheno_lines}\n\n"
        f"Current medications: {meds}\n\n"
        "Generate 4-6 specific questions this patient should bring to their "
        "doctor or pharmacist. Format as bullet points."
    )
    text = _call_claude(QUESTIONS_SYSTEM, user_message, max_tokens=500)
    bullets = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped[0] in "-*•":
            bullets.append(stripped.lstrip("-*• ").strip())
        elif re.match(r"^\d+[.)]\s+", stripped):
            bullets.append(re.sub(r"^\d+[.)]\s+", "", stripped))
    if not bullets:
        # Last resort: split on sentence-ish boundaries.
        bullets = [s.strip() for s in re.split(r"(?<=[.?])\s+", text) if s.strip()]
    return QuestionsResponse(questions=bullets[:6])


@app.post("/api/check-meds", response_model=InteractionsResponse)
def check_meds(req: InteractionsRequest) -> InteractionsResponse:
    pheno_lines = "\n".join(f"- {p.gene}: {p.phenotype}" for p in req.phenotypes)
    user_message = (
        "Pharmacogenomic phenotypes:\n"
        f"{pheno_lines}\n\n"
        f"Current medications: {', '.join(req.medications)}\n\n"
        "Return the JSON object as specified."
    )
    text = _call_claude(INTERACTIONS_SYSTEM, user_message, max_tokens=2000)
    extracted = _extract_json(text)
    if not extracted:
        # Refusal or unparseable — return empty result; client renders "no flags".
        return InteractionsResponse()
    try:
        return InteractionsResponse(**json.loads(extracted))
    except (ValueError, ValidationError):
        return InteractionsResponse()
