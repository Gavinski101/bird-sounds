#!/usr/bin/env python3
"""Build data/areas.json: the region tree and, per area, how common each bird is there.

Commonness (v2.1.3) blends two sources, because this is a SOUND app:
  - the bird atlas SABAP2 (via GBIF, CC BY 4.0): atlasers list every bird they detect in a
    pentad, by sight OR sound, so a skulker that is heard but rarely seen still counts;
  - iNaturalist research-grade observations, which need a photo (or sound), so heard-not-seen
    birds (Knysna Warbler, flufftails, cuckoos) rank far lower than how often you hear them.
Per area: score = w * atlas share + (1 - w) * iNat share x the bird's "heard" factor, with
w = atlas records / (atlas records + ATLAS_K). The heard factor (also in species.json as
"heard", used by the app's Near me list) = the bird's atlas share / iNat share over the whole
region. Rank = order of that score. Tiers (Common / Regular / Uncommon / Scarce) are worked out per
area from the rank in the app, so the same bird can be Common in one area and Scarce in another.

Everything fetched is cached in _cache/ (gitignored); delete a file there to fetch it again.

The "My practice list" area holds the owner's 100 birds (data/target-list.csv) ranked as in
George / Wilderness; the app only shows it to the owner's account (see OWNER_HASHES in
js/config.js).

    python scripts/build_areas.py           # report only
    python scripts/build_areas.py --write   # update data/areas.json and species.json
"""
import csv
import json
import math
import sys
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


CACHE = ROOT / "_cache"
SABAP2 = "906e6978-e292-4a8b-9c39-adf6bb0f3323"  # Southern African Bird Atlas Project 2 on GBIF
COUNTRY = {"za": "ZA", "na": "NA", "bw": "BW", "zw": "ZW", "mz": "MZ", "ls": "LS", "sz": "SZ"}
ATLAS_K = 30000      # atlas records at which the atlas and iNaturalist weigh the same (~500 cards)
ATLAS_MIN = 3        # atlas records needed to add a bird iNaturalist doesn't list in the area
HEARD_MIN, HEARD_MAX = 0.1, 10.0

# Atlas names GBIF files under an older or different species than our (eBird) name: our id -> atlas key.
# Found 2026-11-26 by listing atlas species with records but no link to our birds.
ATLAS_ALIAS = {
    "grefla3": "9691034",   # Phoenicopterus ruber
    "combul2": "2486126",   # Pycnonotus tricolor (Dark-capped Bulbul)
    "wonsto2": "2481918",   # Ciconia episcopus
    "marsto1": "2481946",   # Leptoptilos crumeniferus
    "whfplo1": "2480288",   # Charadrius marginatus
    "carcha1": "2492582",   # Cossypha caffra (Cape Robin-Chat)
    "kitplo1": "2480317",   # Charadrius pecuarius
    "kasrob2": "6100854",   # Erythropygia coryphoeus
    "thbplo1": "2480325",   # Charadrius tricollaris
    "runlar1": "9389539",   # Mirafra africana
    "capbun1": "2491596",   # Emberiza capensis
    "lafvul1": "2480362",   # Torgos tracheliotus
    "lalbun1": "2491553",   # Emberiza impetuani
    "gobbun1": "2491478",   # Emberiza flaviventris
    "ruvwar2": "12005067",  # "Sylvia spec" (Chestnut-vented Warbler; Layard's is rare beside it)
    "blagos1": "2480631",   # Accipiter melanoleucus
    "grecor": "6066527",    # Phalacrocorax lucidus (White-breasted Cormorant)
    "strher1": "2480824",   # Butorides striata
    "litspa1": "2480594",   # Accipiter minullus
    "afrgos1": "2480635",   # Accipiter tachiro
    "ruebus1": "2474887",   # Eupodotis rueppellii
    "cibbun1": "2491491",   # Emberiza tahapisi
    "trobou1": "2484868",   # Laniarius aethiopicus
    "hoopoe": "2498421",    # Upupa africana
    "chbplo1": "2480289",   # Charadrius pallidus
    "dwabit1": "2480845",   # Ixobrychus sturmii
    "litbit1": "2480850",   # Ixobrychus minutus
    "eaclar1": "7340980",   # Mirafra fasciolata
    "yellow6": "2496449",   # Ceuthmochares aereus
    "shikra1": "2480610",   # Accipiter badius
    "caclar1": "2490597",   # Mirafra apiata
    "flalar1": "2490596",   # Mirafra rufocinnamomea
    "spocre2": "2487575",   # Salpornis spilonotus
    "cabbun1": "2491526",   # Emberiza cabanisi
    "lobpip7": "2490292",   # Anthus similis (Nicholson's / Long-billed Pipit)
    "afywhe4": "2489344",   # Zosterops senegalensis
    "srbhor1": "2475965",   # Tockus erythrorhynchus
    "eurwar1": "5231319",   # Acrocephalus baeticatus (African Reed Warbler)
}
# Our bird = two atlas species (eBird lumps them): the extra atlas species' records are added.
ATLAS_LUMP_EXTRA = {
    "blakit1": "5788522",   # Black Kite + Yellow-billed Kite (Milvus aegyptius)
    "grbcam1": "5231298",   # Bleating + Grey-backed Camaroptera (Camaroptera brevicaudata)
}
ATLAS_MISSING_INAT = 30  # no atlas records anywhere but this many iNat ones: GBIF's copy lacks the bird


