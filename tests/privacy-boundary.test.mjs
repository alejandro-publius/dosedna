// Privacy-boundary pin: the client never places genotype-derived raw data
// (rsIDs, genotype letter-pairs, diplotypes) in an outbound network payload.
//
// Run with: node tests/privacy-boundary.test.mjs
//
// WHY THIS FILE: the app's entire pitch is "your raw DNA never leaves your
// device." What the app actually promises (README "Privacy posture", §2;
// BUILD_SPEC §1 rule 2) is narrower and more precise than that pitch line —
// raw DNA, genotypes, rsIDs, and diplotypes never leave the browser, but a
// *derived* {gene, phenotype, drug} label deliberately does, to power the
// chat/explain/questions/interactions features, mixed with decoy queries
// for provider-side anonymity (cover traffic). That's the contract this file
// pins: not "nothing genetic ever leaves," but "nothing genotype-shaped or
// raw ever leaves — only vetted derived labels do."
//
// src/explain.js is the ONLY module in the browser bundle that calls
// fetch() with a request body (verified by `grep -rn 'fetch(' src/ *.html`
// during this audit — the other fetch() calls load static bundled JSON/text,
// they don't send anything). So it is "the request-building code" this test
// exercises directly, by mocking global fetch and inspecting exactly what
// JSON body each exported function actually sends.
//
// Two layers of assertion per call:
//   1. Exact top-level key set — matches server/proxy.py's Pydantic request
//      models for that `kind`, so an accidental extra field (e.g. someone
//      wires up `currentFileName` or a raw `genotypes` object) fails loudly
//      even if its value doesn't happen to look DNA-shaped.
//   2. A DNA-shaped-data scan across the *entire* serialized body — mirrors
//      server/proxy.py's own defense-in-depth regex (DNA_SHAPED_RE: an rsID
//      or a 20+ base ACGT run), independently reimplemented here so a
//      regression is caught on the client side too, before it ever reaches
//      the proxy's validator.

import { fetchExplanation, fetchDoctorQuestions, fetchMedInteractions, fetchChat } from "../src/explain.js";

let pass = 0;
let fail = 0;
const failures = [];

function assert(name, condition, detail = "") {
  if (condition) {
    pass++;
    process.stdout.write(`  ✓ ${name}\n`);
  } else {
    fail++;
    failures.push(`✗ ${name}${detail ? `\n    ${detail}` : ""}`);
    process.stdout.write(`  ✗ ${name}\n`);
  }
}

function section(title) {
  process.stdout.write(`\n${title}\n`);
}

// ─── DNA-shaped-data detector ────────────────────────────────────────────────
// Mirrors server/proxy.py's DNA_SHAPED_RE = r"\brs\d{3,}\b|[ACGT]{20,}", plus
// a key-name check (genotype/diplotype/rsID-shaped keys) that the server
// doesn't need — its Pydantic models already reject unknown fields — but a
// client-side test benefits from, since we're inspecting a raw JS object.
const RSID_VALUE_RE = /\brs\d{3,}\b/i;
const ACGT_RUN_RE = /[ACGT]{20,}/i;
const GENOTYPE_KEY_RE = /genotype|diplotype|^rs\d+$/i;

function collectFindings(value, path, out) {
  if (value == null) return;
  if (typeof value === "string") {
    if (RSID_VALUE_RE.test(value) || ACGT_RUN_RE.test(value)) {
      out.push({ path, value });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectFindings(v, `${path}[${i}]`, out));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (GENOTYPE_KEY_RE.test(k)) out.push({ path: `${path}.${k}`, value: `(key) ${k}` });
      collectFindings(v, `${path}.${k}`, out);
    }
  }
}

function assertNoDnaShapedData(name, body) {
  const findings = [];
  collectFindings(body, "body", findings);
  assert(
    `${name}: no rsID-shaped, ACGT-run, or genotype/diplotype-keyed data anywhere in the body`,
    findings.length === 0,
    findings.length ? `found: ${JSON.stringify(findings)}` : "",
  );
}

function assertKeys(name, body, expectedKeys) {
  const got = Object.keys(body).sort();
  const want = [...expectedKeys].sort();
  assert(
    `${name}: outbound body has exactly the expected top-level keys`,
    JSON.stringify(got) === JSON.stringify(want),
    `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`,
  );
}

// ─── Mock fetch: capture exactly what each request-builder sends ────────────
let captured = null;
function installFetchMock(responseBody = {}) {
  captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url, body: init && init.body ? JSON.parse(init.body) : null };
    return { ok: true, json: async () => responseBody };
  };
}

// ─── 1. fetchExplanation ──────────────────────────────────────────────────
section("fetchExplanation({gene, phenotype, drug, coverageState})");
{
  installFetchMock({ explanation: "x", source: "bundle" });
  await fetchExplanation({
    gene: "CYP2C19",
    phenotype: "Poor metabolizer",
    drug: "clopidogrel",
    coverageState: "confident",
  });
  assertKeys("explain", captured.body, ["kind", "gene", "phenotype", "drug", "coverage_state"]);
  assert("explain: kind is 'explain'", captured.body.kind === "explain");
  assertNoDnaShapedData("explain", captured.body);
}

