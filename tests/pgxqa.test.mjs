// Run the DoseDNA chat agent against the actual PGxQA expert-reviewed
// question set (Keat et al., PSB 2025; github.com/KarlKeat/PGxQA, MIT).
//
// Each PGxQA question carries one or two expert-written reference answers.
// We send each in-scope question to the agent, then compute a coarse
// keyword-overlap signal against the expert reference. This is the same
// automated-tier pattern the PGxQA paper uses (a complement to, not a
// replacement for, their expert-scored tier). Out-of-scope questions are
// run separately and we record whether the agent refuses politely.
//
// HONESTY NOTE: keyword overlap is a coarse signal. A high overlap means
// the agent surfaced the same vocabulary as the expert — not that it
// reasoned the same way. The full PGxQA paper has clinicians read every
// reply by hand. We don't have that. Treat the score as "the agent
// produced text that reads in the same shape as the expert reference."

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TSV = join(ROOT, "tests/pgxqa-fixtures/expert_review_questions.tsv");
const PROXY = "http://localhost:8001";
const TIMEOUT_MS = 90_000;

// Allowlist mirrors src/data/drugs.json (lowercased)
const SUPPORTED_GENES = new Set([
  "CYP2C19", "CYP2C9", "VKORC1", "SLCO1B1", "TPMT", "CYP2D6",
]);
const SUPPORTED_DRUGS = new Set([
  "atorvastatin", "azathioprine", "citalopram", "clopidogrel", "codeine",
  "escitalopram", "ibuprofen", "mercaptopurine", "omeprazole", "phenytoin",
  "rosuvastatin", "simvastatin", "tamoxifen", "thioguanine", "tramadol",
  "voriconazole", "warfarin",
]);

// --- Parse the TSV --------------------------------------------------------
const lines = readFileSync(TSV, "utf8").split(/\r?\n/);
const header = lines.shift().split("\t");
const colIdx = {
  question: header.indexOf("question"),
  answer_1: header.indexOf("answer_1"),
  source: header.indexOf("question_source"),
  url: header.indexOf("url_to_guideline"),
};
const records = lines.filter(Boolean).map((row) => {
  const cols = row.split("\t");
  return {
    question: cols[colIdx.question] ?? "",
    expert: cols[colIdx.answer_1] ?? "",
    source: cols[colIdx.source] ?? "",
    url: cols[colIdx.url] ?? "",
  };
}).filter((r) => r.question);

function inScope(record) {
  const text = (record.question + " " + record.expert).toLowerCase();
  const geneHit = [...SUPPORTED_GENES].some((g) => text.includes(g.toLowerCase()));
  const drugHit = [...SUPPORTED_DRUGS].some((d) => text.includes(d));
  return geneHit && drugHit;
}

const inScopeQuestions = records.filter(inScope);
const outOfScopeQuestions = records.filter((r) => !inScope(r));

// --- Extract phenotype context from the question text --------------------
// The PGxQA questions embed the phenotype inline ("patient is a CYP2C19
// poor metabolizer"). Our agent has a get_gene_status tool that reads
// from a passed-in phenotypes array. We pre-parse so the agent has the
// same context a real DoseDNA user would (post-file-load).
const PHENO_PATTERNS = [
  { rx: /(CYP2C19)[^.]*?(poor|rapid|ultrarapid|intermediate|normal)\s+metabolizer/i,
    map: { poor: "Poor metabolizer", rapid: "Rapid metabolizer", ultrarapid: "Ultrarapid metabolizer",
           intermediate: "Intermediate metabolizer", normal: "Normal metabolizer" } },
  { rx: /(CYP2C9)[^.]*?(poor|intermediate|normal)\s+metabolizer/i,
    map: { poor: "Poor metabolizer", intermediate: "Intermediate metabolizer", normal: "Normal metabolizer" } },
  { rx: /(CYP2D6)[^.]*?(poor|rapid|ultrarapid|intermediate|normal)\s+metabolizer/i,
    map: { poor: "Poor metabolizer", rapid: "Rapid metabolizer", ultrarapid: "Ultrarapid metabolizer",
           intermediate: "Intermediate metabolizer", normal: "Normal metabolizer" } },
  { rx: /(SLCO1B1)[^.]*?(poor|decreased|normal)\s+function/i,
    map: { poor: "Poor function", decreased: "Decreased function", normal: "Normal function" } },
  { rx: /(VKORC1)[^.]*?(normal|increased|high)\s+sensitivity/i,
    map: { normal: "Normal sensitivity", increased: "Increased sensitivity", high: "High sensitivity" } },
  { rx: /(TPMT)[^.]*?(normal|intermediate|deficient)\s+activity/i,
    map: { normal: "Normal activity", intermediate: "Intermediate activity", deficient: "Deficient activity" } },
];

