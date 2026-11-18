# Changelog

Each release adds 0.0.1 (1.0.8, 1.0.9, then 1.1.0). 1.0.0 is the first public version.

## 1.4.3 (2026-11-18)
- "Other recording" now goes through every xeno-canto recording of the bird made in Africa (39,000 in all), nearest to your region and best quality first, after your study recordings. Each bird's list is only downloaded when you use the button. The recording line shows how far away it was recorded.
- Rate any of them 4-5 stars to make it one of your study recordings.

## 1.4.2 (2026-11-17)
- Re-line-up: birds in play now follow the current order. Met birds far down the order (e.g. weavers and white-eyes lined up before the iconic-first order) are set aside as "Later" with their progress kept, and come back when the order reaches them; mastered and nearly mastered birds stay.
- Shared difficulty scales with the number of users: a bird is hard when at least half of those who answered it 3+ times miss it more than they get it right; a pair counts when a quarter of users mixed it up twice (with one user, that user is the whole base).

## 1.4.1 (2026-11-17)
- Shared difficulty: a bird that 3+ people (and at least half of those who answered it 3+ times) miss more often than they get right moves one group later for new learners; pairs 3+ people mix up are kept apart and used as hint choices. Your iconic birds never move. Needs supabase/9-shared-bird-difficulty.sql.
- Removed the keyboard shortcuts (typing elsewhere while the app had focus answered cards).

## 1.4.0 (2026-11-17)
- Birds waiting in your study set that you haven't met yet are re-picked in the current order (and on every region or order change), so the iconic-first order applies straight away instead of after old picks like Southern Masked Weaver. Birds you've met keep their progress.

## 1.3.9 (2026-11-17)
- Clearer flag reasons, each with a short explanation: Not its typical sound, Sounds like other birds, Other sounds in the way, Bad recording, Wrong bird.
- A bird's page shows why a recording was flagged, and its flag link opens the same choices.

## 1.3.8 (2026-11-17)
- More new birds, less getting stuck: a new bird joins at least every 15 cards (every 30 while 3+ birds are a struggle, instead of none at all); "struggling" now means doing badly now (score 0 or below), not missed as often as got right over all time; a bird missed twice in a row rests about 8 cards instead of coming straight back. In a simulation of 300 cards: 25 birds met instead of 19, and the 3 most-shown birds take 33% of cards instead of 43%.

## 1.3.7 (2026-11-17)
- Cuckoos join the iconic sounds that come first: Red-chested, Black, Diederik, Klaas's, African Emerald, Jacobin, Levaillant's and African Cuckoo. New sound notes for Jacobin, Levaillant's and African Cuckoo.

## 1.3.6 (2026-11-17)
- Iconic sounds come first of all: Southern Boubou, Burchell's Coucal, Jackal Buzzard, Black-headed Oriole, Narina Trogon, both flufftails, Knysna Turaco, Little Rush Warbler, Hadeda, Tambourine Dove, Bar-throated Apalis, Fork-tailed Drongo, Cape Batis and Southern Fiscal (when among the region's 250 commonest).
- Sound notes for Little Rush Warbler and Tambourine Dove.

## 1.3.5 (2026-11-17)
- "Easiest to tell apart first" now really puts distinctive sounds first: all distinctive birds among the region's 150 commonest come before average ones, and similar-sounding families come last (before, common look-alikes like Cape Weaver still beat Hadeda).

## 1.3.4 (2026-11-16)
- Region switch: compare cards, hint choices, "Birds you mix up" and "Birds you miss most" now only use birds of the current region (counts and cards already did). Progress on birds outside the region is kept for when you switch back.

## 1.3.3 (2026-11-16)
- Compare cards ("You mix these two up") are now just a reminder. The "Which of the two?" test comes 3-5 cards later and plays a random one of the pair, not always the first one heard.
- "Skip for later": a met bird comes back about 8 cards later; on a new-bird card it moves that bird to the back of the queue.
- Version number sits just above the tab bar.

## 1.3.2 (2026-11-16)
- Progress keeps a small per-day log (answers, birds mastered) and how many cards each bird took to master, for the owner's anonymous usage reports (supabase/reports.sql).