def get_json(url, pause=1.0):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
                data = json.load(r)
            time.sleep(pause)
            return data
        except Exception as e:
            if getattr(e, "code", None) == 400:  # our request is wrong: retrying won't help
                raise
            print(f"  retry {attempt + 1}: {e}")
            time.sleep(2 ** (attempt + 2))
    raise RuntimeError(url)


def cached(name, fetch):
    CACHE.mkdir(exist_ok=True)
    path = CACHE / name
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    data = fetch()
    path.write_text(json.dumps(data), encoding="utf-8")
    return data


def species_counts(query):
    """iNaturalist research-grade bird counts in an area: {taxon id: observations}."""
    rows, page = [], 1
    while True:
        params = {"iconic_taxa": "Aves", "quality_grade": "research", "rank": "species", "per_page": 500, "page": page, **query}
        data = get_json("https://api.inaturalist.org/v1/observations/species_counts?" + urllib.parse.urlencode(params), 1.5)
        rows += data["results"]
        if len(rows) >= data["total_results"] or not data["results"]:
            return {"total": data["total_results"], "counts": {str(r["taxon"]["id"]): r["count"] for r in rows}}
        page += 1


# ---- area shapes for the atlas query ----

def ring_area(ring):
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1])) / 2


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy) or 1e-12
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / norm
        if d > dmax:
            dmax, idx = d, i
    if dmax <= eps:
        return [pts[0], pts[-1]]
    return rdp(pts[:idx + 1], eps)[:-1] + rdp(pts[idx:], eps)


def wkt(polys, max_points=100):
    """Outer rings only, anticlockwise (GBIF's rule), simplified until short enough for a URL."""
    rings = []
    for poly in polys:
        ring = [tuple(p[:2]) for p in poly[0]]
        if ring[0] == ring[-1]:
            ring = ring[:-1]
        if ring_area(ring) < 0:
            ring.reverse()
        rings.append(ring)
    big = max(abs(ring_area(r)) for r in rings)
    rings = [r for r in rings if abs(ring_area(r)) >= big * 0.01]  # tiny islands: no atlas pentads
    eps = 0.0
    while True:
        out = []
        for r in rings:
            # A closed ring starts and ends on the same point, so simplify it as two halves.
            h = len(r) // 2
            s = (rdp(r[:h + 1], eps)[:-1] + rdp(r[h:] + [r[0]], eps)[:-1]) if eps else r
            if len(s) >= 3 and ring_area(s) > 0:
                out.append(s)
        if sum(len(r) for r in out) <= max_points:
            break
        eps = eps * 1.6 if eps else 0.002
    parts = ["((" + ",".join(f"{x:.3f} {y:.3f}" for x, y in r + [r[0]]) + "))" for r in out]
    return ("POLYGON" + parts[0]) if len(parts) == 1 else "MULTIPOLYGON(" + ",".join(parts) + ")"


def circle_wkt(lat, lng, km, n=36):
    pts = [(lng + km / (111.32 * math.cos(math.radians(lat))) * math.cos(2 * math.pi * i / n),
            lat + km / 110.57 * math.sin(2 * math.pi * i / n)) for i in range(n)]
    return "POLYGON((" + ",".join(f"{x:.4f} {y:.4f}" for x, y in pts + [pts[0]]) + "))"


