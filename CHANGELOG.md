# Changelog

Each release adds 0.0.1 (1.0.8, 1.0.9, then 1.1.0). 1.0.0 is the first public version.

## 1.9.7 (2026-11-25)
- Long recordings play only their first part: at least 15 seconds, longer for recordings people tend to listen to longer. Less has to load, so it starts sooner. Tap play again when it stops to hear the rest.
- Records how long people listen to each recording before answering (Supabase snippet 15), which sets that part per recording.
- A saved recording that won't play is removed from the device, so it downloads fresh next time.

## 1.9.6 (2026-11-25)
- Cards where you pick from birds look clearly different: a smaller player so the choices fit on the screen, "👇 Tap the bird you hear", green-edged choices in two columns, and no green Reveal button (it's a grey "Show answer"), so it can't be mistaken for the listen-and-reveal card (user feedback).
- The player and spacing scale with the screen height, so short screens and larger text settings fit better.
- A recording that won't load is skipped: the next one is tried by itself.

## 1.9.5 (2026-11-25)
- Less waiting for sounds: small recordings (up to 1 MB) are still downloaded ahead whole; bigger ones are no longer downloaded whole: a hidden player loads their start and plays at once when the card comes (Android; iPhones stream as before). Big files stream straight away instead of after 3 seconds.
- Downloading ahead pauses while the current sound is still loading, so it doesn't slow it down.
- Streamed recordings stay loaded for the session (the last 6), so going back to one plays at once. Downloaded ones stay on the device as before.
- Load times are now counted separately for phones and computers (report 12, from this version on).

## 1.9.4 (2026-11-25)
- Habitat focus: birds of your chosen habitats now all come before the others. Spreading out families could pass over the last few focus birds (e.g. forest raptors) in favour of birds from other habitats.

## 1.9.3 (2026-11-25)
- The rating next to a recording's details updates within minutes (everyone's ratings are fetched every 15 minutes, was 6 hours), and shows your own rating ("★ 4 (yours)") until everyone's totals include it.

## 1.9.2 (2026-11-25)
- Rate / flag fetches everyone's ratings again when they are over 10 minutes old, and a few seconds after you rate, so "Everyone" includes recent ratings (yours too).

