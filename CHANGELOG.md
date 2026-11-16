# Changelog

Each release adds 0.0.1 (1.0.8, 1.0.9, then 1.1.0). 1.0.0 is the first public version.

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
