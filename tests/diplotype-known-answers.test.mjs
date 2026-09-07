// Known-answer, table-driven tests for the deterministic phenotype-calling
// engine (src/pgx.js), pinned against the star-allele / diplotype tables the
// repo actually ships (src/data/genes.json), one gene per calling method.
//
// Run with: node tests/diplotype-known-answers.test.mjs
//
// tests/pgx.test.mjs already covers CYP2C19 (diplotype method) and CYP2C9
// (activity-score method) with dedicated het/hom edge-case tables, plus a
// TPMT phasing-ambiguity case. This file fills the gaps left after that
// audit:
//   - VKORC1 and SLCO1B1 (single_snp_function) had NO direct phenotype-level
//     assertion for the heterozygous or homozygous-alt case — only indirect
//     coverage via bundled-sample fixtures or downstream drug-flag colors.
//   - TPMT had no direct assertion for a single, phasing-UNambiguous
//     heterozygous call (one no-function variant het, the other two ref).
//   - No gene had a case for a *present-but-uncallable* genotype string
//     (e.g. a 23andMe no-call or an indel code) as distinct from the rsID
//     being entirely absent from the file. src/pgx.js's decodeGenotype()
//     returns null for both, but two different engine methods route that
//     null differently: evalSingleSnp reports coverage_state "partial" for
//     an undecodable-but-present value vs. "not-callable" for an absent
//     key; evalVariantCount does NOT make that distinction (both count as
//     "missing"). That asymmetry is real engine behavior, not a bug, and is
//     worth pinning so an incidental refactor doesn't silently unify it.
//
// Each case is a [genotype(s), expected phenotype, expected coverage_state]
// row built directly from genes.json's own ref/alt/allele fields, so a typo
// in genes.json itself (not just in evalDiplotype/evalSingleSnp/
// evalVariantCount) would also break these tests.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildEngine } from "../src/pgx.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));

const GENES = readJson("src/data/genes.json");
const DRUGS = readJson("src/data/drugs.json");
const engine = buildEngine(GENES, DRUGS);

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

function callGene(gene, genotypes) {
  return engine.genotypesToResults(genotypes).find((r) => r.gene === gene);
}

function assertCall(gene, genotypes, expectedPhenotype, expectedCoverage, label) {
  const r = callGene(gene, genotypes);
  assert(
    `${label} → phenotype "${expectedPhenotype}"`,
    r && r.phenotype === expectedPhenotype,
    r ? `got "${r.phenotype}"` : `${gene} missing from results`,
  );
  assert(
    `${label} → coverage_state "${expectedCoverage}"`,
    r && r.coverage_state === expectedCoverage,
    r ? `got "${r.coverage_state}"` : `${gene} missing from results`,
  );
}

// ─── VKORC1 (single_snp_function): rs9923231, ref G / alt A ─────────────────
// CPIC/PharmGKB dose-sensitivity calls straight off genotype, no star alleles.
section("VKORC1 (rs9923231) — het, hom, and uncallable, direct phenotype");
{
  assertCall("VKORC1", { rs9923231: "GG" }, "Normal sensitivity", "confident", "VKORC1 GG (hom ref)");
  assertCall("VKORC1", { rs9923231: "GA" }, "Increased sensitivity", "confident", "VKORC1 GA (het)");
  assertCall("VKORC1", { rs9923231: "AG" }, "Increased sensitivity", "confident", "VKORC1 AG (het, reverse order)");
  assertCall("VKORC1", { rs9923231: "AA" }, "High sensitivity", "confident", "VKORC1 AA (hom alt)");
  // Position entirely absent from the file.
  assertCall("VKORC1", {}, "Not determined", "not-callable", "VKORC1 rsid absent from file");
  // Position present but the value can't be decoded against {G, A} or their
  // complements {C, T} (e.g. a 23andMe indel code) — a genuinely different
  // code path from "absent": evalSingleSnp reports "partial", not
  // "not-callable", for a present-but-garbage read.
  assertCall("VKORC1", { rs9923231: "DI" }, "Not determined", "partial", "VKORC1 present but uncallable ('DI' indel code)");
}