## 1.9.1 (2026-11-25)
- Tooltips no longer block buttons underneath them (Rate / flag didn't respond on a computer when a tooltip covered it); only a tooltip long enough to scroll catches the mouse, and clicking it closes it.

## 1.9.0 (2026-11-25)
- Rate / flag opens even when the phone still has an older copy of the page.

## 1.8.9 (2026-11-25)
- Everyone's average rating of a recording (★ 3.8 (5)) also shows with the recording's details on the study card (the bird page already showed it).

## 1.8.8 (2026-11-25)
- Rate / flag: before you rate a recording, the stars show everyone's average rating (lighter), with how many ratings it rests on in brackets.

## 1.8.7 (2026-11-25)
- A recording that is still downloading after 3 seconds (and not nearly done) starts playing straight from xeno-canto while it loads, instead of waiting for the whole file.

## 1.8.6 (2026-11-25)
- Load times only count until the sound is ready and starts by itself; if the phone blocked the sound or it was paused, the time until you tapped play is no longer counted as waiting.

## 1.8.5 (2026-11-25)
- "Next recording": the play button shows it is loading straight away, and the next recording is downloaded earlier (right after the current one) and in the right order, so it usually plays at once.

## 1.8.4 (2026-11-25)
- Dropping a recording for everyone also weighs how many people the share rests on: one person flagging it (1 of 1) only moves it to the back; 2 of 2, 2 of 3 or 5 of 10 drop it.

## 1.8.3 (2026-11-25)
- Every rule based on other people's data now counts a share of the people who encountered it, not a fixed number of people: recordings flagged or rated 1-2 by half of the people who heard them are dropped (less than half: moved down by that share); star averages weigh by the share who rated; right-answer rates count from the first answer; often-mixed-up pairs are judged against the people who know both birds.

## 1.8.2 (2026-11-25)
- Slow recordings are judged by the share of the people who played them who had to wait (1 of 1 counts fully, 2 of 10 a little), not by a fixed number of people (Supabase snippet 14).

## 1.8.1 (2026-11-25)
- Big recordings (over 3 MB, known from anyone's download, or over 2 minutes long before that) move behind smaller ones when the bird has another recording.

## 1.8.0 (2026-11-25)
- Load-time totals also get the file size of recordings that were already saved on the device.

## 1.7.9 (2026-11-25)
- Recordings that several people had to wait for move down the play order when the bird has a quicker one; silver and gold cards play quick, short recordings first (Supabase snippet 13).
- On a slow connection (this device waited on more than 15% of recent cards) the app downloads two at a time and more of the likely next birds.

## 1.7.8 (2026-11-25)
- Hint choices: all 4 are from the same habitats, mixed-up birds included (they come first when they share a habitat). Compare cards for two birds you mix up can still pair birds from different habitats.

## 1.7.7 (2026-11-25)
- Hint choices: only birds other people often mix it up with may come from another habitat; your own mix-ups and sound-alikes must share a habitat, like the other choices.

## 1.7.6 (2026-11-25)
- The sound stops when you turn the screen off, switch to another app or close the app.

## 1.7.5 (2026-11-25)
- Hint choices always include up to 2 birds it is often mixed up with: your own mix-ups first, then the ones other people often mix up, then known sound-alikes, even from another habitat.

## 1.7.4 (2026-11-25)
- "Your data" box wording: location is anonymous (rounded to about 10 km, never saved with your account); shared totals have no name and no email.

## 1.7.3 (2026-11-25)
- Records, per recording, whether its sound started straight away or you had to wait (and how long), plus its file size, for the shared totals (Supabase reports 11 and 12). Only counted for people who share.
- The "shared totals" choice is ticked by default (you can untick it before saving; an earlier choice is kept). Everyone signed in is asked once more, since load times are new.

## 1.7.2 (2026-11-25)
- What's new list trimmed to real new features (no rule tweaks).

## 1.7.1 (2026-11-25)
- "What's new" no longer shows a catch-up list of older features the first time: it starts from the current version for everyone.

## 1.7.0 (2026-11-25)
- "What's new" popup once after an update, with only the changes you'll notice and enjoy. Existing users see the recent highlights once.

## 1.6.9 (2026-11-25)
- Hint choices only offer birds that share a habitat with the bird you hear (mixed-up birds and its own family first); others fill in only when too few share one.

## 1.6.8 (2026-11-25)
- The bird's usual habitats show on new-bird cards, on the answer, and on the guess card as a gentle clue (not on "which of the two?" tests).

## 1.6.7 (2026-11-25)
- The 4 choices now show by themselves until a bird is nearly mastered (4 of 6 points, was 2), and always on the card after you missed it. The last step to mastered is named from memory.

## 1.6.6 (2026-11-25)
- Settings → Colours has two rows: Background (Original cream, the default for new users; Stone, Sand, Mist, White, Black) and Green for buttons, links and highlights (Original, Bushveld, Spring, Jade, Moss, Sage).

## 1.6.5 (2026-11-25)
- "Your data" choices instead of one "I agree": saving progress with your account (always on, needed for an account) and adding your answers anonymously to the shared totals (optional, off until you turn it on). Change it any time in Settings → Account. Everyone signed in is asked once.
- Shared totals and the owner's reports only count accounts that chose to share (Supabase snippet 10).
- "Near me" asks before using your location.
- The "Thanks" message after agreeing is gone.

## 1.6.4 (2026-11-24)
- Buttons, links and highlights are always the original green. Settings → Colours now picks only the background: Cream (the original, default), Stone, Sand, Mist, White or Black. Earlier colour picks move to the nearest background.

## 1.6.3 (2026-11-24)
- Icon links get a new address (?v=orig) so browsers drop their cached copy of the temporary icons and show the original green logo.

## 1.6.2 (2026-11-24)
- While a bird is new or shaky (under 2 points), its cards show the 4 choices straight away ("Pick one"). A right pick earns 1 point like a hint; after 2 right picks you name it from memory, and a miss brings the choices back. Not on silver/gold cards. Settings → Playback can turn it off.

## 1.6.1 (2026-11-24)
- The first green theme is back as "Original", with three variations on it: Bushveld (deeper), Spring (brighter) and Jade (bluer). All on the original cream background.

## 1.6.0 (2026-11-24)
- Privacy agreement: signed-in users who haven't agreed to the current privacy policy are asked once ("I agree", or sign out and keep progress on the device). Signing in from the form counts as agreeing. The agreement is saved with the account, so other devices don't ask again; when the policy changes in a way that affects accounts, everyone is asked again.
- Moss is the default colour theme for anyone who hasn't picked one.

## 1.5.9 (2026-11-24)
- Black colour theme: greys with a black accent; in dark mode true black with a white accent.

## 1.5.8 (2026-11-24)
- The original green logo is back (browser tab and home-screen icon).

## 1.5.7 (2026-11-24)
- Calmer colours: solid, muted themes instead of bright gradients. Five greens (Forest, the new default; Fynbos, Eucalyptus, Moss, Olive) plus Savanna, Terracotta, Ocean, Granite and Dusk. Kalahari, Baobab, Sunbird, Protea and Sky are gone (anyone on them gets Forest). Forest-green icon.

## 1.5.6 (2026-11-24)
- Sunset is the default colour theme for everyone who hasn't picked one (the choice in Settings → Colours is still remembered). Sunset-coloured icon.

## 1.5.5 (2026-11-24)
- Silver and gold need 4 points instead of 6 (clean right +2, with a hint +1, one shared total; a miss at silver/gold costs 1 instead of 2).
- Bird page shows points so far: "3 of 6 so far" while learning, "3 of 4 points" towards the next medal. Tips explain the one-total points.
- Celebration confetti in the new colours (no green).

## 1.5.4 (2026-11-24)
- Five more colour themes: Kalahari (golden sand), Baobab (bark brown-grey), Sunbird (crimson), Sky (bright blue) and Granite (charcoal).

## 1.5.3 (2026-11-24)
- Colour themes in Settings → Colours: Savanna (browns, the new default), Sunset, Protea, Ocean and Dusk (the purple one). Saved with your settings; brown icon.

## 1.5.2 (2026-11-24)
- New look: dusk theme (indigo and sunrise colours, rounded Nunito font, new icon).
- "Skip for later" is now on new-bird cards too. A skipped new bird stays away for 40 cards (it could come straight back when it was the only new bird waiting: the next new bird now joins instead); a skipped met bird waits 20 cards.
- Sounds download ahead: this card's sound first, then the sounds of the cards most likely to come next (including the random recordings of silver/gold checks), then this card's next recording.
- The play button shows a ring filling up while its recording downloads, and plays once it's ready.
- Top line shows medal counts (🥉 🥈 🥇) instead of "n mastered".
- Long tooltips fit the screen and scroll.
- After flagging or low-rating a recording, the replacement plays straight away (with autoplay on).
- Privacy: sign-in form links the privacy policy; the policy now covers shared totals, Near me and POPIA rights. Near me sends a location rounded to about 10 km.

## 1.5.1 (2026-11-22)
- Habitats to focus on (Forest, Woodland & bushveld, Fynbos/karoo & scrub, Grassland, Dry/desert & rocky, Wetlands & rivers, Coast & sea, Gardens & towns): birds of the habitats you pick come first, the rest follow. In the first-start survey and in Settings; the bird page shows each bird's habitats. Data from AVONET (CC BY 4.0) plus hand-added habitats for well-known birds.
- The survey also asks which bird names to use.
- "Experienced" level: varied recordings from the start, so a bird you master earns silver straight away.

## 1.5.0 (2026-11-22)
- Medals per bird: 🥉 bronze = mastered on its 1-2 study recordings; 🥈 silver = its varied sounds (random recordings from its other good ones); 🥇 gold = any recording of it, in random order. A mastered bird's check cards are played at the next medal's level, 3 right (6 with hints) earns it.
- Medals are never taken away, and a mastered bird no longer drops back to learning: a miss only brings it back sooner.
- Medals show on the reveal, the Birds list, the bird page (with how far to the next one) and Progress (counts per medal). Popups for silver and gold.
- Birds mastered before this get bronze; their next check comes within 60 cards.
- Silver/gold answers are counted apart, so harder recordings don't make birds look hard in the shared difficulty data or get recordings dropped.

## 1.4.9 (2026-11-18)
- Streak shows "now/record", e.g. 🔥 3/12, at the top and on the Progress tab (at the top it stays visible after a miss, as 0/12).

## 1.4.8 (2026-11-18)
- Compare cards: the second bird's recording downloads while the first plays, and taps on a play button that is still loading are ignored (they used to resume the previous sound, so it took a few taps).

## 1.4.7 (2026-11-18)
- "‹ Previous" next to "Next recording ›", so you can go back through the recordings too (both wrap around).
- Tap or drag the progress bar to jump to any part of a recording.

## 1.4.6 (2026-11-18)
- Each answer is saved against the recording that was playing. Across everyone, recordings people often get right move up (and can become study recordings); one most people get wrong (under 30% after 8 answers) is dropped like a flagged one. A bird's page shows "Everyone: right N% of M answers". Your own rating always wins. Needs the updated supabase/3-shared-recording-scores.sql.

## 1.4.5 (2026-11-18)
- "You mix these two up" compare cards stop once both birds are mastered (they return if you miss either one again).

## 1.4.4 (2026-11-18)
- Pressing "Other recording" before answering is counted per bird and feeds the shared difficulty: pressing it 3+ times on a bird, and at least once per 2 answers, counts as struggling with it. Needs the updated supabase/9-shared-bird-difficulty.sql.

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