## 1.3.1 (2026-11-16)
- Flag reason reworded: "Can't hear the bird / too many sounds / noise".

## 1.3.0 (2026-11-16)
- New flag reason: "Too many other sounds (birds, noise)".

## 1.2.9 (2026-11-16)
- Shared flags and ratings: a recording 2+ signed-in people flagged (or rated 1-2) is dropped for everyone; average ratings order the rest. Your own rating, flag or "Use anyway" always wins. Needs rec_scores() from supabase/setup.sql.
- Volume is now a small speaker icon next to the progress bar; the slider slides out on hover or tap, and follows a loudness curve so the whole range is audible.
- Hints show a "Sound clue" (the bird's memory aid, with words from the options' names hidden) above the choices.

## 1.2.8 (2026-11-16)
- Volume slider under the play bar, remembered per device. Hidden on iPhone/iPad, where only the phone's volume buttons work.

## 1.2.7 (2026-11-16)
- "Remember it" sound notes for the 71 practice-list birds that had none (136 birds in all), so intro cards show one. Learning order unchanged.

## 1.2.6 (2026-11-16)
- "Can sound like" replaced by "You often mix it up with", built only from your own mix-ups (2+ times). The bird page says "You've mixed it up with".

## 1.2.5 (2026-11-16)
- New learning order "Easiest to tell apart first" (default; also in the survey and Settings): common birds with distinctive calls come first, and birds that sound alike are spread out.
- "Remember it" memory aids and "Can sound like" notes after you answer and on each bird's page.
- Progress: "Birds you mix up" and "Birds you miss most", with play buttons to compare.
- Hints use sound-alike birds as choices.
- Big Bird Day countdown removed.

## 1.2.4 (2026-11-16)
- Version numbers start at 1.0.0 for the first public version.

## 1.2.3 (2026-11-13)
- Signing out or deleting your account goes back to the welcome screen.

## 1.2.2 (2026-11-13)
- Version number shown small and faint at the bottom of the screen.

## 1.2.1 (2026-11-13)
- Settings: region picked from the same tree-and-search list as the survey (Android's dropdown wrapped long names).

## 1.2.0 (2026-11-13)
- Region search results tidier on phones.

## 1.1.9 (2026-11-12)
- Full app: 853 Southern African birds, 52 regions, Near me.
- iNaturalist recordings where xeno-canto has none.

## 1.1.8 (2026-11-12)
- Fixed the wrong bird's sound or photo after quick answers.
- No new birds while three or more met birds are still a struggle.

## 1.1.7 (2026-11-12)
- Full-size bird photos again; answer buttons stay pinned in reach.

## 1.1.6 (2026-11-12)
- Hints offer 4 birds instead of naming the family.

## 1.1.5 (2026-11-12)
- Streak counts birds right in a row, with a record.

## 1.1.4 (2026-11-12)
- Sync no longer swaps the current card; faster, smoother audio.

## 1.1.3 (2026-11-12)
- Profile circle in the page corner on desktop.

## 1.1.2 (2026-11-12)
- Bird photos scaled to fit instead of cropped.

## 1.1.1 (2026-11-12)
- Answer buttons stay in view on small screens.

## 1.1.0 (2026-11-12)
- Profile circle; delete my account.

## 1.0.9 (2026-11-12)
- Forgot password.

## 1.0.8 (2026-11-12)
- Google sign-in.

## 1.0.7 (2026-11-12)
- Privacy policy page.

## 1.0.6 (2026-11-12)
- Choose a region or sub-region.

## 1.0.5 (2026-11-12)
- Separate sign-in and create-account tabs; replay the welcome screen and survey.

## 1.0.4 (2026-11-12)
- First-open survey: experience level and region.

## 1.0.3 (2026-11-12)
- Welcome screen with sign-in on first open.

## 1.0.2 (2026-11-12)
- Email and password sign-in.

## 1.0.1 (2026-11-12)
- Sign in and sync progress across devices.

## 1.0.0 (2026-11-12)
- First public version: learn George / Wilderness birds by sound.