def hull(pts):
    pts = sorted(set(pts))
    def half(seq):
        out = []
        for p in seq:
            while len(out) >= 2 and (out[-1][0] - out[-2][0]) * (p[1] - out[-2][1]) - (out[-1][1] - out[-2][1]) * (p[0] - out[-2][0]) <= 0:
                out.pop()
            out.append(p)
        return out[:-1]
    return half(pts) + half(pts[::-1])  # anticlockwise


def place_polys(pid):
    g = cached(f"place_{pid}.json",
               lambda: get_json(f"https://api.inaturalist.org/v1/places/{pid}", 1.5)["results"][0]["geometry_geojson"])
    return [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]


def place_wkt(pid, shape="outline"):
    """outline = the simplified real shape; hull = one convex outline around it all, for when a
    simplified coastline crosses itself and GBIF rejects it (atlas pentads are ~9 km anyway)."""
    polys = place_polys(pid)
    if shape == "outline":
        return wkt(polys)
    h = hull([tuple(p[:2]) for poly in polys for p in poly[0]])
    return wkt([[h + [h[0]]]])


def atlas_filter(aid, query):
    if aid in COUNTRY:
        f = {"country": COUNTRY[aid]}
        if "swlat" in query:  # Mozambique: only south of the Zambezi, like the iNaturalist query
            w, s, e, n = query["swlng"], query["swlat"], query["nelng"], query["nelat"]
            f["geometry"] = f"POLYGON(({w} {s},{e} {s},{e} {n},{w} {n},{w} {s}))"
        return f
    if "radius" in query:
        return {"geometry": circle_wkt(query["lat"], query["lng"], query["radius"])}
    return {"geometry": place_wkt(query["place_id"])}


