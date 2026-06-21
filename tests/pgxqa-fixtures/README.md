# PGxQA fixtures

The file `expert_review_questions.tsv` in this directory is a **verbatim copy**
of the expert-review question set from the PGxQA benchmark, vendored here so
`make pgxqa-test` can run without external dependencies.

## Upstream attribution

- **Paper:** Keat K, Venkatesh R, Huang Y, Kumar R, Tuteja S, Sangkuhl K,
  Li B, Gong L, Whirl-Carrillo M, Klein TE, Ritchie MD, Kim D.
  *"PGxQA: A Resource for Evaluating LLM Performance for Pharmacogenomic
  QA Tasks."* Pacific Symposium on Biocomputing (PSB) 2025: 229–246.
  PubMed: [39670373](https://pubmed.ncbi.nlm.nih.gov/39670373/).
- **Upstream repo:** https://github.com/KarlKeat/PGxQA
- **License:** MIT (see `UPSTREAM_LICENSE`).

## What the file contains

16 hand-crafted patient/clinician scenarios, each with one or two
expert-reviewed reference answers and a citation to the underlying CPIC,
PharmGKB, or FDA guidance. The questions span CYP2C19, CYP2C9, CYP2D6,
SLCO1B1, TPMT, HLA-B, UGT1A1, CYP3A5, G6PD, CFTR, RYR1, CACNA1S, etc.

## How the DoseDNA suite uses it

`tests/pgxqa.test.mjs` filters the question set down to the genes / drugs
that are in DoseDNA's bundled allowlist (CYP2C19, CYP2C9, VKORC1, SLCO1B1,
TPMT, CYP2D6 × the 17 bundled drugs). For each in-scope question the
script:

1. Sends the verbatim PGxQA question to the chat agent at
   `localhost:8001/api/explain` with `kind: "chat"`.
2. Prints the agent's reply alongside the expert reference answer so a
   human reader can judge faithfulness.
3. Marks "AGREES / PARTIALLY / DISAGREES" by automated keyword overlap with
   the expert answer — same coarse signal the PGxQA paper uses for its
   automated tier; not a substitute for the paper's expert-scored tier.

Out-of-scope PGxQA questions (other genes/drugs) are also run, and the
agent's behavior on those is recorded as a separate "refusal" tier — we
expect a polite refusal, since our allowlist authored those tuples.
