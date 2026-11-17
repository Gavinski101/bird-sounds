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
# Sound notes for the rest of the practice list: shown as "Remember it", but unlike TIPS they
# do NOT make a bird "easy" (they describe the sound; they don't make it stand out).
NOTES = {
    "Cape Bulbul": "Cheerful, liquid whistles \"piet-piet-patata\"; harsh chatter when alarmed. Shorter, quicker phrases than Olive Thrush.",
    "Forest Buzzard": "Thin, high, mewing \"peee-oo\" over the forest.",
    "Black-headed Heron": "Mostly quiet; harsh croaking \"kaaark\" in flight and loud clattering at nests.",
    "Fiscal Flycatcher": "Soft, high, scratchy twittering; much gentler than Southern Fiscal's harsh notes.",
    "Cape Sugarbird": "Scratchy, grating chatter with metallic notes; wings \"frrrt\" in display flight.",
    "Western Cattle Egret": "Mostly silent; low \"rick-rack\" croaks at roosts and nesting colonies.",
    "Swee Waxbill": "Says its name: soft, high \"swee-swee\" from small flocks.",
    "White-throated Swallow": "Pleasant twittering song and short \"vit\" calls, usually near water.",
    "Common Starling": "Wheezes, clicks, whistles and mimicry run together; long falling \"sheeeooo\" whistle.",
    "African Olive Pigeon": "Deep, gruff cooing from the forest canopy; loud wing clatter when it flies off.",
    "Pin-tailed Whydah": "Male's sharp, sibilant \"tseet-tseet-tseet\" while bouncing in display over a female.",
    "Greater Double-collared Sunbird": "Fast, jumbled, scratchy song; harsh \"tchik\" calls. A little slower and lower than Southern Double-collared.",
    "African Dusky Flycatcher": "Very thin, high, single \"tseeet\" notes, like a squeaky gate; not a warbled twitter like Cape White-eye.",
    "Forest Canary": "Soft, rambling canary twitter; quieter and thinner than Cape Canary.",
    "Black-bellied Starling": "Noisy, harsh, squeaky chattering with whistles, from flocks high in the forest.",
    "Southern Fiscal": "Harsh \"gzzzt\" scold; song mixes grating notes with sweet whistles and mimicry.",
    "Bar-throated Apalis": "Loud, fast \"tlip-tlip-tlip\"; pairs duet, one answering the other at a different pitch.",
    "Amethyst Sunbird": "Long, fast twittering song; sharp \"tsip\" calls.",
    "Greater Striped Swallow": "Soft, twittering, slightly guttural song; quieter than Lesser Striped Swallow's nasal notes.",
    "White-necked Raven": "Deep, harsh croaking \"kraak\"; also higher, falsetto notes.",
    "Southern Double-collared Sunbird": "Fast, high, jumbled twittering; sharp \"tchik-tchik\" calls.",
    "Streaky-headed Seedeater": "Slow, sweet, rambling song of clear whistles and twitters.",
    "Cape Batis": "Clear, slow whistles on one pitch plus frog-like rattling \"chrrr\" calls.",
    "Southern Grey-headed Sparrow": "Simple \"cheep, chirp\" chirps, like a House Sparrow but softer.",
    "Grey Heron": "Loud, harsh \"fraank\" in flight.",
    "Olive Woodpecker": "Sharp \"wir-rit\" double note and squeaky calls; seldom drums.",
    "Chorister Robin-Chat": "Rich song full of mimicry, the forest's best mimic; plaintive \"toy-toy-toy\" call.",
    "Red-necked Spurfowl": "Loud, harsh crowing \"kraaa-kraaa-kraaa\", fading away, at dawn and dusk.",
    "Klaas's Cuckoo": "Plaintive \"may-tee, may-tee\", repeated over and over.",
    "Southern Red Bishop": "Male's fizzing, sizzling, buzzy song from reeds.",
    "Karoo Prinia": "Loud, fast \"chlee-chlee-chlee\"; scolding \"tit-tit-tit\" alarm.",
    "Neddicky": "Monotonous fast \"tee-tee-tee-tee\" from a bush top, going on and on.",
    "Bleating Camaroptera": "Goat-like bleat \"neeehh\" and a loud snapping \"tic-tic-tic\".",
    "Olive Thrush": "Clear, fluty phrases, each often repeated; slower and more deliberate than Cape Robin-Chat or Cape Bulbul. Thin \"tseep\" call.",
    "Cape Wagtail": "Cheerful, clear \"tseee-chee-chee\"; bright twittering song.",
    "Black-backed Puffback": "Sharp \"chick-weeu\" and loud clicks; wings make a soft \"puff\" in display.",
    "African Stonechat": "Scratchy short song; call like two stones knocked together: \"weet-tsak-tsak\".",
    "Olive Bushshrike": "Ringing, fluty \"tew-tew-tew-tew\" whistles and a harsh churr.",
    "Cape Robin-Chat": "Short sweet phrases \"cheroo-weet-weet\", often with mimicry; growling \"wur-da-wur\" alarm.",
    "Common Waxbill": "Nasal, twanging \"chip-chip-tcheeer\" from flocks in long grass.",
    "Black Saw-wing": "Mostly quiet; soft \"chrrp\" calls while hawking along forest edges.",
    "Brimstone Canary": "Rich, slow, deep canary song; heavier than Cape Canary's.",
    "Speckled Pigeon": "Deep, booming \"hooo-hooo-hooo\" rising then falling, from roofs and cliffs.",
    "Yellow-throated Woodland Warbler": "Rapid descending \"seee-sip-sip-sip-sip\" from high in the forest.",
    "Barn Swallow": "Twittering, chattering song and \"vit-vit\" calls. Summer visitor.",
    "Cape Canary": "Long, fast, rolling canary song full of trills, from tree tops.",
    "Yellow Bishop": "Male's sizzling, buzzy display song; harsh \"zeet\" calls.",
    "Terrestrial Brownbul": "Chattering, grumbling \"chuck-chuck-chirrr\" from parties in the undergrowth.",
    "Red-winged Starling": "Loud, melodious whistled \"cher-leeeoo\"; flocks very vocal.",
    "Grey Sunbird": "Dry \"tsik-tsik-tsik\" repeated monotonously.",
    "Common Buzzard": "Mewing \"peeeooo\", like a cat.",
    "Knysna Woodpecker": "Shrill, high \"kreeee\" scream.",
    "Black Cuckooshrike": "Long, insect-like trill \"trrrrrrr\" lasting several seconds.",
    "Grey Cuckooshrike": "Very thin, high \"tseeeep\" calls; easily missed.",
    "African Emerald Cuckoo": "Clear whistle \"Hel-lo Geor-gie\" (or \"Pret-ty Geor-gie\").",
    "Blue-mantled Crested Flycatcher": "Rasping, buzzy scolds and a fast, sweet twittering song.",
    "Victorin's Warbler": "Loud, sweet, accelerating song from dense fynbos; very hard to see.",
    "African Paradise Flycatcher": "Rasping \"zwee-zwer\" scold; lively, fast \"tswee-tswee-tswee\" song.",
    "White-rumped Swift": "Mostly quiet; soft twittering at nests under bridges and eaves.",
    "Cape Grassbird": "A few slow notes, then a fast jumble of tinkling notes from a grass or bush top.",
    "Large Rock Martin": "Mostly silent; soft twittering near cliffs and buildings.",
    "African Palm Swift": "Thin, high, twittering screams around palm trees.",
    "African Pipit": "Repeated \"chrip-chrip-chrip\" in display flight; \"chissik\" flight call.",
    "Plain-backed Pipit": "Repeated two-note song from a perch; hard to tell from African Pipit.",
    "Alpine Swift": "Loud, shrill trilling screams from flocks, falling in pitch.",
    "Lesser Striped Swallow": "Nasal, descending \"zeh-zeh-zeh-zeh\"; common around houses.",
    "Red-chested Flufftail": "Hooting \"woo-woo-woo-woo\" from dense reeds, often at night; seldom seen.",
    "Malachite Sunbird": "Loud, jumbled twittering; sharp \"tseep\" call.",
    "African Firefinch": "Fast, rolling \"trrrrt\" trill and a clear \"vee-vee\" call.",
    "Black-winged Kite": "Thin, high \"weeeep\" whistle; mostly quiet.",
    "African Black Swift": "Shrill screams around cliffs, flocks screaming at dusk.",
    "Jacobin Cuckoo": "Loud, ringing \"kleeuw, kleeuw\" and a fast, bubbling \"pewpewpew\" in summer.",
    "Levaillant's Cuckoo": "Loud, rising \"kow-kow-kow-kow\" followed by a harsh, chattering \"chi-chi-chi-cherrrr\".",
    "African Cuckoo": "Soft, two-note \"hoop-hoop\", the second note lower; like a hoopoe but slower.",
    "Little Rush Warbler": "Dry \"trrp-trrp-trrp\" notes speeding up into a rattle, like a bouncing ball, often with wing-snaps, from reedbeds.",
    "Tambourine Dove": "Long run of soft \"du-du-du\" coos, slow then faster and fading, staying on one pitch (Emerald-spotted Wood Dove's falls away at the end).",
}

