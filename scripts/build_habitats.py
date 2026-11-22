#!/usr/bin/env python3
"""Build data/habitats.json: the habitat(s) of each bird, for "Habitats to focus on".

Source: AVONET (Tobias et al. 2022, Ecology Letters 25: 581-597), CC BY 4.0: each species'
main habitat (BirdLife taxonomy). Read from an open copy of its BirdLife table:
https://github.com/txm676/GlobalFDPDLoss (Data/AVONET_BIRDLIFE.csv). One small file, fetched once.

AVONET habitats are grouped into the app's habitats (GROUPS). AVONET gives one main habitat per
bird, so EXTRA adds the other habitats well-known birds are also often heard in (hand-made).

    python scripts/build_habitats.py [path/to/AVONET_BIRDLIFE.csv]
"""
import csv
import io
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
URL = "https://raw.githubusercontent.com/txm676/GlobalFDPDLoss/HEAD/Data/AVONET_BIRDLIFE.csv"

# AVONET habitat -> app habitat
GROUPS = {
    "Forest": "forest",
    "Woodland": "woodland",
    "Shrubland": "scrub",
    "Grassland": "grassland",
    "Desert": "dry",
    "Rock": "dry",
    "Wetland": "water",
    "Riverine": "water",
    "Coastal": "coast",
    "Marine": "coast",
    "Human Modified": "town",
}

# Renamed species that don't match on name: our scientific name -> AVONET (BirdLife) name.
SCI_FIX = {
    "Falco rupicolus": "Falco tinnunculus",
    "Tockus rufirostris": "Tockus erythrorhynchus",
    "Centropus burchellii": "Centropus superciliosus",
    "Cyanomitra veroxii": "Cyanomitra verreauxii",
    "Butorides atricapilla": "Butorides striata",
    "Tachyspiza minulla": "Accipiter minullus",
    "Tachyspiza badia": "Accipiter badius",
    "Porphyrio martinica": "Porphyrio martinicus",
    "Anthus nicholsoni": "Anthus similis",
    "Zosterops anderssoni": "Zosterops senegalensis",
    "Laniarius major": "Laniarius aethiopicus",
    "Grus paradisea": "Anthropoides paradiseus",
    "Grus carunculata": "Bugeranus carunculatus",
    "Buphagus erythroryncha": "Buphagus erythrorynchus",
    "Ardea ibis": "Bubulcus ibis",
    "Porphyrio madagascariensis": "Porphyrio porphyrio",
    "Corypha africana": "Mirafra africana",
    "Corypha fasciolata": "Mirafra fasciolata",
    "Corypha apiata": "Mirafra apiata",
    "Ketupa lactea": "Bubo lacteus",
    "Fringillaria capensis": "Emberiza capensis",
    "Catriscus brevirostris": "Schoenicola brevirostris",
    "Stercorarius antarcticus": "Catharacta antarctica",
    "Brunhilda erythronotos": "Estrilda erythronotos",
    "Glaucestrilda perreini": "Estrilda perreini",
    "Glaucestrilda thomensis": "Estrilda thomensis",
    "Phalaropus tricolor": "Steganopus tricolor",
    "Tauraco rossae": "Musophaga rossae",
    "Tauraco violaceus": "Musophaga violacea",
    "Crecopsis egregia": "Crex egregia",
    "Aenigmatolimnas marginalis": "Amaurornis marginalis",
    "Amirafra rufocinnamomea": "Mirafra rufocinnamomea",
    "Anarhynchus atrifrons": "Charadrius mongolus",
    "Crinifer concolor": "Corythaixoides concolor",
}

