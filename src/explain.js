// All proxy clients. Each function sends ONLY {gene, phenotype, drug, meds}
// shaped payloads. No DNA, no rsIDs, no identifiers ever cross the network.
// Set window.INCOGENOME_PROXY before main.js loads to point at a non-default host.

const PROXY = globalThis.INCOGENOME_PROXY ?? "http://localhost:8001";
const TIMEOUT_MS = 30000;

async function postJson(path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${PROXY}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${path} returned ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchExplanation({ gene, phenotype, drug }) {
  const data = await postJson("/api/explain", { gene, phenotype, drug });
  return data.explanation;
}

export async function fetchDoctorQuestions({ phenotypes, medications }) {
  const data = await postJson("/api/questions", {
    phenotypes,
    medications: medications ?? [],
  });
  return data.questions;
}

export async function fetchMedInteractions({ phenotypes, medications }) {
  return postJson("/api/check-meds", { phenotypes, medications });
}
