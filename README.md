# DoseDNA — Complete Build Spec (for Claude Code)

A privacy-first pharmacogenomics web app. The user loads a consumer DNA file (23andMe / AncestryDNA); the app reads it **entirely in the browser**, extracts a small set of drug-related variants, maps them to drug-metabolism status, and shows plain-language guidance on how specific medications may affect them. The raw DNA never leaves the device. Only an anonymized, non-identifying question (gene + phenotype + drug) is sent to the Claude API for a friendly explanation.

> **Pitch:** "Before you take a new medication, see how your body may handle it — based on your DNA, without your genome ever leaving your device."

**How to read this doc:** Verified facts are stated plainly with their source. `[CONFIRM AT BUILD]` marks something that must be checked against a primary download or a real file before trusting it (these are the silent-bug risks). `[DECIDE]` marks a product choice. Build in the order of Section 3.

---

## 1. Core principles (do NOT violate)

1. **Local-first.** All DNA reading, parsing, and variant→result logic runs in the browser, in a Web Worker. The genome is never uploaded. Selecting a file is not uploading it.
2. **One personal network call, anonymized.** The only outbound call carrying anything derived from the user is `gene + phenotype + drug` → Claude, for plain-language wording. **Never** send DNA, genotypes, rsIDs, diplotypes, or identifiers.
3. **Core works offline.** All medication guidance is bundled locally and rendered with zero network calls. Claude only adds wording on top; if that call fails, the app still shows the bundled static guidance.
4. **Never silently assume "normal."** When the file lacks the variants needed to determine a status, the result is **"not determined,"** never a default normal/`*1` call. This rule is the entire product. (See Section 6.)
5. **Deterministic medicine, generative language.** The variant→allele→phenotype→guidance chain is hard-coded and verifiable. Claude never computes a phenotype or invents clinical claims — it only explains the verified result. (See Section 10.)
6. **Honest framing in the UI.** Results are informational; confirm with a clinician. Consumer arrays cannot reliably call CYP2D6 — it is always shown as "coverage limited," never as a clean status.

---

## 2. Architecture & data flow

**Stack**
- Frontend: plain HTML / CSS / JavaScript, no framework. All sensitive logic lives here.
- DNA parsing: in-browser JS in a Web Worker so the UI never freezes.
- Bundled data: JSON files (genes, variants, phenotype rules, drug recommendations, interactions) shipped with the app, loaded once.
- AI layer: a tiny backend proxy (Python FastAPI or Node/Express) that holds the Anthropic API key and relays only the anonymized question. The browser never holds the key.
- Runs on localhost for the demo.

**The deterministic spine vs. Claude (make this split explicit in code):**

| Layer | Owner | Never does |
|---|---|---|
| Parse file → genotypes at target rsIDs | Worker (JS) | — |
| Genotypes → diplotype (star alleles) | `pgx.js` (deterministic) | guess/impute missing data |
| Diplotype → phenotype | bundled JSON (deterministic) | default missing to normal |
| Phenotype + drug → guidance | bundled JSON (deterministic) | — |
| Coverage state assignment | `pgx.js` (deterministic) | — |
| Plain-language explanation + doctor questions | Claude (via proxy) | compute phenotype, invent dosing |

**Data flow**
1. User selects DNA file → browser reads it with `FileReader` / `file.stream()`. Contents stay in memory.
2. Web Worker scans the file for the target rsIDs and reads the genotype at each.
3. JS maps genotypes → diplotype → phenotype using bundled JSON, and assigns a **coverage state** (Section 6).
4. JS looks up phenotype + drug → recommendation in bundled JSON; renders the results UI.
5. For a chosen result, the frontend POSTs an anonymized question to the proxy; the proxy calls Claude; the explanation renders. On error, fall back to the bundled static text.

---

## 3. MVP build order

Build a thin vertical slice on **one gene (CYP2C19)** end-to-end before scaling. That surfaces every real obstacle (strand, missing rsIDs, no-call encoding) while it's cheap.