function extractPhenotypes(question) {
  const out = [];
  for (const p of PHENO_PATTERNS) {
    const m = question.match(p.rx);
    if (!m) continue;
    const gene = m[1].toUpperCase();
    const key = m[2].toLowerCase();
    const phenotype = p.map[key];
    if (phenotype && !out.find((x) => x.gene === gene)) {
      out.push({ gene, phenotype });
    }
  }
  // CYP2D6 in our bundle is always "Coverage limited" — but if PGxQA's
  // question already specifies a CYP2D6 phenotype, honor it.
  return out;
}

// --- Coarse agreement scoring --------------------------------------------
// Strip common words, take the rest as content tokens. Compute overlap
// of agent's reply against expert's reference. Bands: >=40% AGREES,
// 20-39% PARTIAL, <20% DISAGREES. This is a stand-in for the PGxQA
// paper's automated tier; their full grading uses expert reviewers.
const STOP = new Set([
  "the","a","an","and","or","but","is","are","be","been","being","with","for","of","to","in","on","at",
  "this","that","these","those","it","its","their","they","them","there","here","as","by","from","into",
  "over","under","about","also","not","no","can","could","would","should","may","might","will","would",
  "patient","patient's","when","if","what","which","how","why","who","whom","whose","based","please",
  "do","does","did","done","have","has","had","i","you","your","my","we","our","us","one","two","three",
  "any","all","some","more","most","less","other","only","just","up","down","out","in","very","much",
  "see","know","get","got","let","let's","like","still","yet","ever","once","much","such","than","also",
  "ask","clinician","pharmacist","doctor","clinician's","prescriber","question","standard","dose","drug",
  "medication","take","taking","make","made","try","trying","check","go","going","give","gives","given",
  "way","ways","time","times","case","cases","today","note","noted","mentioned","said","told","tell",
  "first","second","third","next","last","new","old","good","bad","best","worse","worst","high","low",
  "side","effect","effects","important","need","needs","seem","seems","using","used","use","while",
  "before","after","because","since","so","therefore","then","though","although","however","also",
  "consider","considered","considering","ours","theirs","mine","yours","everyone","someone","anyone",
]);

