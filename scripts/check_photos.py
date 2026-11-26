"""Check every bird photo's licence on iNaturalist and replace ones we may not use.

iNaturalist's default photo for a species can be "all rights reserved", which needs the
photographer's permission. For each species in data/species.json this looks up the taxon's
photos (30 taxa per request, throttled, metadata only):
  - the current photo still has an open licence (CC0 or any CC): kept, licence and credit refreshed;
  - otherwise: the first of the taxon's photos with an open licence, in iNaturalist's order;
  - none open: no photo (the card shows without one).
Each photo records its licence code and the date it was checked ("lic", "checked").

Run every few months, or when iNaturalist photos may have changed:
    python scripts/check_photos.py           # report only
    python scripts/check_photos.py --write   # update data/species.json
"""
import datetime
import html
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / "data" / "species.json"
UA = {"User-Agent": "bird-sounds-personal-app"}
BATCH = 30


def get(url):
    req = urllib.request.Request(url, headers=UA)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except Exception as e:
            print(f"  retry {attempt + 1}: {e}")
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"failed: {url}")


def photographer(attr):
    """Name from iNat's attribution, which comes in the uploader's language:
    "(c) Name, some rights reserved (CC BY-NC), uploaded by ..." / "no rights reserved, uploaded by Name"."""
    m = re.match(r"\(c\) (.+?)\s*,\s*[^,]*\(CC", attr, re.S)
    name = m.group(1) if m else (re.search(r"uploaded by (.+)$", attr, re.S) or [None, attr])[1]
    # Wikimedia-style "*derivative work: Editor . *File.jpg: Author"
    d = re.match(r"\*derivative work: (.+?) \. \*[^:]+: (.+)$", name)
    if d:
        name = f"{d.group(2)}, edited by {d.group(1)}"
    return " ".join(name.split())


def photo_entry(p, taxon, today):
    attr = html.unescape(p.get("attribution", ""))
    return {"url": p["medium_url"], "attr": attr, "by": photographer(attr), "inat_taxon": taxon,
            "lic": p["license_code"], "checked": today}


def main():
    write = "--write" in sys.argv
    doc = json.loads(PATH.read_text(encoding="utf-8"))
    species = doc["species"]
    today = datetime.date.today().isoformat()
    ids = sorted({sp["inat"] for sp in species if sp.get("inat")})
    taxa = {}
    for i in range(0, len(ids), BATCH):
        chunk = ids[i:i + BATCH]
        for t in get("https://api.inaturalist.org/v1/taxa/" + ",".join(map(str, chunk)))["results"]:
            taxa[t["id"]] = t
        time.sleep(1.5)
        print(f"  {min(i + BATCH, len(ids))}/{len(ids)} taxa")

    kept = replaced = removed = missing = 0
    for sp in species:
        t = taxa.get(sp.get("inat"))
        if not t:
            missing += 1
            continue
        photos = [tp["photo"] for tp in t.get("taxon_photos") or [] if tp.get("photo")]
        if t.get("default_photo") and all(p["id"] != t["default_photo"]["id"] for p in photos):
            photos.insert(0, t["default_photo"])
        cur_id = None
        if sp.get("photo"):
            cur_id = sp["photo"]["url"].split("/photos/")[1].split("/")[0] if "/photos/" in sp["photo"]["url"] else None
        cur = next((p for p in photos if str(p["id"]) == cur_id), None)
        if cur and cur.get("license_code") and cur.get("medium_url"):
            sp["photo"] = photo_entry(cur, t["id"], today)
            kept += 1
            continue
        new = next((p for p in photos if p.get("license_code") and p.get("medium_url")), None)
        before = sp.get("photo", {}) or {}
        if new:
            sp["photo"] = photo_entry(new, t["id"], today)
            replaced += 1
            print(f"  replaced {sp['id']}: {before.get('attr', '(none)')[:50]} -> {new.get('attribution', '')[:50]}")
        else:
            if sp.get("photo"):
                removed += 1
                print(f"  no open photo for {sp['id']}: removed")
            sp["photo"] = None
    print(f"kept {kept}, replaced {replaced}, removed {removed}, taxon not found {missing}")
    if write:
        PATH.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print("wrote", PATH)


if __name__ == "__main__":
    main()
