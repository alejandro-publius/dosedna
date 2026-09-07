# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project does not track Semantic Versioning strictly (it's a hackathon
research prototype, not a shipped API) — see [Status](README.md#status) and
[Roadmap](README.md#roadmap).

## [Unreleased]

## [0.1.0] - 2026-09-07

Seeded from `git log`; grouped, not a 1:1 commit list (82 commits total).
Built for AI Hackathon 2026 at Berkeley (2026-06-20 → 2026-06-21), then
hardened in follow-up passes.

### Added
- Browser-side DNA parser (`src/parser.worker.js`) for 23andMe and
  AncestryDNA files, running in a Web Worker so raw file bytes never leave
  worker scope.
- Deterministic PGx engine (`src/pgx.js`): diplotype/activity-score/
  variant-count/single-SNP calling for CYP2C19, CYP2C9, VKORC1, SLCO1B1,
  TPMT, and a "Coverage limited" fixed call for CYP2D6, with a
  phenotype-if-invariant honesty rule (never silently default to Normal).
- CPIC-grounded chat agent (`4-agent-chat.html` / `index.html`) with four
  Anthropic tool-use tools, CPIC evidence-strength chips, and a tool-call
  trace.
- Hardened FastAPI proxy (`server/proxy.py`): single `/api/explain`
  endpoint discriminated by `kind`, an allowlist built from the bundled
  gene/drug data, a DNA-shape regex rejection rule, per-IP rate limiting,
  and no request-body logging.
- Cover-traffic / decoy queries: 5 synthetic Anthropic calls fired per real
  chat turn for provider-side anonymity.
- Live CPIC API integration (`api.cpicpgx.org`) with a disk-backed cache
  (`scripts/cache_cpic.py`) so the demo doesn't depend on CPIC's uptime.
- Deterministic drug-drug and phenoconversion interaction tables
  (`src/data/interactions.json`).
- Validation suites: 79 PGx engine unit tests, 33 parser tests, a 19-case
  synthetic-patient pipeline benchmark, a 7-case literature-grounded suite
  anchored to named RCTs, a PGxQA expert-review benchmark (Keat et al.,
  PSB 2025), and an internal agent regression suite.
- `MARKET_LANDSCAPE.md` (competitive positioning vs. 23andMe Health,
  Genomind, OneOme, PharmCAT, vanilla LLMs) and `DEMO.md` (judging-day
  script).
- CI (`pgx-test` + `parser-test`), MIT `LICENSE`, and a monthly Dependabot
  job for GitHub Actions.

### Changed
- Renamed the project from "Incogenome" to "DoseDNA" across source and docs.
- Repeatedly tightened privacy and evidence-strength copy to match what the
  code actually does (dropped a "local everything" overclaim; dropped a
  "DNA stays here" heading overclaim; softened the top-line privacy pitch).
- Replaced the standalone, interactive "Privacy Console" panel with an
  always-visible privacy strip + per-message decoy chip (less surface to
  break on demo day, same claim).

### Fixed (this hardening pass)
- Added a real screenshot (`docs/screenshot.png`) of the live site running
  the bundled sample DNA file, referenced near the top of the README —
  previously the repo had no images at all.
- `scripts/smoketest.sh` posted to `/api/questions` and `/api/check-meds`,
  both removed when the proxy's endpoints were collapsed to a single
  `POST /api/explain` (BUILD_SPEC §12a); it also omitted the now-required
  `kind` discriminator on every request, including the still-live
  `/api/explain` check. All three checks were broken. Fixed to target the
  current endpoint and schema.
- `server/requirements.txt` was missing an explicit `httpx` pin.
  `scripts/cache_cpic.py` imports `httpx` directly, and used to get it for
  free as a transitive dependency of `anthropic`; current `anthropic`
  releases depend on the separate `httpx2` package instead, so a fresh
  `make install` no longer provided an importable `httpx` — reproduced as
  `ModuleNotFoundError: No module named 'httpx'` on a clean install.
- README's Privacy posture section still described the removed "Privacy
  Console" ("open it, watch the counter") — corrected to describe the
  strip that actually replaced it, and disclosed the decoy round-count
  timing tell that was mentioned in a proxy.py comment but not actually
  written down anywhere.
- Added `tests/privacy-boundary.test.mjs` (20 cases) pinning that the
  client's request-building code never places genotype-derived raw data
  (rsIDs, genotype letter-pairs, diplotypes) in an outbound network
  payload — see the PR description for what was and wasn't found.
- Added `tests/diplotype-known-answers.test.mjs` (40 cases): direct
  phenotype-level heterozygous/homozygous/uncallable coverage for VKORC1
  and SLCO1B1 (previously only indirect, via drug-flag colors), a single
  phasing-unambiguous TPMT heterozygous case, two more CYP2C19 star-allele
  combinations, and explicit present-but-uncallable-genotype cases across
  every calling method.
- CI now also runs the privacy-boundary suite, the new known-answer suite,
  and the patient-pipeline benchmark (verified offline and free — no proxy
  or API key needed — but not previously wired into CI).