1. Upload a DNA file, read it locally, print the parsed target SNPs for CYP2C19.
2. Map genotypes → star alleles → phenotype using bundled JSON; assign coverage state.
3. Look up phenotype + drug → recommendation; render results.
4. **Validate against a known-answer sample** (Section 13) before trusting the pipeline.
5. Scale to the rest of the gene set (Section 5).
6. Add the Claude explanation layer via the proxy.
7. Add the medications-list input + interaction/phenoconversion flags (the novelty — Section 9).
8. Polish + the "nothing leaves the device" demo + public repo + screenshots.

---

## 4. Out of scope for MVP (do NOT build)

- Full-genome / VCF parsing. Consumer 23andMe/Ancestry TSV only.
- PharmCAT or any Java dependency. Reimplement the small star-allele logic in JS.
- Statistical imputation of missing genotypes. (Absence → "not determined," not a guess.)
- Confidential-computing enclaves / hardware versions.
- Any account system or server-side storage of genetic data.

---

## 5. Genomics knowledge base (bundled JSON) — the specific part

Source of truth, by data type:
- **Star-allele → defining variant (rsID):** PharmVar (https://www.pharmvar.org/download)
- **Allele → function, diplotype → phenotype, activity scores:** CPIC (https://cpicpgx.org) and PharmGKB gene-specific tables (https://www.pharmgkb.org)
- **Genome build:** consumer files are GRCh37/build 37. PharmVar provides both builds — use the build-37 coordinates. `[CONFIRM AT BUILD]`

### 5a. Verified variant table

These rsIDs and variant alleles are verified against the literature/CPIC. The "no-function / variant allele" column is the allele that *moves* the phenotype; the other allele is reference.

| Gene | Star allele | rsID | Change | Reference → variant allele | Effect |
|---|---|---|---|---|---|
| CYP2C19 | *2 | rs4244285 | c.681G>A | G → **A** | no function (splicing defect) |
| CYP2C19 | *3 | rs4986893 | c.636G>A | G → **A** | no function (stop gain) |
| CYP2C19 | *17 | rs12248560 | c.-806C>T | C → **T** | increased function |
| CYP2C9 | *2 | rs1799853 | c.430C>T (R144C) | C → **T** | decreased function (AS 0.5) |
| CYP2C9 | *3 | rs1057910 | c.1075A>C (I359L) | A → **C** | no/▼▼ function (AS 0) |
| VKORC1 | (−1639) | rs9923231 | c.-1639G>A | G → **A** | ↑ warfarin sensitivity (lower dose) |
| SLCO1B1 | (521 C) | rs4149056 | c.521T>C (V174A) | T → **C** | decreased function |
| TPMT | *2 | rs1800462 | c.238G>C | G → **C** | no function |
| TPMT | *3B | rs1800460 | c.460G>A | G → **A** | (combines into *3A) |
| TPMT | *3C | rs1142345 | c.719A>G | A → **G** | no function; with *3B = *3A |
| CYP2D6 | — | — | structural | **not array-callable** | always "coverage limited" |

> These are coding/plus-strand changes from CPIC/PharmVar. The **strand the consumer file reports on can differ** — see 5b. Always confirm each rsID's defining allele against PharmVar's build-37 table at build time. `[CONFIRM AT BUILD]`

### 5b. Strand handling — the actual method (replaces "verify orientation per SNP")

23andMe/Ancestry report two-letter genotypes, and some rsIDs are reported on the minus strand relative to the star-allele definition, so the letters can be complemented (A↔T, C↔G). Do **not** hand-eyeball this. Implement:

1. For each rsID, store the plus-strand `ref`/`alt` alleles from **dbSNP** (build 37) alongside the PharmVar definition.
2. When reading a file genotype, accept it if its alleles are a subset of `{ref, alt}`. If not, try the **complement**; if that matches, the file is minus-strand for that SNP — record the orientation in the JSON so it's explicit, not inferred at runtime.
3. If neither matches → flag as an unparseable/no-call for that SNP (contributes to "not determined," never to "normal").
4. **Validate the whole mapping against a known-answer sample** (Section 13) before trusting any result. This catches strand mistakes that pass step 2 but still flip a call.

### 5c. Phenotype rules — verified pieces + the gotchas

Pull the full diplotype→phenotype tables from CPIC; do not hand-roll the edge cases. Verified anchors and the specific traps:

- **CYP2C19** (no-function: *2, *3; increased: *17): `*1/*1` = Normal; `*1/*17` = Rapid; `*17/*17` = Ultrarapid; `*1/*2`/`*1/*3` = Intermediate; `*2/*2`, `*2/*3`, `*3/*3` = Poor. **Gotcha:** `*2/*17` and other no-function + `*17` combinations are *not* "averaged" — use the current CPIC table verbatim (CPIC classifies `*2/*17` as Intermediate). `[CONFIRM AT BUILD]`
- **CYP2C9** uses an **activity score**: *1 = 1.0, *2 = 0.5, *3 = 0.0; sum the two alleles → Normal (2.0) / Intermediate / Poor. Don't use simple "normal/decreased/poor by genotype" labels.
- **VKORC1 rs9923231** is a warfarin **dose-sensitivity** flag, not a metabolizer phenotype: GG = normal sensitivity; GA = increased; AA = high sensitivity (lower dose). It is interpreted *together with* CYP2C9 for warfarin.
- **SLCO1B1 rs4149056** (function-based, per CPIC 2022): TT ≈ normal function, TC ≈ decreased function, CC ≈ poor function — **but** this single SNP can't distinguish `*5` from `*15` (that needs rs2306283, c.388A>G). For MVP, report it as "carries the decreased-function variant (consistent with *5/*15)," not a specific star allele. `[CONFIRM AT BUILD]`
- **TPMT phasing gotcha:** the common no-function allele `*3A` = `*3B` (rs1800460) **+** `*3C` (rs1142345) **on the same chromosome**. An unphased array can't always tell `*3A/*1` from `*3B/*3C`. The *phenotype* is often the same either way, but state the assumption explicitly and treat the ambiguous case as "consistent with TPMT deficiency, confirm clinically," not a precise diplotype.

### 5d. Bundled JSON schema (suggested)

```json
{
  "genes": {
    "CYP2C19": {
      "build": "GRCh37",
      "variants": [
        { "rsid": "rs4244285", "allele": "*2", "ref": "G", "alt": "A",
          "file_strand": "plus", "function": "no_function" }
      ],
      "diplotype_to_phenotype": { "*1/*1": "Normal", "*1/*2": "Intermediate" },
      "method": "diplotype",
      "array_callable": "partial",
      "coverage_note": "Common no-function + *17 alleles covered; rare alleles not on array."
    },
    "CYP2D6": { "array_callable": "none", "coverage_note": "Structural variants undetectable on arrays." }
  }
}
```

(For CYP2C9 add `"method": "activity_score"` and an `activity_value` per allele instead of a diplotype map.)

---

## 6. Coverage / honesty logic (the differentiator — spend the most time here)

Two halves: *what can this file see* and *what are we allowed to conclude*.

### 6a. Empirical coverage step (do this, don't assume)

Chips differ by version (23andMe v3/v4/v5, AncestryDNA versions) — the rsIDs present change. **Measure it:** intersect each gene's required rsIDs (5a) against the rsID list of a real/synthetic file for each chip version you support. That intersection *is* your coverage map; bundle it. `[CONFIRM AT BUILD]`

### 6b. The three coverage states

1. **Tested & confident** — every variant needed for a confident call is present, and no structural variant could change the answer.
2. **Partially tested** — some informative variants present, call incomplete (one allele known, second unknown; or rare alleles off-chip). Report as a directional flag, not a verdict.
3. **Not callable from this file** — the decisive variation is structural or absent (CYP2D6 always lands here). No status assigned.

### 6c. Decision rules (write as explicit logic)

- Never default a missing variant to `*1`/normal. Absence → "unknown."
- If any structural variant could change the phenotype and the file can't detect it → **Not callable**, regardless of which SNPs are present.
- If exactly one allele is determinable → **Partially tested**; surface the known allele as a flag.
- Map states to UI consequence: Confident → show guidance; Partial → guidance **+** "confirm with clinical test"; Not callable → "we can't determine this; here's why + what to ask."
- Trigger a clinical-PGx-panel recommendation whenever a Not-callable or Partial gene governs a drug the user is starting.

---

## 7. Input handling & file format

- **23andMe:** tab-separated, one variant per line: `rsid<TAB>chromosome<TAB>position<TAB>genotype` (genotype is two letters, e.g. `AA`, `AG`). Lines starting with `#` are comments/headers (the header often names the chip version — use it for coverage). `[CONFIRM AT BUILD: AncestryDNA layout differs slightly — typically alleles split across two columns; handle both.]`
- Parse with a simple line scan or PapaParse, in the Worker.
- **Edge cases to handle explicitly:** no-calls (`--`, `00`, `DD`, `II`), missing rsIDs (absent line), indels, strand complementation (5b), and chip-version detection. Each unparseable/absent target contributes to "not determined," never to "normal."
- On upload, validate it's actually a consumer DNA file (expected columns + known rsIDs present) and identify the provider/version; reject gracefully otherwise.

---

## 8. Drug guidance layer (phenotype → what to tell the user)

For each drug–gene pair: a short guidance summary (your words, not pasted) + recommendation strength + source. Priority of sources: CPIC guideline → PharmGKB clinical annotations → FDA Table of Pharmacogenomic Biomarkers / FDA Table of Pharmacogenetic Associations → DPWG where CPIC is silent.

MVP drug set (from the gene table): clopidogrel, citalopram/escitalopram, PPIs, voriconazole (CYP2C19); warfarin (CYP2C9 + VKORC1), NSAIDs, phenytoin (CYP2C9); simvastatin/statins (SLCO1B1); azathioprine, mercaptopurine, thioguanine (TPMT). `[FILL one guidance row per phenotype per drug from CPIC.]`

**Direction-of-risk matters and flips by drug type** — encode it, because the same status is opposite advice:
- *Prodrugs* (need activation): e.g. clopidogrel via CYP2C19 — poor metabolizer → drug doesn't work.
- *Active drugs* (need clearance): e.g. citalopram via CYP2C19 — poor metabolizer → builds up, toxicity risk.

Surface hard regulatory warnings prominently (e.g. the codeine/CYP2D6 ultrarapid pediatric restriction) — though codeine sits under the CYP2D6 "coverage limited" path here.

---

## 9. Medications layer (the novelty — add after core works)

A text input for the user's current medications. Cross-check three things and frame all output as "flags to discuss with your pharmacist," not a complete engine:

1. **Drug–gene** (Section 8).
2. **Drug–drug interactions** — a small bundled table of well-documented pairs.
3. **Phenoconversion** — a drug the user already takes that inhibits a metabolizing enzyme and *flips their effective phenotype*. This is where Claude does real cross-data reasoning, not paraphrase.

Concrete, defensible phenoconversion examples to bundle `[CONFIRM exact pairs against a clinical reference at build]`:
- A strong **CYP2C19 inhibitor** (e.g. fluvoxamine, fluconazole) taken alongside a CYP2C19 substrate → a genotype-normal metabolizer behaves as intermediate/poor.
- A strong **CYP2D6 inhibitor** (e.g. bupropion, paroxetine, fluoxetine) → converts a CYP2D6 normal metabolizer toward poor — relevant precisely because the *genetic* CYP2D6 status is unknown here, so a drug-induced flip is the part you *can* flag.

Keep the table to a handful of high-confidence examples. Quality and honest framing beat coverage.

---

## 10. Claude integration (the AI layer)

- **Proxy only.** FastAPI/Express holds the key; browser POSTs the anonymized question; proxy calls the Anthropic Messages API.
- **Anonymized payload — gene + phenotype + drug only.** No DNA, genotype, rsIDs, diplotype, or identifiers ever leave the device.
- **System prompt:** "You explain pharmacogenomic results in plain language for patients. Be clear and calm, always recommend confirming with a clinician, and never invent clinical claims beyond the provided result."
- **User message** built from the verified result, e.g.