# Other habitats these birds are often heard in, beyond AVONET's main one (by en_ZA name).
EXTRA = {
    "Southern Boubou": ["forest", "town"],
    "Sombre Greenbul": ["forest"],
    "Cape Bulbul": ["town"],
    "Cape Robin-Chat": ["town", "scrub"],
    "Olive Thrush": ["town"],
    "Cape White-eye": ["forest", "town"],
    "Cape Weaver": ["town", "water"],
    "Southern Masked Weaver": ["town"],
    "Cape Sparrow": ["town"],
    "Hadeda Ibis": ["town"],
    "Speckled Mousebird": ["town", "scrub"],
    "Red-eyed Dove": ["town"],
    "Cape Turtle (Ring-necked) Dove": ["town"],
    "Laughing Dove": ["town"],
    "Speckled Pigeon": ["town", "dry"],
    "Fork-tailed Drongo": ["forest"],
    "Black-headed Oriole": ["forest"],
    "Bar-throated Apalis": ["forest", "scrub"],
    "Cape Batis": ["woodland"],
    "Southern Fiscal": ["town", "scrub"],
    "Burchell's Coucal": ["water"],
    "Amethyst Sunbird": ["town"],
    "Southern Double-collared Sunbird": ["town", "forest"],
    "Greater Double-collared Sunbird": ["forest"],
    "Cape Wagtail": ["town", "coast"],
    "African Paradise Flycatcher": ["forest", "town"],
    "Dark-capped Bulbul": ["town"],
    "Karoo Prinia": ["dry"],
    "Pied Crow": ["town"],
    "Egyptian Goose": ["town"],
    "Kelp Gull": ["town"],
    "Hartlaub's Gull": ["town"],
    "African (Black) Oystercatcher": ["coast"],
    "Indian Yellow-nosed Albatross": ["coast"],
    "Rose-ringed Parakeet": ["town"],
    "Common Myna": ["town"],
    "Little Rush Warbler": ["water"],
    "Red-chested Flufftail": ["water"],
    "Buff-spotted Flufftail": ["forest"],
    "Jackal Buzzard": ["grassland", "dry"],
    "Klaas's Cuckoo": ["woodland"],
    "Diederik Cuckoo": ["water"],
    "Red-chested Cuckoo": ["woodland", "town"],
    "Familiar Chat": ["dry"],
    "Mountain Chat (Wheatear)": ["dry"],
}


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    if src:
        text = Path(src).read_text(encoding="utf-8")
    else:
        req = urllib.request.Request(URL, headers={"User-Agent": "bird-sounds-personal-app"})
        with urllib.request.urlopen(req, timeout=60) as r:
            text = r.read().decode("utf-8")
    rows = {r["species"].replace("_", " "): r for r in csv.DictReader(io.StringIO(text))}
    by_epithet = {}
    for name, r in rows.items():
        by_epithet.setdefault((name.split()[1], r["Family"]), name)

    species = json.loads((DATA / "species.json").read_text(encoding="utf-8"))["species"]
    out, missing = {}, []
    for b in species:
        sci = " ".join(b["sci"].split()[:2])
        name = sci if sci in rows else SCI_FIX.get(sci)
        if name not in rows:  # moved to another genus: same species name, same family
            name = by_epithet.get((sci.split()[1], b["familySci"]))
        habs = []
        if name in rows and rows[name]["Habitat"] in GROUPS:
            habs.append(GROUPS[rows[name]["Habitat"]])
        for h in EXTRA.get(b["names"]["en_ZA"], []):
            if h not in habs:
                habs.append(h)
        if habs:
            out[b["id"]] = habs
        else:
            missing.append(f"{b['names']['en_ZA']} ({sci})")
    unknown = set(EXTRA) - {b["names"]["en_ZA"] for b in species}
    if unknown:
        print("EXTRA names not found:", ", ".join(sorted(unknown)))
    (DATA / "habitats.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    counts = {}
    for habs in out.values():
        for h in habs:
            counts[h] = counts.get(h, 0) + 1
    print(f"{len(out)} of {len(species)} birds have a habitat; counts: {counts}")
    if missing:
        print(f"no habitat ({len(missing)}):", "; ".join(missing))


if __name__ == "__main__":
    main()