// ─── 2. fetchDoctorQuestions ──────────────────────────────────────────────
section("fetchDoctorQuestions({phenotypes, medications})");
{
  installFetchMock({ questions: [] });
  await fetchDoctorQuestions({
    phenotypes: [
      { gene: "CYP2C19", phenotype: "Poor metabolizer" },
      { gene: "SLCO1B1", phenotype: "Decreased function" },
    ],
    medications: ["clopidogrel", "omeprazole"],
  });
  assertKeys("questions", captured.body, ["kind", "phenotypes", "medications"]);
  assert("questions: kind is 'questions'", captured.body.kind === "questions");
  assert(
    "questions: each phenotype entry is exactly {gene, phenotype}",
    captured.body.phenotypes.every(
      (p) => JSON.stringify(Object.keys(p).sort()) === JSON.stringify(["gene", "phenotype"]),
    ),
  );
  assertNoDnaShapedData("questions", captured.body);
}

// ─── 3. fetchMedInteractions ──────────────────────────────────────────────
section("fetchMedInteractions({phenotypes, medications})");
{
  installFetchMock({ drug_gene: [], drug_drug: [], phenoconversion: [] });
  await fetchMedInteractions({
    phenotypes: [{ gene: "CYP2C9", phenotype: "Poor metabolizer" }],
    medications: ["warfarin", "amiodarone"],
  });
  assertKeys("interactions", captured.body, ["kind", "phenotypes", "medications"]);
  assert("interactions: kind is 'interactions'", captured.body.kind === "interactions");
  assertNoDnaShapedData("interactions", captured.body);
}

// ─── 4. fetchChat — the highest-traffic path (every real chat turn) ───────
section("fetchChat({message, conversation, phenotypes, medications})");
{
  installFetchMock({ reply: "x", tool_trace: [], cpic_evidence: [], decoys_sent: 5, source: "claude" });
  await fetchChat({
    message: "Is clopidogrel safe for me given my CYP2C19 status?",
    conversation: [{ role: "user", content: "hi" }],
    phenotypes: [
      { gene: "CYP2C19", phenotype: "Poor metabolizer" },
      { gene: "CYP2D6", phenotype: "Coverage limited" },
    ],
    medications: ["clopidogrel"],
  });
  assertKeys("chat", captured.body, ["kind", "message", "conversation", "phenotypes", "medications"]);
  assert("chat: kind is 'chat'", captured.body.kind === "chat");
  assert(
    "chat: each phenotype entry is exactly {gene, phenotype}",
    captured.body.phenotypes.every(
      (p) => JSON.stringify(Object.keys(p).sort()) === JSON.stringify(["gene", "phenotype"]),
    ),
  );
  assertNoDnaShapedData("chat", captured.body);
}

// ─── 5. Detector self-check ────────────────────────────────────────────────
// Proves the scanner above isn't vacuous: feed it payload shapes that SHOULD
// be flagged (a smuggled rsID-shaped field, a genotype letter-pair value,
// a raw ACGT run) and confirm it actually catches each one. Without this,
// a scanner that matched nothing would make every assertion above pass for
// the wrong reason.
section("Detector self-check (adversarial payloads the scanner must catch)");
{
  const casesThatMustBeCaught = [
    { label: "smuggled rsID-shaped key", body: { kind: "chat", phenotypes: [{ gene: "CYP2C19", phenotype: "Poor metabolizer", rs4244285: "AG" }] } },
    { label: "smuggled 'genotype' key", body: { kind: "chat", phenotypes: [{ gene: "CYP2C19", phenotype: "Poor metabolizer", genotype: "AG" }] } },
    { label: "smuggled 'diplotype' key", body: { kind: "explain", gene: "CYP2C19", diplotype: "*1/*2" } },
    { label: "rsID mentioned inside free text", body: { kind: "chat", message: "my rs4244285 result was AG, what does that mean" } },
    { label: "raw ACGT run in free text", body: { kind: "chat", message: "here is my sequence ACGTACGTACGTACGTACGTACGT" } },
  ];
  for (const { label, body } of casesThatMustBeCaught) {
    const findings = [];
    collectFindings(body, "body", findings);
    assert(`detector catches: ${label}`, findings.length > 0, `expected a finding, got none for ${JSON.stringify(body)}`);
  }

  // And a negative control: a normal, honest payload must NOT be flagged.
  const clean = { kind: "explain", gene: "CYP2C19", phenotype: "Poor metabolizer", drug: "clopidogrel" };
  const cleanFindings = [];
  collectFindings(clean, "body", cleanFindings);
  assert("detector does not false-positive on a clean payload", cleanFindings.length === 0);
}

// ─── Summary ─────────────────────────────────────────────────────────────────
process.stdout.write(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) {
  process.stdout.write("\n" + failures.join("\n") + "\n");
  process.exit(1);
}
