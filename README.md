# DoseDNA

> **Ask your genome a straight question.** A chat agent grounded in CPIC
> guidelines that answers in plain language — and your DNA never leaves
> your laptop.

DoseDNA is a privacy-first pharmacogenomics web app. Drop in a 23andMe or
AncestryDNA file, ask the agent how your DNA affects a medication, and watch
in real time that nothing DNA-shaped ever leaves your device.

The conversation is on top. Underneath, it's a deterministic engine that calls
your phenotypes from CPIC tables and looks up the actual CPIC clinical
recommendation before the agent says a word.

## Status

Built for [AI Hackathon 2026 at Berkeley](https://hackberkeley.org), beginner
track. Judging Sunday 1–3pm.

## What's built

### Chat agent (`4-agent-chat.html`)
The landing page is the demo. Load a DNA file, ask a question in natural
English, and the agent answers using four tools — each call shown inline.

### Deterministic PGx engine (`src/pgx.js`)
- 6 genes called locally in the browser: CYP2C19, CYP2C9, VKORC1, SLCO1B1,
  TPMT, CYP2D6.
- CYP2D6 is always "Coverage limited" — consumer arrays can't call its
  structural variants, and we refuse to guess.
- Phenotype-if-invariant rule (BUILD_SPEC §7): when phase or coverage is
  ambiguous, enumerate every possible assignment; only report a phenotype
  if every branch agrees. Otherwise "Not determined."
- 79/79 tests passing in `tests/pgx.test.mjs`.

### In-browser parser (`src/parser.worker.js`)
- 23andMe **and** AncestryDNA TSV formats, both auto-detected from header
  + column count.
- Runs in a Web Worker so the UI never freezes.
- File bytes stay in worker scope; only `{rsid: "AG", ...}` for the 10
  target SNPs is handed back to the page.
- 33 parser tests in `tests/parser.test.mjs`.

### Hardened proxy (`server/proxy.py`)
- **One** endpoint, `POST /api/explain`, discriminated by a `kind` field
  (`explain` | `questions` | `interactions` | `chat`).
- Holds `ANTHROPIC_API_KEY`. Browser never sees it.
- Allowlist built from `genes.json` + `drugs.json` at startup — every
  `(gene, phenotype, drug)` tuple validated before any string reaches Claude.
- Defense-in-depth: rejects any payload containing rsID-shaped strings or
  long ACGT runs.
- Per-IP rate limit, CORS locked to localhost.
- No request body logging.
- Model: `claude-haiku-4-5`.

### Four agent tools (driven by Anthropic tool-use)
1. **`get_gene_status(gene)`** — reads the user's metabolizer phenotype.
2. **`lookup_cpic_recommendation(gene, drug, phenotype)`** — fetches CPIC's
   verbatim recommendation, implications text, and evidence classification.
3. **`check_drug_interactions()`** — runs the deterministic interaction
   engine over the user's medications.
4. **`suggest_clinician_questions(focus_topic)`** — generates a takeaway
   list for the doctor visit.

### CPIC integration
- **Live**: `api.cpicpgx.org/v1/recommendation` queried in real time by the
  chat agent for the authoritative CPIC text.
- **Disk-cached**: `src/data/cpic_recommendations.json` — pre-pulled CPIC
  recommendations for all 17 bundled drugs (built by
  `scripts/cache_cpic.py`). The proxy pre-seeds its in-memory CPIC caches
  from this file at startup, so the demo works even if `api.cpicpgx.org`
  is offline.

### Deterministic interactions (`src/data/interactions.json`)
- 8 phenoconversion entries (inhibitor / inducer pairs) with FDA / CPIC /
  DPWG citations.
- 6 drug-drug interactions (clopidogrel + omeprazole, warfarin + amiodarone,
  simvastatin + clarithromycin, etc.) with FDA / CPIC citations.
- No live Claude reasoning — every clinical claim is grounded in a
  bundled, citable source.

### Privacy Console (`src/privacyConsole.js`)
- Patches every outbound-network primitive in the browser (fetch, XHR,
  beacon, WebSocket, Image, Script, Iframe, Link, EventSource,
  RTCPeerConnection, window.open, form submit, Web Workers).
- Case-insensitive DNA-shape detection across URL, body, base64-decoded
  payloads, and a rolling buffer (catches chunked leaks).
- Collapsed by default behind a single pill — "● See where my data goes."
- Click to expand the technical monitor.

### Bundled data
- `src/data/genes.json` — variants, function tables, diplotype rules.
- `src/data/drugs.json` — 17 drugs × phenotypes with CPIC-derived guidance.
- `src/data/interactions.json` — phenoconversion + drug-drug pairs.
- `src/data/cpic_recommendations.json` — disk cache of CPIC API responses.
- `sample/sample_23andme.txt` — demo file for "Load sample."

## How to run

Requires Python 3.10+ and Node 18+.

```bash
make install                        # pip install proxy deps
cp server/.env.example server/.env  # paste your Anthropic key inside
```

In two terminals:

```bash
make proxy   # FastAPI on http://localhost:8001
make web     # static server on http://localhost:8000/
```

Then open **http://localhost:8000/4-agent-chat.html** — the chat agent
landing page. The classic structured form lives at
http://localhost:8000/index.html as a fallback.

Run the tests:

```bash
make test         # node tests/pgx.test.mjs — 79 cases
make parser-test  # 33 parser cases (23andMe + AncestryDNA)
```

Rebuild the CPIC cache:

```bash
server/.venv/bin/python3 scripts/cache_cpic.py
```

## Architecture

```
  Lindsay's landing page (4-agent-chat.html)
            │
            ▼
  Load DNA  →  parser.worker.js  →  src/pgx.js  →  phenotypes
  (locally in your browser — nothing uploaded)
            │
            ▼
  Type a question
            │
            ▼
  src/explain.js  →  POST /api/explain  {kind: "chat", message, phenotypes}
            │
            ▼
  server/proxy.py  →  Anthropic tool-use loop
            │
            ├──→  get_gene_status(gene)               (in-memory)
            ├──→  lookup_cpic_recommendation(...)     (CPIC API or disk cache)
            ├──→  check_drug_interactions()           (interactions.json)
            └──→  suggest_clinician_questions(...)    (Claude paraphrase)
            │
            ▼
  Reply (CPIC-cited, plain language, no doses, ends with a clinician question)
```

## Privacy guarantee

Your raw DNA never leaves this device. The Privacy Console makes that
auditable — every network call this page makes is logged in real time, and
you can read the actual payloads. We didn't claim privacy; we made it
falsifiable.

## Not medical advice

Informational only. Confirm any medication decision with a clinician or
pharmacist. CYP2D6 is marked "coverage limited" because consumer DNA arrays
can't reliably call its structural variants — we'd rather show nothing than
show a wrong status.

## Contributing

Built by Alex ([@alejandro-publius](https://github.com/alejandro-publius)),
Lindsay ([@lindsayy-l](https://github.com/lindsayy-l)), and
Varsha ([@varsha106-pixel](https://github.com/varsha106-pixel)) at
AI Hackathon 2026 (Berkeley).

The deterministic spine (`src/pgx.js`, `src/data/*.json`, `tests/pgx.test.mjs`)
is the highest-bar part of the codebase — changes there should keep
`make test` green.

## License

TBD.
