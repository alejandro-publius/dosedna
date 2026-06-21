import os
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# Load environment variables (kept for portfolio structure/port selection)
load_dotenv()

app = FastAPI(
    title="Incogenome Deterministic Local Proxy",
    description="Anonymized local fallback engine providing clinical explanations with zero external network calls.",
    version="1.0.0"
)

# Configure CORS for localhost development/demo
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", 
        "http://127.0.0.1:3000",
        "http://localhost:5500",  # Added for VS Code Live Server
        "http://127.0.0.1:5500",  # Added for VS Code Live Server
        "null"
    ],
    allow_credentials=True,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

# -------------------------------------------------------------------------
# Local Clinical Explanation Database (Deterministic Source of Truth)
# -------------------------------------------------------------------------
LOCAL_CLINICAL_DB = {
    "cyp2c19": {
        "poor metabolizer": {
            "clopidogrel": (
                "Your body processes this drug much slower than standard. Because **Clopidogrel** is a prodrug, "
                "it relies entirely on the CYP2C19 enzyme to activate it. With poor metabolizer status, "
                "the medication may not be fully activated, which drastically reduces its effectiveness in preventing blood clots.\n\n"
                "### Questions for Your Doctor:\n"
                "* Should we consider an alternative antiplatelet medication, such as Prasugrel or Ticagrelor, that doesn't rely as heavily on the CYP2C19 pathway?"
            ),
            "citalopram": (
                "Your body clears this medication much slower than expected. **Citalopram** is an active drug, meaning "
                "it stays active until broken down. Because your breakdown path is restricted, the drug can quickly accumulate "
                "in your bloodstream, drastically increasing your risk of adverse side effects.\n\n"
                "### Questions for Your Doctor:\n"
                "* Given my slower metabolism rate for this drug family, should we consider dropping the starting dosage?"
            )
        }
    },
    "cyp2c9": {
        "poor metabolizer": {
            "warfarin": (
                "Your system clears **Warfarin** exceptionally slowly. Because the drug stays active in your blood far longer, "
                "standard therapeutic dosages present a high risk of over-coagulation and severe internal bleeding hazards.\n\n"
                "### Questions for Your Doctor:\n"
                "* Should we adjust my initial baseline Warfarin dosage significantly downward to accommodate this pathway limitation?"
            )
        }
    }
}

# -------------------------------------------------------------------------
# Pydantic Schemas for Strict Input/Output Validation
# -------------------------------------------------------------------------
class ExplanationRequest(BaseModel):
    gene: str = Field(..., example="CYP2C19", description="The gene identifier")
    phenotype: str = Field(..., example="Poor Metabolizer", description="The deterministic phenotype outcome")
    drug: str = Field(..., example="Clopidogrel", description="The specific medication name")

    class Config:
        extra = "forbid"

class ExplanationResponse(BaseModel):
    explanation: str = Field(..., description="The plain-language markdown explanation generated locally")

# -------------------------------------------------------------------------
# Core API Endpoint
# -------------------------------------------------------------------------
@app.post(
    "/api/explain", 
    response_model=ExplanationResponse, 
    status_code=status.HTTP_200_OK
)
async def explain_pgx_result(request: ExplanationRequest):
    # Shifting execution context inside an explicit try/except safety block
    try:
        clean_gene = request.gene.strip().lower()
        clean_phenotype = request.phenotype.strip().lower()
        clean_drug = request.drug.strip().lower()
        
        disclaimer = (
            "**[IMPORTANT CLINICAL DISCLAIMER]:** This is an informational screening compiled directly from "
            "raw data file signatures. It does not replace professional medical advice. Always consult your doctor "
            "or clinical pharmacist before making any adjustments to your medication routines.\n\n---\n\n"
        )

        # 1. Look up the gene pathway first
        gene_entry = LOCAL_CLINICAL_DB.get(clean_gene)
        
        if not gene_entry:
            return ExplanationResponse(
                explanation=f"{disclaimer}### Medication Coverage Notice\n"
                f"Incogenome currently does not contain verified pharmacogenomic rules for **{request.drug.title()}**. "
                "As a result, we cannot map this medication to your genetic file signatures.\n\n"
                "*What you can do:* Speak with your pharmacist or doctor to see if targeted clinical-grade PGx testing (such as a multi-gene panel) is appropriate for your medication history."
            )

        # 2. Look up the specific drug within that pathway
        raw_text = gene_entry.get(clean_phenotype, {}).get(clean_drug)
        
        if not raw_text:
            return ExplanationResponse(
                explanation=f"{disclaimer}### Medication Not Supported\n"
                f"While we parsed markers related to the **{request.gene.upper()}** pathway, **{request.drug.title()}** is not supported in the current local rule base.\n\n"
                "No data has been generated. Please consult a licensed clinician before altering any medication routines."
            )
            
        return ExplanationResponse(explanation=f"{disclaimer}{raw_text}")

    except Exception as e:
        print(f"[Local Processing Error]: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server processing fault within the explanation builder."
        )

# -------------------------------------------------------------------------
# Execution entrypoint
# -------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("proxy:app", host="127.0.0.1", port=port, reload=True)