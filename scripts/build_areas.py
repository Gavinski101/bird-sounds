#!/usr/bin/env python3
"""Build data/areas.json: the region tree and, per area, how common each of our birds is.

Commonness = rank among all birds with research-grade iNaturalist records in that area.
Tiers (Beginner / Easy / Medium / Hard) are worked out per area from that rank, so the same
bird can be Beginner in one area and Hard in another.

    python scripts/build_areas.py
"""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
UA = {"User-Agent": "bird-sounds-personal-app"}

# parent: the area this one sits inside (None = top level). query: iNaturalist filter.
AREAS = [
    {"id": "za", "name": "South Africa", "parent": None, "query": {"place_id": 6986}},
    {"id": "wc", "name": "Western Cape", "parent": "za", "query": {"place_id": 6987}},
    {"id": "garden-route", "name": "Garden Route", "parent": "wc", "query": {"place_id": 108126}},
    {"id": "george", "name": "George / Wilderness", "parent": "garden-route",
     "query": {"lat": -33.97, "lng": 22.52, "radius": 30}},
]

# iNaturalist sometimes uses another scientific name than eBird.
ALIASES = {
    "Ardea ibis": ["Bubulcus ibis"],
    "Upupa epops": ["Upupa africana"],
    "Ceblepyris caesius": ["Coracina caesia"],
    "Icthyophaga vocifer": ["Haliaeetus vocifer"],
    "Sigelus silens": ["Melaenornis silens"],
    "Cossypha dichroa": ["Dessonornis dichrous"],
    "Dessonornis caffer": ["Cossypha caffra"],
    "Coccopygia melanotis": ["Estrilda melanotis"],
    "Cryptillas victorini": ["Bradypterus victorini"],
    "Chlorophoneus olivaceus": ["Telophorus olivaceus"],
    "Phylloscopus ruficapilla": ["Seicercus ruficapilla"],
    "Andropadus importunus": ["Pycnonotus importunus"],
    "Notopholia corusca": ["Lamprotornis corruscus"],
    "Tachymarptis melba": ["Apus melba"],
}


def tier(rank):
    if rank is None:
        return "Hard"
    return "Beginner" if rank <= 40 else "Easy" if rank <= 100 else "Medium" if rank <= 180 else "Hard"


def species_counts(query):
    rows, page = [], 1
    while True:
        params = {"iconic_taxa": "Aves", "quality_grade": "research", "per_page": 500, "page": page, **query}
        url = "https://api.inaturalist.org/v1/observations/species_counts?" + urllib.parse.urlencode(params)
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
            data = json.load(r)
        rows += data["results"]
        time.sleep(1.5)
        if len(rows) >= data["total_results"] or not data["results"]:
            return rows
        page += 1


def main():
    species = json.loads((DATA / "species.json").read_text(encoding="utf-8"))["species"]
    out = []
    for area in AREAS:
        rows = species_counts(area["query"])
        rank_of = {}
        for i, r in enumerate(rows, 1):
            rank_of.setdefault(r["taxon"]["name"], i)
        ranks = {}
        for b in species:
            rk = next((rank_of[n] for n in [b["sci"], *ALIASES.get(b["sci"], [])] if n in rank_of), None)
            if rk is None:  # subspecies-level match
                rk = next((v for n, v in rank_of.items() if n.startswith(b["sci"] + " ")), None)
            if rk is not None:
                ranks[b["id"]] = rk
        out.append({"id": area["id"], "name": area["name"], "parent": area["parent"],
                    "totalSpecies": len(rows), "ranks": ranks})
        tiers = {}
        for rk in ranks.values():
            tiers[tier(rk)] = tiers.get(tier(rk), 0) + 1
        print(f"{area['name']:22} {len(rows):4} bird species recorded; {len(ranks)} of ours; {tiers}")
    (DATA / "areas.json").write_text(json.dumps({"areas": out}, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
