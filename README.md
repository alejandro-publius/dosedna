# Incogenome — Project Brief (for Claude Code)

## What we're building
A privacy-first pharmacogenomics web app. A user loads their consumer DNA file
(23andMe / AncestryDNA). The app reads it entirely in the browser, extracts a
small set of drug-related variants, maps them to drug-metabolism status, and
shows plain-language guidance on how specific medications may affect them. The
raw DNA never leaves the device. Only an anonymized, non-identifying question
is sent to the Claude API for a friendly explanation.

Pitch: "Before you take a new medication, see how your body will handle it,
based on your DNA, without your genome ever leaving your device."

## Core principles (do NOT violate)
1. Local-first. All DNA reading, parsing, and variant-to-result logic runs in
   the browser. The genome is never uploaded.
2. The ONLY network call carrying anything personal is an anonymized question
   to Claude: gene + phenotype + drug. No DNA, no genotype, no rsIDs, no
   identifiers.
3. The core medication guidance must work with zero network calls. The drug
   recommendations are bundled locally. Claude only adds plain-language wording
   on top, and the app must still work if that call fails.
4. Honest framing in the UI: results are informational, confirm with a
   clinician. Consumer arrays cannot reliably call CYP2D6 — mark it
   "coverage limited."

## MVP scope (build in this order)
1. Upload a DNA file, read it locally, print the parsed target SNPs.
2. Map genotypes -> star alleles -> metabolizer phenotype using bundled JSON.
3. Look up phenotype + drug -> recommendation; render results.
4. Add the Claude explanation layer via a tiny proxy.
5. Add the medications-list input + interaction flags (the novelty).
6. Polish + the "nothing leaves" demo + public repo + screenshot.

## Out of scope for MVP (do NOT build)
- Full-genome / VCF parsing. Consumer 23andMe/Ancestry TSV only.
- PharmCAT or any Java dependency. Reimplement the small star-allele logic in JS.
- Confidential-computing enclaves, QNX, hardware versions.
- Any account system or server-side storage of genetic data.

## Tech stack
- Frontend: plain HTML, CSS, JavaScript (no framework). All sensitive logic here.
- DNA parsing: in-browser JS, run in a Web Worker so the UI doesn't freeze.
- Bundled data: a JSON file of genes, variants (rsIDs), genotype->phenotype
  rules, and drug recommendations. Ships with the app, loaded once.
- AI layer: a tiny backend proxy (Python FastAPI or Node/Express) that holds the
  Anthropic API key and relays ONLY the anonymized question. Browser never holds
  the key.
- Run locally (localhost) for the demo.

## Data flow
1. User selects DNA file -> browser reads it with FileReader / file.stream().
   Selecting a file is NOT uploading it; contents stay in browser memory.
2. A Web Worker scans the file for the target rsIDs and reads the genotype at each.
3. JS maps genotypes -> diplotype (star alleles) -> metabolizer phenotype from
   the bundled JSON.
4. JS looks up phenotype + drug -> recommendation in the bundled JSON. Render
   the results UI.
5. For a chosen result, the frontend POSTs an anonymized question to the proxy;
   the proxy calls Claude; the explanation renders. On error, fall back to the
   bundled static recommendation text.

## Genes & variants for MVP (bundled data)
Build a JSON lookup covering these genes. Source of truth = CPIC guidelines.

| Gene    | Key rsIDs (allele)                                   | Key drugs |
|---------|------------------------------------------------------|-----------|
| CYP2C19 | rs4244285 (*2), rs4986893 (*3), rs12248560 (*17)     | clopidogrel, citalopram/escitalopram, PPIs, voriconazole |
| CYP2C9  | rs1799853 (*2), rs1057910 (*3)                       | warfarin (with VKORC1), NSAIDs, phenytoin |
| VKORC1  | rs9923231 (-1639 G>A)                                | warfarin |
| SLCO1B1 | rs4149056 (*5)                                       | simvastatin / statins |
| TPMT    | rs1800462 (*2), rs1800460 (*3B), rs1142345 (*3C)     | azathioprine, mercaptopurine, thioguanine |
| CYP2D6  | NOT callable from array data                         | (display "coverage limited" only) |

Example phenotype rules (Claude Code: fill the rest from CPIC):
- CYP2C19: *1/*1 = Normal; *1/*2 or *1/*3 = Intermediate; *2/*2, *2/*3, *3/*3 =
  Poor; *1/*17 = Rapid; *17/*17 = Ultrarapid.
- VKORC1 rs9923231: GG = normal sensitivity; GA = increased; AA = high
  sensitivity (lower warfarin dose).
- SLCO1B1 rs4149056: TT = normal; TC = decreased function; CC = poor function
  (simvastatin myopathy risk).

GOTCHA: 23andMe reports genotypes on a fixed strand, and some rsIDs sit on the
minus strand, so the reported alleles can be complemented relative to the
star-allele definition. Verify allele orientation per SNP when building the
lookup.

23andMe file format: tab-separated, one variant per line:
`rsid<TAB>chromosome<TAB>position<TAB>genotype` (genotype is two letters, e.g.
"AA", "AG"). Lines starting with `#` are comments/headers. Use PapaParse or a
simple line scan.

## Medications layer (the novelty — add after core works)
- A text input for the user's current medications.
- Cross-check three things: drug-gene (above), drug-drug interactions, and
  phenoconversion (a drug the user already takes that inhibits a metabolizing
  enzyme and flips their effective phenotype, e.g. a strong CYP2C19 inhibitor
  making a normal metabolizer behave as poor).
- Scope to a handful of well-documented examples; bundle a small interaction
  table. Frame output as "flags to discuss with your pharmacist," not a complete
  engine. This is where the AI does real cross-data reasoning, not paraphrase.

## Claude prompt design
- System: "You explain pharmacogenomic results in plain language for patients.
  Be clear and calm, always recommend confirming with a clinician, and do not
  invent clinical claims beyond the provided result."
- User message built from the result, e.g. "Explain in simple terms what it
  means to be a CYP2C19 poor metabolizer taking clopidogrel, and what to ask
  the doctor."
- NEVER include DNA, genotype, rsIDs, or identifiers.
- Model: a current Claude model via the API (Sonnet for quality, Haiku for
  speed/cost). Modest max_tokens. Show a loading state; on error use the bundled
  static text.

## UI (two screens — mockups already designed)
1. Results dashboard: per-gene cards showing metabolizer status on a simple
   reduced->increased scale, plus color-coded drug flags (green = standard,
   amber = caution/dose-adjust, red = avoid or won't work, gray = not
   determined). Tapping a gene filters the drugs it affects. An on-device
   privacy badge. A "Prepare questions for my doctor" button (uses Claude).
2. Chromosome map: the 23 chromosome pairs drawn to scale in gray, with the
   pharmacogenes flagged by colored dots at their real chromosome locations;
   tapping a flagged chromosome explains that gene. This is the "this is your
   genome" moment.

## Suggested file structure

```
incogenome/
  index.html              # app shell and UI
  style.css               # styling
  src/
    main.js               # wires UI to logic, handles file input
    parser.worker.js      # Web Worker: scans the DNA file for target rsIDs
    pgx.js                # genotype to phenotype to recommendation logic
    meds.js               # medications input and interaction flags
    chromosomeMap.js      # the SVG genome view
    explain.js            # calls the proxy for the plain language text
  data/
    pgx_genes.json        # genes, variants, allele functions, drug recs
    interactions.json     # drug to drug and phenoconversion examples
  server/
    proxy.py              # FastAPI proxy that holds the API key
  sample/
    sample_23andme.txt    # a test file with known genotypes
  README.md
```
