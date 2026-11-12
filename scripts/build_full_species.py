#!/usr/bin/env python3
"""Build data/species.json for the full app: every bird of the Southern African subregion.

Region = South Africa, Namibia, Botswana, Zimbabwe, Lesotho, Eswatini and Mozambique south
of the Zambezi. Birds come from research-grade iNaturalist records (captive/escaped birds are
never research grade); vagrants with fewer than MIN_RECORDS records are left out.
Names come from the eBird taxonomy in every name set; the reveal photo is iNaturalist's
default photo for the species.

    python scripts/build_full_species.py
"""
import csv
import io
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
UA = {"User-Agent": "bird-sounds-personal-app"}
MIN_RECORDS = 5

COUNTRIES = "6986,7140,7105,7146,8489,7143"  # SA, Namibia, Botswana, Zimbabwe, Lesotho, Eswatini
MOZ_SOUTH = {"swlat": -26.9, "swlng": 30.2, "nelat": -17.5, "nelng": 41.0, "place_id": 7134}

NAME_SETS = {
    "en_ZA": "English (South Africa)",
    "en_IOC": "English (IOC)",
    "en": "English (US)",
    "en_UK": "English (UK)",
}

# iNaturalist name -> eBird name, where the two taxonomies differ and English names don't help.
SCI_FIX = {
    "Bubulcus ibis": "Ardea ibis",
    "Upupa africana": "Upupa epops",
    "Coracina caesia": "Ceblepyris caesius",
    "Haliaeetus vocifer": "Icthyophaga vocifer",
    "Melaenornis silens": "Sigelus silens",
    "Dessonornis dichrous": "Cossypha dichroa",
    "Cossypha caffra": "Dessonornis caffer",
    "Estrilda melanotis": "Coccopygia melanotis",
    "Bradypterus victorini": "Cryptillas victorini",
    "Telophorus olivaceus": "Chlorophoneus olivaceus",
    "Seicercus ruficapilla": "Phylloscopus ruficapilla",
    "Pycnonotus importunus": "Andropadus importunus",
    "Lamprotornis corruscus": "Notopholia corusca",
    "Apus melba": "Tachymarptis melba",
}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as e:
            print(f"  retry {attempt + 1}: {e}")
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"failed: {url}")


def species_counts(extra):
    rows, page = [], 1
    while True:
        params = {"iconic_taxa": "Aves", "quality_grade": "research", "rank": "species",
                  "per_page": 500, "page": page, **extra}
        data = json.loads(get("https://api.inaturalist.org/v1/observations/species_counts?" + urllib.parse.urlencode(params)))
        rows += data["results"]
        time.sleep(1.5)
        if len(rows) >= data["total_results"] or not data["results"]:
            return rows
        page += 1


def ebird(locale):
    text = get(f"https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=csv&cat=species&locale={locale}").decode("utf-8")
    return {r["SCIENTIFIC_NAME"]: r for r in csv.DictReader(io.StringIO(text))}


def norm(name):
    return re.sub(r"[^a-z]", "", (name or "").lower().replace("grey", "gray"))


def main():
    counts = {}
    for extra in ({"place_id": COUNTRIES}, MOZ_SOUTH):
        for r in species_counts(extra):
            t = r["taxon"]
            c = counts.setdefault(t["id"], {"taxon": t, "count": 0})
            c["count"] += r["count"]
    rows = sorted((c for c in counts.values() if c["count"] >= MIN_RECORDS), key=lambda c: -c["count"])
    print(f"{len(counts)} bird species recorded; {len(rows)} with {MIN_RECORDS}+ records")

    sets = {loc: ebird(loc) for loc in NAME_SETS}
    by_english = {}
    for loc in ("en", "en_IOC", "en_UK", "en_ZA"):
        for sci, r in sets[loc].items():
            by_english.setdefault(norm(r["COMMON_NAME"]), sci)

    targets = {r["scientific"]: r["list_name"] for r in csv.DictReader(open(DATA / "target-list.csv", encoding="utf-8"))}
    out, unmatched, seen = [], [], set()
    for rank, c in enumerate(rows, 1):
        t = c["taxon"]
        sci = SCI_FIX.get(t["name"], t["name"])
        if sci not in sets["en"]:
            sci = by_english.get(norm(t.get("preferred_common_name")), sci)
        if sci not in sets["en"]:
            unmatched.append(f"{t['name']} ({t.get('preferred_common_name')}, {c['count']} records)")
            continue
        base = sets["en"][sci]
        if base["SPECIES_CODE"] in seen:  # two iNat taxa mapped to one eBird species
            continue
        seen.add(base["SPECIES_CODE"])
        p = t.get("default_photo") or {}
        out.append({
            "id": base["SPECIES_CODE"],
            "sci": sci,
            "names": {loc: sets[loc][sci]["COMMON_NAME"] for loc in NAME_SETS},
            "family": sets["en_ZA"][sci]["FAMILY_COM_NAME"],
            "familySci": base["FAMILY_SCI_NAME"],
            "listName": targets.get(sci, ""),
            "records": c["count"],
            "rank": len(out) + 1,
            "photo": {"url": p["medium_url"], "attr": p.get("attribution", ""), "inat_taxon": t["id"]} if p.get("medium_url") else None,
            "inat": t["id"],
        })

    missing_targets = [s for s in targets if s not in {b["sci"] for b in out}]
    doc = {"nameSets": NAME_SETS, "area": "Southern Africa", "species": out}
    (DATA / "species.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(out)} species ({sum(1 for b in out if not b['photo'])} without photo)")
    print(f"not matched to eBird ({len(unmatched)}): " + "; ".join(unmatched[:40]))
    print(f"practice-list birds missing: {missing_targets or 'none'}")


if __name__ == "__main__":
    main()
