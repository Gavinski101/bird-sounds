#!/usr/bin/env python3
"""Build data/calls.json: ranked xeno-canto recordings for every bird in data/species.json.

Only recording metadata is fetched (one or two API requests per bird, throttled);
audio files are never downloaded here. The app plays them from xeno-canto.

Each bird gets up to 8 candidates, best first. The first two are the default
"distinctive" picks; the rest are spares the app promotes when a clip is flagged
or rated low.

Needs the xeno-canto API key in .env (XC_API_KEY=...) or the environment:
    python scripts/build_calls.py [--only ebirdcode,ebirdcode]
"""
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
API = "https://xeno-canto.org/api/3/recordings"
HOME = (-33.97, 22.52)  # George / Wilderness
SOUTHERN_AFRICA = {"South Africa", "Namibia", "Botswana", "Zimbabwe", "Lesotho", "Eswatini", "Mozambique"}
KEEP = 8


def api_key():
    if os.environ.get("XC_API_KEY"):
        return os.environ["XC_API_KEY"]
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("XC_API_KEY="):
                return line.split("=", 1)[1].strip()
    sys.exit("XC_API_KEY not set (put it in .env)")


def search(query, key):
    params = urllib.parse.urlencode({"query": query, "key": key, "per_page": 500})
    req = urllib.request.Request(f"{API}?{params}", headers={"User-Agent": "bird-sounds-personal-app"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            time.sleep(1.5)
            return data.get("recordings", [])
        except Exception as e:
            print(f"  retry {attempt + 1} for {query}: {e}")
            time.sleep(2 ** (attempt + 2))
    return []


def seconds(length):
    total = 0
    for p in (length or "0").split(":"):
        total = total * 60 + (int(p) if p.isdigit() else 0)
    return total


def km(lat, lon):
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    la1, lo1, la2, lo2 = map(math.radians, (HOME[0], HOME[1], lat, lon))
    a = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def short_license(url):
    m = re.search(r"licenses/([a-z-]+)/([\d.]+)", url or "")
    return f"CC {m.group(1).upper()} {m.group(2)}" if m else "CC"


def kind(raw):
    raw = (raw or "").lower()
    if "song" in raw or "duet" in raw:
        return "song"
    if "alarm" in raw:
        return "alarm"
    if "flight" in raw:
        return "flight call"
    if "call" in raw:
        return "call"
    return "sound"


def usable(r):
    secs = seconds(r.get("length"))
    is_mp3 = (r.get("file-name") or "").lower().endswith(".mp3")
    if not r.get("file") or r.get("q") not in ("A", "B"):
        return False
    if secs < 3 or secs > 90:
        return False
    if not is_mp3 and secs > 30:  # WAV is ~5-10x larger than MP3; keep only short ones
        return False
    return True


def score(r, common_kind):
    secs = seconds(r.get("length"))
    s = 3 if r.get("q") == "A" else 1
    d = km(r.get("lat"), r.get("lon"))
    if d is not None and d < 150:
        s += 4  # local dialect
    elif d is not None and d < 700:
        s += 2.5
    elif r.get("cnt") in SOUTHERN_AFRICA:
        s += 1.5
    also = len(r.get("also") or [])
    s += 2 if also == 0 else -0.6 * also  # other birds in the clip make it ambiguous
    s += 2 if 4 <= secs <= 35 else 0.5 if secs <= 60 else 0
    s += 1 if (r.get("file-name") or "").lower().endswith(".mp3") else 0
    if kind(r.get("type")) == common_kind:
        s += 1.5  # most often recorded sound type = the bird's typical sound
    if (r.get("playback-used") or "").lower() == "yes":
        s -= 1
    if (r.get("auto") or "").lower() == "yes":
        s -= 0.5
    if re.search(r"noise|traffic|wind|distant|faint", (r.get("rmk") or "").lower()):
        s -= 1
    return s


def slim(r, sc):
    return {
        "xc": int(r["id"]),
        "file": r["file"],
        "rec": r.get("rec", ""),
        "lic": short_license(r.get("lic")),
        "type": kind(r.get("type")),
        "rawType": r.get("type", ""),
        "secs": seconds(r.get("length")),
        "loc": r.get("loc", ""),
        "cnt": r.get("cnt", ""),
        "also": len(r.get("also") or []),
        "q": r.get("q"),
        "score": round(sc, 1),
    }


def pick(recs):
    good = [r for r in recs if usable(r)]
    if not good:
        return []
    common = Counter(kind(r.get("type")) for r in good).most_common(1)[0][0]
    ranked = sorted(good, key=lambda r: score(r, common), reverse=True)
    first = ranked[0]
    # Second pick: best clip of a different sound type if it is nearly as good,
    # otherwise the best clip by a different recordist (a different individual bird).
    rest = ranked[1:]
    second = next((r for r in rest if kind(r.get("type")) != kind(first.get("type"))
                   and score(r, common) >= score(first, common) - 3), None)
    second = second or next((r for r in rest if r.get("rec") != first.get("rec")), None) or (rest[0] if rest else None)
    order = [first] + ([second] if second else []) + [r for r in rest if r is not second]
    return [slim(r, score(r, common)) for r in order[:KEEP]]


def main():
    key = api_key()
    only = None
    if "--only" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only") + 1].split(","))
    species = json.loads((DATA / "species.json").read_text(encoding="utf-8"))["species"]
    out_path = DATA / "calls.json"
    calls = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {}
    for b in species:
        if only and b["id"] not in only:
            continue
        gen, sp = b["sci"].split()[:2]
        recs = search(f"gen:{gen} sp:{sp} area:africa", key)
        if len([r for r in recs if usable(r)]) < 4:
            recs += search(f"gen:{gen} sp:{sp}", key)
        if not recs:  # xeno-canto may use another scientific name (IOC taxonomy)
            recs = search(f'en:"{b["names"]["en_IOC"]}"', key)
        seen, uniq = set(), []
        for r in recs:
            if r["id"] not in seen:
                seen.add(r["id"])
                uniq.append(r)
        picks = pick(uniq)
        calls[b["id"]] = picks
        top = ", ".join(f"XC{p['xc']} {p['type']} {p['secs']}s" for p in picks[:2])
        print(f"{b['names']['en_ZA']:34} {len(uniq):4} found  -> {top or 'NONE'}")
        out_path.write_text(json.dumps(calls, ensure_ascii=False, indent=1), encoding="utf-8")
    missing = [b["names"]["en_ZA"] for b in species if not calls.get(b["id"])]
    print(f"done; no recordings for: {missing or 'none'}")


if __name__ == "__main__":
    main()
