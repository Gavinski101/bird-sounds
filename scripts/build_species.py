#!/usr/bin/env python3
"""Build data/species.json from data/target-list.csv.

For each bird: eBird code, names in every name set (eBird locales), family,
area rank and tier (from the CSV), and a reveal photo from iNaturalist.

    python scripts/build_species.py
"""
import csv
import io
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
UA = {"User-Agent": "bird-sounds-personal-app"}

NAME_SETS = {
    "en_ZA": "English (South Africa)",
    "en_IOC": "English (IOC)",
    "en": "English (US)",
    "en_UK": "English (UK)",
}

# iNaturalist sometimes files a bird under an older or different scientific name.
INAT_ALIASES = {
    "Ardea ibis": "Bubulcus ibis",
}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:
            print(f"  retry {attempt + 1}: {e}")
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"failed: {url}")


def ebird_names(locale):
    url = f"https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=csv&cat=species&locale={locale}"
    rows = csv.DictReader(io.StringIO(get(url).decode("utf-8")))
    return {r["SCIENTIFIC_NAME"]: r for r in rows}


def inat_photo(sci):
    name = INAT_ALIASES.get(sci, sci)
    q = urllib.parse.urlencode({"q": name, "rank": "species", "per_page": 5})
    data = json.loads(get(f"https://api.inaturalist.org/v1/taxa?{q}"))
    time.sleep(1)
    for t in data.get("results", []):
        if t.get("name") in (name, sci) and t.get("default_photo"):
            p = t["default_photo"]
            return {
                "url": p["medium_url"],
                "attr": p.get("attribution", ""),
                "inat_taxon": t["id"],
            }
    return None


def main():
    targets = list(csv.DictReader(open(DATA / "target-list.csv", encoding="utf-8")))
    sets = {loc: ebird_names(loc) for loc in NAME_SETS}
    out = []
    for t in targets:
        sci = t["scientific"]
        base = sets["en"][sci]
        print(f"{t['name_en_ZA']}")
        out.append({
            "id": base["SPECIES_CODE"],
            "sci": sci,
            "names": {loc: sets[loc][sci]["COMMON_NAME"] for loc in NAME_SETS},
            "family": sets["en_ZA"][sci]["FAMILY_COM_NAME"],
            "familySci": base["FAMILY_SCI_NAME"],
            "listName": t["list_name"],
            "rank": int(t["area_rank"]) if t["area_rank"] else 999,
            "tier": t["tier"],
            "photo": inat_photo(sci),
        })
    out.sort(key=lambda b: b["rank"])
    doc = {"nameSets": NAME_SETS, "area": "George / Wilderness", "species": out}
    (DATA / "species.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {len(out)} species, {sum(1 for b in out if not b['photo'])} without photo")


if __name__ == "__main__":
    main()