# The user's iconic sounds of their area (2026-11-17): ease 0, met before every other bird
# (if common enough in the region, see ICONIC_CAP in app.js).
ICONIC = {
    "Southern Boubou", "Burchell's Coucal", "Jackal Buzzard", "Black-headed Oriole", "Narina Trogon",
    "Red-chested Flufftail", "Buff-spotted Flufftail", "Knysna Turaco", "Little Rush Warbler",
    "Hadeda Ibis", "Tambourine Dove", "Bar-throated Apalis", "Fork-tailed Drongo", "Cape Batis",
    "Southern Fiscal",
    # Cuckoos (user: "all the cuckoos have distinct iconic sounds"). Not Common Cuckoo: mostly
    # silent while in Africa.
    "Red-chested Cuckoo", "Black Cuckoo", "Diederik Cuckoo", "Klaas's Cuckoo", "African Emerald Cuckoo",
    "Jacobin Cuckoo", "Levaillant's Cuckoo", "African Cuckoo",
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
    missing = [n for n in [*TIPS, *NOTES, *ICONIC, *EASY_EXTRA, *(n for p in SIMILAR for n in p)] if n not in by_name]
    if missing:
        raise SystemExit(f"names not in species.json (en_ZA): {sorted(set(missing))}")

    easy = (set(TIPS) - TIP_NOT_EASY) | EASY_EXTRA
    birds = {}
    for b in species:
        n = b["names"]["en_ZA"]
        ease = 0 if n in ICONIC else 1 if n in easy else 3 if b["family"] in SIMILAR_FAMILIES else 4 if b["family"] in QUIET_FAMILIES else 2
        e = {"ease": ease}
        if n in TIPS or n in NOTES:
            e["tip"] = TIPS.get(n) or NOTES[n]
        birds[b["id"]] = e
    similar = [[by_name[a]["id"], by_name[b]["id"]] for a, b in SIMILAR]
    (DATA / "guide.json").write_text(json.dumps({"birds": birds, "similar": similar}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    counts = {k: sum(1 for e in birds.values() if e["ease"] == k) for k in (0, 1, 2, 3, 4)}
    print(f"guide.json: ease counts {counts}, {sum(1 for e in birds.values() if 'tip' in e)} memory aids, {len(similar)} sound-alike pairs")


if __name__ == "__main__":
    main()