// ─── SLCO1B1 (single_snp_function): rs4149056, ref T / alt C ────────────────
section("SLCO1B1 (rs4149056) — het, hom, and uncallable, direct phenotype");
{
  assertCall("SLCO1B1", { rs4149056: "TT" }, "Normal function", "confident", "SLCO1B1 TT (hom ref)");
  assertCall("SLCO1B1", { rs4149056: "TC" }, "Decreased function", "confident", "SLCO1B1 TC (het)");
  assertCall("SLCO1B1", { rs4149056: "CT" }, "Decreased function", "confident", "SLCO1B1 CT (het, reverse order)");
  assertCall("SLCO1B1", { rs4149056: "CC" }, "Poor function", "confident", "SLCO1B1 CC (hom alt)");
  assertCall("SLCO1B1", {}, "Not determined", "not-callable", "SLCO1B1 rsid absent from file");
  assertCall("SLCO1B1", { rs4149056: "--" }, "Not determined", "partial", "SLCO1B1 present but uncallable ('--' no-call)");
}

// ─── TPMT (variant_count): rs1800462 (*2), rs1800460 (*3B), rs1142345 (*3C) ─
// tests/pgx.test.mjs already covers the phasing-ambiguous double-het case and
// a *2 hom-alt case built the same way as the first row below (kept here for
// a single self-contained table); the single-position het row and the
// "entirely uncallable" row are new coverage.
section("TPMT (variant_count) — single het, hom, and fully uncallable");
{
  // *2 hom-alt (rs1800462 CC), other two positions ref — no phasing question,
  // one position fully variant is enough on its own. count = 2 → Deficient.
  assertCall(
    "TPMT",
    { rs1800462: "CC", rs1800460: "GG", rs1142345: "AA" },
    "Deficient activity",
    "confident",
    "TPMT *2 hom-alt, *3B/*3C ref",
  );
  // Single het at rs1800460 (*3B) ONLY, both other positions confidently ref.
  // hetCount = 1 (< 2), so the phasing-ambiguity rule does not fire; count = 1
  // maps straight to Intermediate.
  assertCall(
    "TPMT",
    { rs1800462: "GG", rs1800460: "GA", rs1142345: "AA" },
    "Intermediate activity",
    "confident",
    "TPMT single *3B het, *2/*3C ref",
  );
  // All three ref — the "well-known" *1/*1 wild-type call.
  assertCall(
    "TPMT",
    { rs1800462: "GG", rs1800460: "GG", rs1142345: "AA" },
    "Normal activity",
    "confident",
    "TPMT *1/*1 (all three positions ref)",
  );
  // All three positions entirely absent from the file. Unlike VKORC1/SLCO1B1
  // above, evalVariantCount funnels "absent" and "present-but-undecodable"
  // into the same `missing` counter — both end up not-callable here, no
  // "partial" distinction for this method. Pin the absent-key case, and the
  // present-but-garbage case, to document that both land on not-callable.
  assertCall("TPMT", {}, "Not determined", "not-callable", "TPMT all three positions absent from file");
  assertCall(
    "TPMT",
    { rs1800462: "00", rs1800460: "00", rs1142345: "00" },
    "Not determined",
    "not-callable",
    "TPMT all three positions present but uncallable ('00' no-call)",
  );
}

// ─── CYP2C19 (diplotype): a well-known star-allele combo not in pgx.test.mjs
// pgx.test.mjs's edge-case table covers *1/*1, *2/*2, *2/*3, *1/*17, *2/*17,
// *17/*17. Add *1/*3 (the other canonical intermediate-metabolizer call,
// PharmVar/CPIC's second no-function allele on its own) and *3/*17, plus an
// entirely-uncallable case for this method.
section("CYP2C19 (diplotype) — one more well-known combo + uncallable");
{
  // *1/*3: rs4986893 (*3) het, other two positions confidently ref.
  assertCall(
    "CYP2C19",
    { rs4244285: "GG", rs4986893: "GA", rs12248560: "CC" },
    "Intermediate metabolizer",
    "confident",
    "CYP2C19 *1/*3 (rs4986893 het)",
  );
  // *3/*17: rs4986893 het (*3) and rs12248560 het (*17), rs4244285 ref.
  assertCall(
    "CYP2C19",
    { rs4244285: "GG", rs4986893: "GA", rs12248560: "CT" },
    "Intermediate metabolizer",
    "confident",
    "CYP2C19 *3/*17",
  );
  // All three positions present but garbage — genuinely uncallable, not just
  // missing data (distinct from the "silent miscall regression" cases in
  // pgx.test.mjs, which test *absent* positions).
  assertCall(
    "CYP2C19",
    { rs4244285: "NN", rs4986893: "NN", rs12248560: "NN" },
    "Not determined",
    "not-callable",
    "CYP2C19 all three positions present but uncallable ('NN')",
  );
}

// ─── Summary ─────────────────────────────────────────────────────────────────
process.stdout.write(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) {
  process.stdout.write("\n" + failures.join("\n") + "\n");
  process.exit(1);
}