def atlas_counts(aid, query):
    """SABAP2 records per GBIF species key in an area (one record = the bird on one atlas card)."""
    def fetch():
        def search(f):
            params = {"datasetKey": SABAP2, "limit": 0, "facet": "speciesKey", "facetLimit": 3000, **f}
            return get_json("https://api.gbif.org/v1/occurrence/search?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote), 1.0)
        try:
            d = search(atlas_filter(aid, query))
        except Exception:
            if "place_id" not in query or aid in COUNTRY:
                raise
            print(f"  {aid}: outline rejected, using the convex outline")
            d = search({"geometry": place_wkt(query["place_id"], "hull")})
        counts = {c["name"]: c["count"] for c in d["facets"][0]["counts"]} if d.get("facets") else {}
        return {"total": d["count"], "counts": counts}
    return cached(f"atlas_{aid}.json", fetch)


def gbif_keys(species):
    """Our bird id -> GBIF accepted species key (synonyms land on the accepted species)."""
    def fetch():
        out = {}
        for i, b in enumerate(species):
            m = get_json("https://api.gbif.org/v1/species/match?" + urllib.parse.urlencode({"name": b["sci"], "class": "Aves"}), 0.2)
            if m.get("speciesKey") and m.get("matchType") != "NONE":
                out[b["id"]] = str(m["speciesKey"])
            if i % 100 == 0:
                print(f"  GBIF names {i}/{len(species)}")
        return out
    return cached("gbif_keys.json", fetch)


def main():
    doc = json.loads((DATA / "species.json").read_text(encoding="utf-8"))
    species = doc["species"]
    keys = {**gbif_keys(species), **ATLAS_ALIAS}
    print(f"GBIF species keys for {len(keys)} of {len(species)} birds")

    raw = []
    for aid, name, parent, query in AREAS:
        inat = cached(f"inat_{aid}.json", lambda: species_counts(query))
        atlas = atlas_counts(aid, query)
        raw.append((aid, name, parent, inat, atlas))
        print(f"  fetched {name}")

    # Whole region: iNat counts from species.json, atlas = the seven countries added up.
    all_inat = {"total": len(species), "counts": {str(b["inat"]): b.get("records", 0) for b in species}}
    all_atlas = {"total": 0, "counts": {}}
    for aid, _n, _p, _i, atlas in raw:
        if aid in COUNTRY:
            all_atlas["total"] += atlas["total"]
            for k, v in atlas["counts"].items():
                all_atlas["counts"][k] = all_atlas["counts"].get(k, 0) + v

    # Clean up the links: one atlas species shared by two of ours goes to the commoner one, and
    # birds GBIF's atlas copy lacks (e.g. Yellow Bishop, Cape White-eye: names it couldn't match)
    # count as "no atlas data", not as rare.
    region = all_atlas["counts"]
    by_key = {}
    for b in species:
        if b["id"] in keys:
            by_key.setdefault(keys[b["id"]], []).append(b)
    for k, birds in by_key.items():
        for b in sorted(birds, key=lambda x: -x.get("records", 0))[1:]:
            print(f"  shared atlas name: {b['listName']} uses iNaturalist only")
            del keys[b["id"]]
    for b in species:
        if (b["id"] in keys and region.get(keys[b["id"]], 0) + region.get(ATLAS_LUMP_EXTRA.get(b["id"], ""), 0) < 5
                and b.get("records", 0) >= ATLAS_MISSING_INAT):
            print(f"  not in GBIF's atlas copy: {b['listName']} ({b['sci']}), uses iNaturalist")
            del keys[b["id"]]

    def counts(inat, atlas):
        n = {b["id"]: inat["counts"].get(str(b["inat"]), 0) for b in species}
        a = {b["id"]: (atlas["counts"].get(keys[b["id"]], 0) + atlas["counts"].get(ATLAS_LUMP_EXTRA.get(b["id"], ""), 0)
                       if b["id"] in keys else None) for b in species}
        return n, a

    # Heard factor per bird: atlas share / iNat share over the whole region (smoothed, clamped).
    n_all, a_all = counts(all_inat, all_atlas)
    sn = sum(n_all.values())
    sa = sum(v for v in a_all.values() if v)
    heard = {}
    for b in species:
        a = a_all[b["id"]]
        if a is not None:
            f = ((a + 5) / sa) / ((n_all[b["id"]] + 5) / sn)
            heard[b["id"]] = round(min(HEARD_MAX, max(HEARD_MIN, f)), 2)
    # No atlas link: the family's typical factor (median), else 1.
    fam = {}
    for b in species:
        if b["id"] in heard:
            fam.setdefault(b["familySci"], []).append(heard[b["id"]])
    for b in species:
        if b["id"] not in heard:
            v = sorted(fam.get(b["familySci"], [1.0]))
            heard[b["id"]] = v[len(v) // 2]

    def ranks_for(n, a, atlas_total):
        w = atlas_total / (atlas_total + ATLAS_K)
        nf = {i: n[i] * heard[i] for i in n}
        snf = sum(nf.values()) or 1
        sa = sum(v for v in a.values() if v) or 1
        score = {}
        for b in species:
            i = b["id"]
            if not n[i] and not (a[i] or 0) >= ATLAS_MIN:
                continue
            score[i] = nf[i] / snf if a[i] is None else w * a[i] / sa + (1 - w) * nf[i] / snf
        order = sorted(score, key=lambda i: -score[i])
        return {i: r for r, i in enumerate(order, 1)}, w

    out = []
    r_all, w = ranks_for(*counts(all_inat, all_atlas), all_atlas["total"])
    out.append({"id": "all", "name": "Southern Africa (everywhere)", "parent": None, "totalSpecies": len(species), "ranks": r_all})
    print(f"{'Southern Africa':40} atlas {all_atlas['total']:>9} records, weight {w:.2f}")
    for aid, name, parent, inat, atlas in raw:
        ranks, w = ranks_for(*counts(inat, atlas), atlas["total"])
        out.append({"id": aid, "name": name, "parent": parent, "totalSpecies": max(inat["total"], len(ranks)), "ranks": ranks})
        print(f"{name:40} atlas {atlas['total']:>9} records, weight {w:.2f}, {len(ranks):4} of ours (iNat {sum(1 for v in inat['counts'].values() if v)})")

    george = next(a for a in out if a["id"] == "george")
    targets = {r["scientific"] for r in csv.DictReader(open(DATA / "target-list.csv", encoding="utf-8"))}
    mine = {b["id"]: george["ranks"].get(b["id"], 999) for b in species if b["sci"] in targets}
    out.append({"id": "mylist", "name": "My practice list (George / Wilderness)", "parent": None,
                "private": True, "totalSpecies": george["totalSpecies"], "ranks": mine})
    print(f"My practice list: {len(mine)} birds")

    if "--write" not in sys.argv:
        print("(report only; --write saves areas.json and the heard factors in species.json)")
        return out, heard
    (DATA / "areas.json").write_text(json.dumps({"areas": out}, separators=(",", ":")), encoding="utf-8")
    print(f"areas.json: {(DATA / 'areas.json').stat().st_size // 1024} KB")
    for b in species:
        b["heard"] = heard[b["id"]]
    (DATA / "species.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return out, heard


if __name__ == "__main__":
    main()