function tokenize(s) {
  return s.toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

function overlapScore(reply, reference) {
  const refTokens = new Set(tokenize(reference));
  const replyTokens = new Set(tokenize(reply));
  if (refTokens.size === 0) return 0;
  let hits = 0;
  for (const t of refTokens) if (replyTokens.has(t)) hits++;
  return hits / refTokens.size;
}

function band(score) {
  if (score >= 0.40) return "AGREES";
  if (score >= 0.20) return "PARTIAL";
  return "DISAGREES";
}

// --- Send a chat request --------------------------------------------------
async function callChat({ message, phenotypes }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${PROXY}/api/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "chat", message, phenotypes, medications: [],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// --- Refusal heuristics for out-of-scope questions ----------------------
const REFUSAL_KEYWORDS = [
  "don't have", "not in", "haven't authored", "outside", "not covered",
  "no bundled", "unable", "no guidance", "haven't been", "isn't in",
  "can't", "cannot", "not part of", "outside of",
];
function looksLikeRefusal(reply) {
  const lc = reply.toLowerCase();
  return REFUSAL_KEYWORDS.find((k) => lc.includes(k)) ?? null;
}

// --- Main driver ---------------------------------------------------------
console.log(`PGxQA expert-review tier — ${records.length} questions total`);
console.log(`  • ${inScopeQuestions.length} in DoseDNA scope`);
console.log(`  • ${outOfScopeQuestions.length} out-of-scope (will be tested for graceful refusal)`);
console.log("=".repeat(72));

const inScopeResults = [];

for (let i = 0; i < inScopeQuestions.length; i++) {
  const q = inScopeQuestions[i];
  const phenotypes = extractPhenotypes(q.question);
  console.log(`\n[${i + 1}/${inScopeQuestions.length}] IN-SCOPE`);
  console.log(`  Q: ${q.question.slice(0, 220)}`);
  console.log(`  extracted phenotypes: ${JSON.stringify(phenotypes)}`);
  try {
    const data = await callChat({ message: q.question, phenotypes });
    const score = overlapScore(data.reply, q.expert);
    const verdict = band(score);
    const tools = (data.tool_trace || []).map((t) => t.tool).join(", ") || "(none)";
    console.log(`  agent reply: ${data.reply.slice(0, 260).replace(/\n/g, " ")}...`);
    console.log(`  expert ref:  ${q.expert.slice(0, 260).replace(/\n/g, " ")}...`);
    console.log(`  tools fired: ${tools}`);
    console.log(`  overlap = ${(score * 100).toFixed(1)}% → ${verdict}`);
    inScopeResults.push({ question: q.question, score, verdict, reply: data.reply, expert: q.expert });
  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
    inScopeResults.push({ question: q.question, error: err.message });
  }
}

const outOfScopeResults = [];
// Cap out-of-scope at 4 to keep total runtime tractable.
const outOfScopeToTest = outOfScopeQuestions.slice(0, 4);

for (let i = 0; i < outOfScopeToTest.length; i++) {
  const q = outOfScopeToTest[i];
  console.log(`\n[${i + 1}/${outOfScopeToTest.length}] OUT-OF-SCOPE (expect polite refusal)`);
  console.log(`  Q: ${q.question.slice(0, 220)}`);
  try {
    const data = await callChat({ message: q.question, phenotypes: [] });
    const refusal = looksLikeRefusal(data.reply);
    console.log(`  agent reply: ${data.reply.slice(0, 260).replace(/\n/g, " ")}...`);
    console.log(`  refusal phrase: ${refusal ?? "(none — agent did NOT refuse cleanly)"}`);
    outOfScopeResults.push({ question: q.question, refused: !!refusal, refusalPhrase: refusal, reply: data.reply });
  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
    outOfScopeResults.push({ question: q.question, error: err.message });
  }
}

// --- Summary -------------------------------------------------------------
console.log("\n" + "=".repeat(72));
console.log("SUMMARY");
console.log("=".repeat(72));
const agreed = inScopeResults.filter((r) => r.verdict === "AGREES").length;
const partial = inScopeResults.filter((r) => r.verdict === "PARTIAL").length;
const disagreed = inScopeResults.filter((r) => r.verdict === "DISAGREES").length;
const errored = inScopeResults.filter((r) => r.error).length;
console.log(`In-scope (${inScopeResults.length}): AGREES=${agreed}, PARTIAL=${partial}, DISAGREES=${disagreed}, ERROR=${errored}`);

const refused = outOfScopeResults.filter((r) => r.refused).length;
const errs = outOfScopeResults.filter((r) => r.error).length;
console.log(`Out-of-scope (${outOfScopeResults.length}): refused-cleanly=${refused}, ERROR=${errs}`);

console.log("\nMethodology note: in-scope verdicts use coarse token overlap against");
console.log("the PGxQA expert reference (≥40% AGREES, 20-39% PARTIAL, <20% DISAGREES).");
console.log("This is a stand-in for the PGxQA paper's automated tier; the paper's");
console.log("expert-scored tier requires clinicians to read every reply by hand.");

process.exit(0);
