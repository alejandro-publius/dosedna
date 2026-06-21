"""
Build a disk cache of CPIC recommendations for every drug in src/data/drugs.json.

Run with: python3 scripts/cache_cpic.py
Output:   src/data/cpic_recommendations.json

The proxy loads this file at startup and pre-seeds its in-memory CPIC caches
(_CPIC_DRUGID_CACHE, _CPIC_RECS_CACHE) so the live CPIC API is only consulted
for drugs that weren't in the bundle. Demo-bulletproof: if api.cpicpgx.org is
down at 1:30pm Sunday, every drug the agent looks up still resolves instantly
from disk.

Re-run this script whenever the bundled drug list changes or when CPIC updates
their guidelines (rare — they version explicitly). The cache file embeds a
`generated_at` timestamp and the upstream API base URL.
"""

import datetime
import json
import sys
import time
from pathlib import Path

# httpx is already in server/.venv (transitive dep of the anthropic SDK).
# Using it instead of stdlib urllib so we pick up certifi's trust store —
# macOS system Python 3.9 ships without one, which breaks raw urllib HTTPS.
import httpx

REPO_ROOT = Path(__file__).resolve().parent.parent
DRUGS_PATH = REPO_ROOT / "src" / "data" / "drugs.json"
OUTPUT_PATH = REPO_ROOT / "src" / "data" / "cpic_recommendations.json"

CPIC_API_BASE = "https://api.cpicpgx.org/v1"
REQUEST_TIMEOUT_S = 10.0
SLEEP_BETWEEN_REQUESTS_S = 0.1  # be polite to the API

_http = httpx.Client(timeout=REQUEST_TIMEOUT_S, headers={"Accept": "application/json"})


def _get_json(url: str):
    resp = _http.get(url)
    resp.raise_for_status()
    return resp.json()


def _drug_names_from_bundle() -> list:
    if not DRUGS_PATH.exists():
        sys.exit(f"Missing {DRUGS_PATH}. Cannot enumerate drugs.")
    with DRUGS_PATH.open() as fh:
        data = json.load(fh)
    seen = set()
    out = []
    for gene_drugs in data.get("drugs", {}).values():
        for drug_name in gene_drugs.keys():
            key = drug_name.lower().strip()
            if key in seen:
                continue
            seen.add(key)
            out.append(drug_name)
    out.sort(key=str.lower)
    return out


def _resolve_drugid(drug_name: str):
    url = f"{CPIC_API_BASE}/drug"
    try:
        data = _http.get(
            url,
            params={"name": f"eq.{drug_name.lower()}", "select": "drugid", "limit": 1},
        ).json()
    except Exception as exc:
        print(f"  ! drugid lookup failed for {drug_name}: {exc}")
        return None
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0].get("drugid")
    return None


def _fetch_recommendations(drugid: str):
    url = f"{CPIC_API_BASE}/recommendation"
    try:
        data = _http.get(
            url,
            params={
                "drugid": f"eq.{drugid}",
                "select": "phenotypes,implications,drugrecommendation,classification,population",
                "limit": 200,
            },
        ).json()
    except Exception as exc:
        print(f"  ! recommendations fetch failed for {drugid}: {exc}")
        return None
    if isinstance(data, list):
        return data
    return None


def main() -> int:
    drugs = _drug_names_from_bundle()
    print(f"Bundled drugs to cache: {len(drugs)}")

    cache = {}
    misses = []
    for drug in drugs:
        print(f"- {drug}")
        drugid = _resolve_drugid(drug)
        if not drugid:
            print("  (no drugid; CPIC doesn't index this drug by that name)")
            misses.append(drug)
            time.sleep(SLEEP_BETWEEN_REQUESTS_S)
            continue
        time.sleep(SLEEP_BETWEEN_REQUESTS_S)
        recs = _fetch_recommendations(drugid)
        if recs is None:
            misses.append(drug)
            time.sleep(SLEEP_BETWEEN_REQUESTS_S)
            continue
        cache[drug.lower()] = {
            "drugid": drugid,
            "recommendations": recs,
        }
        print(f"  OK drugid={drugid} recs={len(recs)}")
        time.sleep(SLEEP_BETWEEN_REQUESTS_S)

    payload = {
        "version": "1",
        "source": CPIC_API_BASE,
        "generated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "drug_count": len(cache),
        "misses": misses,
        "drugs": cache,
    }
    OUTPUT_PATH.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"\nWrote {OUTPUT_PATH} ({len(cache)} drugs cached, {len(misses)} misses)")
    if misses:
        print("Misses (no CPIC entry by exact name):", ", ".join(misses))
    return 0


if __name__ == "__main__":
    sys.exit(main())
