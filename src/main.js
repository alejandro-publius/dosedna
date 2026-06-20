// Glue layer: wires UI -> parser worker -> pgx logic -> explain proxy.
//
// Contract this file expects from index.html (Varsha owns the markup):
//   #dna-file-input   <input type="file">
//   #file-status      element where parse status text goes
//   #results          container where per-gene result cards render
//   #privacy-badge    on-device privacy indicator (display only)
//
// Contract this file expects from src/pgx.js (Lindsay):
//   import { genotypesToResults } from "./pgx.js";
//   genotypesToResults(genotypeMap) -> Array<{gene, phenotype, drugs: [{drug, flag, recommendation}]}>
//
// Contract this file expects from src/parser.worker.js (Lindsay):
//   postMessage({ type: "parse", fileText: string })
//   -> postMessage({ type: "result", genotypes: { rsId: "AG", ... } })
//   -> postMessage({ type: "error", message: string })

import { fetchExplanation } from "./explain.js";

const fileInput = document.getElementById("dna-file-input");
const statusEl = document.getElementById("file-status");
const resultsEl = document.getElementById("results");

let worker = null;

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function startWorker() {
  if (worker) worker.terminate();
  worker = new Worker(new URL("./parser.worker.js", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (event) => {
    const { type } = event.data;
    if (type === "result") {
      handleParsedGenotypes(event.data.genotypes);
    } else if (type === "error") {
      setStatus(`Parse error: ${event.data.message}`);
    }
  };
}

async function handleParsedGenotypes(genotypes) {
  setStatus(`Parsed ${Object.keys(genotypes).length} target SNPs locally.`);
  const { genotypesToResults } = await import("./pgx.js");
  const results = genotypesToResults(genotypes);
  renderResults(results);
}

function renderResults(results) {
  resultsEl.innerHTML = "";
  for (const result of results) {
    const card = document.createElement("article");
    card.className = "gene-card";
    card.innerHTML = `
      <header>
        <h3>${result.gene}</h3>
        <span class="phenotype">${result.phenotype}</span>
      </header>
      <ul class="drugs"></ul>
      <button class="explain-btn">Explain with AI</button>
      <p class="explanation" hidden></p>
    `;
    const drugList = card.querySelector(".drugs");
    for (const d of result.drugs) {
      const li = document.createElement("li");
      li.className = `drug flag-${d.flag}`;
      li.textContent = `${d.drug}: ${d.recommendation}`;
      drugList.appendChild(li);
    }
    const btn = card.querySelector(".explain-btn");
    const expEl = card.querySelector(".explanation");
    btn.addEventListener("click", () => loadExplanation(result, btn, expEl));
    resultsEl.appendChild(card);
  }
}

async function loadExplanation(result, btn, expEl) {
  const first = result.drugs[0];
  if (!first) return;
  btn.disabled = true;
  btn.textContent = "Loading...";
  try {
    const text = await fetchExplanation({
      gene: result.gene,
      phenotype: result.phenotype,
      drug: first.drug,
    });
    expEl.textContent = text;
  } catch {
    expEl.textContent = first.recommendation;
  }
  expEl.hidden = false;
  btn.hidden = true;
}

function onFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  setStatus(`Reading ${file.name} locally...`);
  const reader = new FileReader();
  reader.onload = () => {
    startWorker();
    worker.postMessage({ type: "parse", fileText: reader.result });
  };
  reader.onerror = () => setStatus("Could not read file.");
  reader.readAsText(file);
}

if (fileInput) {
  fileInput.addEventListener("change", onFileChange);
}
