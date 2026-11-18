#!/usr/bin/env python3
"""Build data/recs/<bird>.json: every xeno-canto recording of each bird made in Africa.

The app's "Other recording" button goes through these after the study recordings, nearest to
the user and best quality first (the app sorts them; it knows where the user is). A bird's file
is only fetched when that button is used, so nothing grows for anyone else.

Only recording metadata is fetched (one request per 500 recordings, throttled); audio is never
downloaded here, the app streams it from xeno-canto. Needs XC_API_KEY in .env.

    python scripts/build_all_recs.py [--only ebirdcode,...] [--budget SECONDS] [--refresh]

Without --refresh, birds that already have a file are skipped, so the script can be run in
chunks (--budget stops it cleanly before a time limit).
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_calls as bc  # noqa: E402  (search helpers, licence and type parsing)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "recs"
MAX_SECS = 180  # longer files are slow to stream on a phone


def fetch_all(query, key):
    """All pages of a xeno-canto search."""
    import urllib.parse
    import urllib.request
    out, page = [], 1
    while True:
        params = urllib.parse.urlencode({"query": query, "key": key, "per_page": 500, "page": page})
        req = urllib.request.Request(f"{bc.API}?{params}", headers={"User-Agent": "bird-sounds-personal-app"})
        data = None
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = json.load(r)
                break
            except Exception as e:
                print(f"  retry {attempt + 1} for {query} p{page}: {e}")
                time.sleep(2 ** (attempt + 2))
        time.sleep(1.5)
        if not data:
            return out
        out += data.get("recordings", [])
        if page >= int(data.get("numPages") or 1):
            return out
        page += 1


def slim(r):
    def coord(v):
        try:
            return round(float(v), 2)
        except (TypeError, ValueError):
            return None
    return {
        "xc": int(r["id"]),  # audio = https://xeno-canto.org/<xc>/download (app rebuilds it)
        "rec": r.get("rec", ""),
        "lic": bc.short_license(r.get("lic")),
        "type": bc.kind(r.get("type")),
        "secs": bc.seconds(r.get("length")),
        "loc": (r.get("loc") or "")[:60],
        "cnt": r.get("cnt", ""),
        "lat": coord(r.get("lat")),
        "lon": coord(r.get("lon") if r.get("lon") is not None else r.get("lng")),
        "q": r.get("q") or "",
        "bg": len(r.get("also") or []),
    }


def main():
    args = sys.argv[1:]
    only = set(args[args.index("--only") + 1].split(",")) if "--only" in args else None
    budget = float(args[args.index("--budget") + 1]) if "--budget" in args else None
    refresh = "--refresh" in args
    started = time.time()
    key = bc.api_key()
    OUT.mkdir(exist_ok=True)
    species = json.loads((DATA / "species.json").read_text(encoding="utf-8"))["species"]
    calls = json.loads((DATA / "calls.json").read_text(encoding="utf-8"))
    todo = [b for b in species if calls.get(b["id"]) and (not only or b["id"] in only)]
    done = 0
    for b in todo:
        path = OUT / f"{b['id']}.json"
        if path.exists() and not refresh:
            continue
        if budget and time.time() - started > budget:
            print(f"budget reached; {done} birds this run")
            break
        gen, sp = b["sci"].split()[:2]
        recs = fetch_all(f"gen:{gen} sp:{sp} area:africa", key)
        if not recs:  # xeno-canto may use another scientific name (IOC taxonomy)
            recs = fetch_all(f'en:"{b["names"]["en_IOC"]}" area:africa', key)
        rows = [slim(r) for r in recs if r.get("file") and r.get("q") != "E" and 0 < bc.seconds(r.get("length")) <= MAX_SECS]
        path.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        done += 1
        print(f"{b['names']['en_ZA']}: {len(rows)} recordings")
    left = sum(1 for b in todo if not (OUT / f"{b['id']}.json").exists())
    print(f"done this run: {done}; birds still to do: {left}")


if __name__ == "__main__":
    main()
