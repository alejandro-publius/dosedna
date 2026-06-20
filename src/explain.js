// Anonymized explanation request. Sends ONLY {gene, phenotype, drug}.
// No DNA, no rsIDs, no identifiers ever cross the network.

const PROXY_URL = "http://localhost:8001/api/explain";

export async function fetchExplanation({ gene, phenotype, drug }) {
  const body = JSON.stringify({ gene, phenotype, drug });

  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Proxy returned ${res.status}`);
  }
  const data = await res.json();
  return data.explanation;
}
