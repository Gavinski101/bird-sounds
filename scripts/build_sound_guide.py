#!/usr/bin/env python3
"""Build data/guide.json: how easy each bird is to tell apart by ear, sound-alike pairs and
memory aids. Hand-made (no API calls); names are en_ZA names from data/species.json and are
checked here, so a typo fails the build instead of silently dropping a bird.

ease: 1 = distinctive (hand-picked), 2 = average, 3 = family of similar-sounding birds,
      4 = rarely heard or calls that are hard to use (seen far more often than heard).
The app orders new birds by area rank x an ease factor ("Easiest to tell apart first").

    python scripts/build_sound_guide.py
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"

# Families whose members sound alike (cisticolas, larks, pipits...).
SIMILAR_FAMILIES = {
    "Cisticolas and Allies", "Larks", "Wagtails and Pipits", "Sandpipers and Allies",
    "Gulls, Terns, and Skimmers", "Weavers and Allies", "Waxbills and Allies",
    "Whydahs and Indigobirds", "Swallows", "Swifts", "Reed Warblers and Allies",
    "Grassbirds and Allies", "Sunbirds and Spiderhunters", "Finches, Euphonias, and Allies",
    "Old World Buntings", "Sylviid Warblers and Allies", "African Longbills, Crombecs, and Allies",
    "Pratincoles and Coursers", "Old World Sparrows",
}
# Families seen far more often than heard, or with rough, hard-to-learn calls.
QUIET_FAMILIES = {
    "Herons, Egrets, and Bitterns", "Storks", "Cormorants and Shags", "Ducks, Geese, and Waterfowl",
    "Hawks, Eagles, and Kites", "Falcons and Caracaras", "Pelicans", "Ibises and Spoonbills",
    "Shearwaters and Petrels", "Anhingas", "Flamingos", "Grebes", "Vultures", "Secretarybird",
}

# Memory aids. Birds here count as distinctive (ease 1) unless listed in TIP_NOT_EASY.
TIPS = {
    "Hadeda Ibis": "Loud, raucous \"ha-ha-ha-de-dah\", often in flight at dawn and dusk.",
    "African Fish Eagle": "Ringing, far-carrying \"weee-ah, hyo-hyo-hyo\" with the head thrown back: the sound of African rivers and dams.",
    "Cape Turtle (Ring-necked) Dove": "\"Work HAR-der, work HAR-der\", over and over.",
    "Red-eyed Dove": "\"I AM... a red-eyed dove\": two notes, a pause, then four.",
    "Laughing Dove": "Soft, chuckling \"coo-coo-COO-coo-coo\" that rises and falls, like a quiet laugh.",
    "Emerald-spotted Wood Dove": "Slow, sad hoots that speed up and tumble down: \"my mother is dead, my father is dead, all my relatives are dead, oh, oh, oh-oh-oh\".",
    "Red-chested Cuckoo": "Three loud falling notes, \"it-will-rain\", repeated all day (and night) in summer.",
    "Black Cuckoo": "Mournful \"I'm so sick\", repeated, the last note slurred upward.",
    "Diederik Cuckoo": "Says its name: a clear, rising \"dee-dee-dee-deederik\".",
    "Fiery-necked Nightjar": "Tremulous whistle at night: \"Good Lord, deliver us\".",
    "Burchell's Coucal": "Bubbling \"doo-doo-doo...\" that falls then rises, like water poured from a bottle. Often calls before rain.",
    "Grey Go-away-bird": "Nasal, drawn-out \"go-waaay\": its name.",
    "Common Hoopoe": "Soft, far-carrying \"hoop-hoop\" or \"hoop-hoop-hoop\".",
    "Green Wood-hoopoe": "A group cackling together, building to a frenzy, like a crowd of laughing people.",
    "Southern Ground Hornbill": "Deep booming \"oomph, oomph\" at dawn, easily mistaken for a distant lion.",
    "Trumpeter Hornbill": "Loud wailing, like a crying baby.",
    "Southern Yellow-billed Hornbill": "Hollow \"tok-tok-tok\" that speeds up, the bird bowing with wings half open.",
    "Crested Barbet": "Long, even trill that goes on and on, like an old alarm clock.",
    "Black-collared Barbet": "A pair duets \"too-puddly, too-puddly\", bobbing as they call.",
    "Yellow-fronted Tinkerbird": "Endless \"tink-tink-tink\", like a tiny hammer on metal.",
    "Southern Red-fronted Tinkerbird": "Endless \"tink-tink-tink\" or \"pop-pop-pop\", like a tiny hammer on metal.",
    "Blacksmith Lapwing": "Sharp \"tink-tink-tink\", like a blacksmith's hammer on an anvil.",
    "Spotted Thick-knee": "At night: \"ti-ti-ti-TEE-TEE-TEE-ti-ti-ti\", rising then falling away.",
    "Helmeted Guineafowl": "Harsh, rattling \"kek-kek-kek-krrrrr\" from the flock, and a repeated \"buck-wheat\".",
    "Cape Spurfowl": "Loud, harsh crowing \"cackalac-cackalac\", mostly at dawn and dusk.",
    "Swainson's Spurfowl": "Harsh, grating \"krraae-krraae-krraae\" from a perch at dawn and dusk.",
    "Sombre Greenbul": "A loud \"Willie!\" from deep in a bush, often followed by a bubbling phrase: \"Willie, come out and fight... scaaared\".",
    "Dark-capped Bulbul": "Cheerful, bubbly whistles, \"sweet, sweet potato\".",
    "White-browed Robin-Chat": "Rising crescendo, louder each time: \"it's-up-to-YOU, it's-up-to-YOU\".",
    "Chinspot Batis": "Three falling notes, like \"three blind mice\".",
    "Southern Boubou": "A pair duets so fast it sounds like one bird: a clear whistle answered at once by a croak or click.",
    "Tropical Boubou": "A pair duets so fast it sounds like one bird: bell-like whistles answered at once by a croak.",
    "Bokmakierie": "A pair duets its name: \"bok-bok-mak-kiri\".",
    "Brubru": "Trilled \"prrrrrrt\", like an old telephone ringing.",
    "Grey-headed Bushshrike": "Long, mournful \"hooooo\", hence its nickname \"ghost bird\".",
    "Orange-breasted Bushshrike": "\"Poo-poo-poo-pooooo\", or \"coffee-tea-or-meee\".",
    "Fork-tailed Drongo": "Metallic twangs and squeaks; a great mimic, often calling before dawn.",
    "Black-headed Oriole": "Liquid, fluty \"pooodle-oo\".",
    "Pied Crow": "Hoarse, loud \"kwaak\".",
    "Woodland Kingfisher": "\"Tri-trrrrrrrr\": one sharp note then a long falling trill.",
    "Brown-hooded Kingfisher": "Ringing \"ki-ki-ki-ki\" that falls in pitch.",
    "Pearl-spotted Owlet": "A run of whistles rising in pitch, then loud falling \"tseeu, tseeu\" notes, often by day.",
    "Spotted Eagle-Owl": "Soft hoots at night: \"hoo-hoo\" from the male, answered \"hoo-hoo-hoo\".",
    "African Wood Owl": "\"Who-are-YOU... who-who\", in the forest at night.",
    "African Scops Owl": "Frog-like \"prrrp\" every few seconds, all night.",
    "Western Barn Owl": "Eerie, drawn-out screech at night.",
    "Knysna Turaco": "Hoarse, croaking \"kow-kow-kow-kow\" from the forest canopy.",
    "Purple-crested Turaco": "Loud, far-carrying \"kok-kok-kok-kok\".",
    "Narina Trogon": "Deep, hoarse \"hoo-hoo\" repeated, the throat puffing out.",
    "Arrow-marked Babbler": "A group's raucous, cackling chatter, all calling at once.",
    "Black-bellied Korhaan": "A short \"kwick\", a pause, then a \"pop\" like a cork from a bottle.",
    "Buff-spotted Flufftail": "Low, mournful hoot at night in forest, like a distant foghorn.",
    "Knysna Warbler": "Loud song from a thicket that speeds up and ends in a trill.",
    "Jackal Buzzard": "Yelping \"kyaah\", like a jackal.",
    "African Penguin": "Loud braying, like a donkey.",
    "Grey Crowned Crane": "Honking two-note \"may-hem\".",
    "Zitting Cisticola": "\"Zit... zit... zit\" with each dip of its bouncing display flight.",
    "Cape Longclaw": "Cat-like mewing \"meeu\" from the grass.",
    "Common Ostrich": "Deep booming roar at night, like a lion.",
    "Egyptian Goose": "Loud honking and hissing, usually from a pair.",
    "Crowned Lapwing": "Shrill, scratchy \"kreeep\" calls, also at night.",
    "Rufous-naped Lark": "Plaintive whistled \"tsee-tseeoo\" from the top of a bush.",
    "Cape White-eye": "Thin, warbled twittering; flocks keep up soft \"tseee\" contact calls.",
    "Cape Weaver": "Harsh, wheezy swizzling chatter around the nests.",
    "Speckled Mousebird": "Twittering \"tsik-tsik\" chatter from the group as they fly from bush to bush.",
}
# Have a memory aid, but still easy to confuse: keep their family's ease.
TIP_NOT_EASY = {
    "Cape White-eye", "Cape Weaver", "Speckled Mousebird", "Zitting Cisticola", "Rufous-naped Lark",
    "Cape Longclaw", "Crowned Lapwing",
}
# Distinctive by ear but no memory aid written yet.
EASY_EXTRA = {
    "Klaas's Cuckoo", "Jacobin Cuckoo", "Levaillant's Cuckoo", "Common Cuckoo", "African Cuckoo",
    "Rufous-cheeked Nightjar", "Square-tailed Nightjar", "African Grey Hornbill", "Crowned Hornbill",
    "Acacia Pied Barbet", "Cape Robin-Chat", "Red-capped Robin-Chat", "Chorister Robin-Chat",
    "Southern Black Flycatcher", "African Paradise Flycatcher", "Black-backed Puffback",
    "Southern Tchagra", "Black-crowned Tchagra", "Olive Bushshrike", "Red-winged Starling",
    "Grey Crowned Crane", "Blue Crane", "Hamerkop", "Lilac-breasted Roller", "European Bee-eater",
    "Natal Spurfowl", "Crested Francolin", "Red-billed Spurfowl", "Northern Black Korhaan",
    "Southern Black Korhaan", "Red-crested Korhaan", "Bar-throated Apalis", "Cape Batis",
}

# Pairs that sound alike: never introduced close together, and shown on the bird page.
# The first four are the user's own mix-ups (2026-11-16).
SIMILAR = [
    ("Olive Thrush", "Cape Bulbul"),
    ("Cape White-eye", "African Dusky Flycatcher"),
    ("Olive Thrush", "Cape Robin-Chat"),
    ("Speckled Mousebird", "Cape Weaver"),
    ("Cape Turtle (Ring-necked) Dove", "Red-eyed Dove"),
    ("Emerald-spotted Wood Dove", "Tambourine Dove"),
    ("Southern Boubou", "Tropical Boubou"),
    ("Cape Bulbul", "Dark-capped Bulbul"),
    ("Yellow-fronted Tinkerbird", "Southern Red-fronted Tinkerbird"),
    ("Cape Spurfowl", "Swainson's Spurfowl"),
]


def main():
    species = json.loads((DATA / "species.json").read_text(encoding="utf-8"))["species"]
    by_name = {b["names"]["en_ZA"]: b for b in species}
    missing = [n for n in [*TIPS, *EASY_EXTRA, *(n for p in SIMILAR for n in p)] if n not in by_name]
    if missing:
        raise SystemExit(f"names not in species.json (en_ZA): {sorted(set(missing))}")

    easy = (set(TIPS) - TIP_NOT_EASY) | EASY_EXTRA
    birds = {}
    for b in species:
        n = b["names"]["en_ZA"]
        ease = 1 if n in easy else 3 if b["family"] in SIMILAR_FAMILIES else 4 if b["family"] in QUIET_FAMILIES else 2
        e = {"ease": ease}
        if n in TIPS:
            e["tip"] = TIPS[n]
        birds[b["id"]] = e
    similar = [[by_name[a]["id"], by_name[b]["id"]] for a, b in SIMILAR]
    (DATA / "guide.json").write_text(json.dumps({"birds": birds, "similar": similar}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    counts = {k: sum(1 for e in birds.values() if e["ease"] == k) for k in (1, 2, 3, 4)}
    print(f"guide.json: ease counts {counts}, {len(TIPS)} memory aids, {len(similar)} sound-alike pairs")


if __name__ == "__main__":
    main()
