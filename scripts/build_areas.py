#!/usr/bin/env python3
"""Build data/areas.json: the region tree and, per area, how common each bird is there.

Commonness = rank among all birds with research-grade iNaturalist records in that area.
Tiers (Beginner / Easy / Medium / Hard) are worked out per area from that rank in the app,
so the same bird can be Beginner in one area and Hard in another.

The "My practice list" area holds the owner's 100 birds (data/target-list.csv) ranked as in
George / Wilderness; the app only shows it to the owner's account (see OWNER_HASHES in
js/config.js).

    python scripts/build_areas.py
"""
import csv
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
UA = {"User-Agent": "bird-sounds-personal-app"}


def place(pid):
    return {"place_id": pid}


def circle(lat, lng, km):
    return {"lat": lat, "lng": lng, "radius": km}


# (id, name, parent, iNaturalist filter). Parents come before their children.
AREAS = [
    ("za", "South Africa", "all", place(6986)),
    ("wc", "Western Cape", "za", place(6987)),
    ("cape-town", "Cape Town", "wc", place(52355)),
    ("table-mountain", "Table Mountain National Park", "wc", place(71668)),
    ("west-coast-np", "West Coast National Park", "wc", place(153850)),
    ("cederberg", "Cederberg", "wc", circle(-32.35, 19.05, 30)),
    ("overberg", "Overberg", "wc", place(108136)),
    ("de-hoop", "De Hoop Nature Reserve", "wc", place(69351)),
    ("karoo-np", "Karoo National Park", "wc", place(124592)),
    ("garden-route", "Garden Route", "wc", place(108126)),
    ("george", "George / Wilderness", "garden-route", circle(-33.97, 22.52, 30)),
    ("ec", "Eastern Cape", "za", place(8872)),
    ("gqeberha", "Gqeberha (Nelson Mandela Bay)", "ec", place(59204)),
    ("addo", "Addo Elephant National Park", "ec", circle(-33.45, 25.75, 30)),
    ("mountain-zebra", "Mountain Zebra National Park", "ec", place(69024)),
    ("nc", "Northern Cape", "za", place(13314)),
    ("kgalagadi", "Kgalagadi Transfrontier Park", "nc", place(69021)),
    ("augrabies", "Augrabies Falls National Park", "nc", place(69025)),
    ("namaqua", "Namaqua National Park", "nc", place(82211)),
    ("fs", "Free State", "za", place(50327)),
    ("golden-gate", "Golden Gate Highlands National Park", "fs", place(69026)),
    ("kzn", "KwaZulu-Natal", "za", place(13313)),
    ("durban", "Durban (eThekwini)", "kzn", place(108107)),
    ("isimangaliso", "iSimangaliso Wetland Park", "kzn", place(131530)),
    ("hluhluwe", "Hluhluwe-iMfolozi Park", "kzn", place(71275)),
    ("drakensberg", "Maloti-Drakensberg", "kzn", place(131528)),
    ("gp", "Gauteng", "za", place(9576)),
    ("johannesburg", "Johannesburg", "gp", place(50149)),
    ("pretoria", "Pretoria (Tshwane)", "gp", place(50126)),
    ("lp", "Limpopo", "za", place(9074)),
    ("mapungubwe", "Mapungubwe National Park", "lp", place(55127)),
    ("marakele", "Marakele National Park", "lp", place(71276)),
    ("magoebaskloof", "Magoebaskloof", "lp", circle(-23.88, 29.98, 20)),
    ("mp", "Mpumalanga", "za", place(7478)),
    ("kruger", "Kruger National Park", "mp", place(69020)),
    ("wakkerstroom", "Wakkerstroom", "mp", place(48529)),
    ("nw", "North West", "za", place(12513)),
    ("pilanesberg", "Pilanesberg National Park", "nw", place(65580)),
    ("na", "Namibia", "all", place(7140)),
    ("etosha", "Etosha National Park", "na", place(69030)),
    ("namib-naukluft", "Namib-Naukluft", "na", place(69029)),
    ("bw", "Botswana", "all", place(7105)),
    ("okavango", "Okavango Delta", "bw", place(131526)),
    ("chobe", "Chobe National Park", "bw", place(192605)),
    ("zw", "Zimbabwe", "all", place(7146)),
    ("hwange", "Hwange", "zw", place(69215)),
    ("victoria-falls", "Victoria Falls", "zw", circle(-17.93, 25.85, 25)),
    ("gonarezhou", "Gonarezhou National Park", "zw", place(185178)),
    ("mz", "Mozambique (south of the Zambezi)", "all", {"place_id": 7134, "swlat": -26.9, "swlng": 30.2, "nelat": -17.5, "nelng": 41.0}),
    ("maputo-reserve", "Maputo Special Reserve", "mz", place(124757)),
    ("ls", "Lesotho", "all", place(8489)),
    ("sz", "Eswatini", "all", place(7143)),
]


def species_counts(query):
    rows, page = [], 1
    while True:
        params = {"iconic_taxa": "Aves", "quality_grade": "research", "rank": "species", "per_page": 500, "page": page, **query}
        url = "https://api.inaturalist.org/v1/observations/species_counts?" + urllib.parse.urlencode(params)
        for attempt in range(5):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                    data = json.load(r)
                break
            except Exception as e:
                print(f"  retry {attempt + 1}: {e}")
                time.sleep(2 ** (attempt + 1))
        else:
            raise RuntimeError(url)
        rows += data["results"]
        time.sleep(1.5)
        if len(rows) >= data["total_results"] or not data["results"]:
            return rows
        page += 1


def main():
    species = json.loads((DATA / "species.json").read_text(encoding="utf-8"))["species"]
    by_inat = {b["inat"]: b["id"] for b in species}

    out = [{
        "id": "all", "name": "Southern Africa (everywhere)", "parent": None,
        "totalSpecies": len(species),
        "ranks": {b["id"]: b["rank"] for b in species},
    }]
    for aid, name, parent, query in AREAS:
        rows = species_counts(query)
        ranks = {}
        for i, r in enumerate(rows, 1):
            sid = by_inat.get(r["taxon"]["id"])
            if sid and sid not in ranks:
                ranks[sid] = i
        out.append({"id": aid, "name": name, "parent": parent, "totalSpecies": len(rows), "ranks": ranks})
        print(f"{name:40} {len(rows):4} recorded, {len(ranks):4} of ours")

    george = next(a for a in out if a["id"] == "george")["ranks"]
    targets = {r["scientific"] for r in csv.DictReader(open(DATA / "target-list.csv", encoding="utf-8"))}
    mine = {b["id"]: george.get(b["id"], 999) for b in species if b["sci"] in targets}
    out.append({"id": "mylist", "name": "My practice list (George / Wilderness)", "parent": None,
                "private": True, "totalSpecies": next(a for a in out if a["id"] == "george")["totalSpecies"],
                "ranks": mine})
    print(f"My practice list: {len(mine)} birds")

    (DATA / "areas.json").write_text(json.dumps({"areas": out}, separators=(",", ":")), encoding="utf-8")
    print(f"areas.json: {(DATA / 'areas.json').stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
