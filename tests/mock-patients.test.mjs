// Mock-patient end-to-end test — Rachel's curated ground truth + our pipeline.
//
// WHAT THIS VALIDATES THAT NOTHING ELSE DOES:
//   Rachel (our bio collaborator) authored 5 synthetic patient files with
//   intentional variants seeded into specific rsIDs. The seeded ground truth
//   is documented in sample/patients/expected/patient_0X.json — what variant
//   she put where, and at what genotype. She authored the inputs and the
//   expected outputs INDEPENDENTLY of the engine.
//
//   This test runs each patient file through the actual parser worker (the
//   same code path the browser uses) and asserts that, at each rsID Rachel
//   seeded, the parser extracts the exact genotype she intended.
//
//   This is non-circular: Rachel decided what to seed, we extract, we
//   compare. If they agree, two independently-authored claims about each
//   variant match.
//
//   It DOES NOT test the LLM agent layer (that's pgxqa.test.mjs and
//   literature-grounded.test.mjs). It tests the deterministic parsing
//   layer the agent depends on.
//
// USAGE:
//   make mock-patients
//   (no proxy required — pure deterministic, no API)

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PATIENT_DIR = join(ROOT, "sample/patients");
const EXPECTED_DIR = join(PATIENT_DIR, "expected");

// ─── Boot the parser worker in a sandbox ────────────────────────────────────
// The parser worker is meant to run inside a Web Worker, but the parse() logic
// is pure JS. We instantiate it inside a vm Context with a stubbed `self`,
// then drive it via postMessage / onmessage like the browser would.
function loadParser() {
  const src = readFileSync(join(ROOT, "src/parser.worker.js"), "utf8");
  const ctx = {
    self: {
      onmessage: null,
      postMessage: null, // will be set per-call
    },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);

  return function parseInWorker(fileText) {
    return new Promise((resolve, reject) => {
      ctx.self.postMessage = (msg) => {
        if (msg.type === "result") resolve({ genotypes: msg.genotypes, meta: msg.meta });
        else if (msg.type === "error") reject(new Error(msg.message));
      };
      ctx.self.onmessage({ data: { type: "parse", fileText } });
    });
  };
}

const parseInWorker = loadParser();

// ─── Discover patients ──────────────────────────────────────────────────────
const patientIds = readdirSync(EXPECTED_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(".json", ""))
  .sort();

if (patientIds.length === 0) {
  console.error("No expected/*.json files found.");
  process.exit(2);
}

// ─── Run ────────────────────────────────────────────────────────────────────
console.log("Mock-patient end-to-end test — Rachel's curated ground truth");
console.log("=".repeat(72));
console.log(
  `${patientIds.length} synthetic patients · ` +
    `assertions made against Rachel's independently-authored seeding table\n`,
);

let totalAssertions = 0;
let pass = 0;
let fail = 0;
const failures = [];

for (const pid of patientIds) {
  const expected = JSON.parse(readFileSync(join(EXPECTED_DIR, `${pid}.json`), "utf8"));
  const inputPath = join(PATIENT_DIR, expected.source_file);

  let fileText;
  try {
    fileText = readFileSync(inputPath, "utf8");
  } catch (e) {
    console.log(`✗ ${pid}: source file ${expected.source_file} missing — ${e.message}`);
    fail++;
    failures.push({ pid, reason: "source file missing" });
    continue;
  }

  const targetCount = Object.keys(expected.seeded_targets).length;
  console.log(`${pid}  (${targetCount} seeded target${targetCount === 1 ? "" : "s"})`);

  let result;
  try {
    result = await parseInWorker(fileText);
  } catch (e) {
    console.log(`  ✗ parser threw — ${e.message}`);
    fail += targetCount;
    failures.push({ pid, reason: `parser threw: ${e.message}` });
    continue;
  }

  console.log(
    `  parser meta: provider=${result.meta.provider}, ` +
      `matched=${result.meta.matched_count}, no_call=${result.meta.no_call_count}`,
  );

  for (const [rsid, info] of Object.entries(expected.seeded_targets)) {
    totalAssertions++;
    const actual = result.genotypes[rsid];
    const expectedGt = info.genotype;
    const label = `${info.gene} ${info.star}`;

    if (actual === expectedGt) {
      console.log(`  ✓ ${rsid} (${label}): parser extracted ${actual} — matches seeded ${expectedGt}`);
      pass++;
    } else {
      console.log(
        `  ✗ ${rsid} (${label}): expected seeded ${expectedGt}, ` +
          `parser returned ${actual ?? "(no call)"}`,
      );
      fail++;
      failures.push({ pid, rsid, label, expected: expectedGt, actual: actual ?? "(no call)" });
    }
  }
}

console.log("\n" + "=".repeat(72));
console.log(`Mock-patient end-to-end: ${pass}/${totalAssertions} passed, ${fail} failed`);

if (fail > 0) {
  console.log("\nFailures (genuine bugs OR genuine 'engine refused to call this position' — both are useful signal):");
  for (const f of failures) {
    if (f.rsid) {
      console.log(`  ${f.pid}  ${f.rsid} (${f.label}): seeded ${f.expected}, got ${f.actual}`);
    } else {
      console.log(`  ${f.pid}: ${f.reason}`);
    }
  }
  console.log(
    "\nA failing assertion here means the parser disagrees with Rachel about\n" +
      "what's in the file. Either Rachel's seeding doesn't match the literal\n" +
      "file content (most likely — synthetic file bug), or our parser has a\n" +
      "bug. Both are worth knowing.",
  );
}

process.exit(fail === 0 ? 0 : 1);
