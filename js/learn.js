// Scheduling and progression. Pure functions over a plain state object so the
// rules can be tested in Node (scripts/test-learn.mjs).
//
// Each bird has a score. Got it adds 2 (1 if a hint was used), Missed it takes 2.
// At MASTER_SCORE the bird is mastered and comes back at growing intervals; getting
// a mastered bird right again is "remembered", missing it drops it back to learning.
// Time is counted in cards, not days, so the order adapts to how much you study.

export const START_POOL = 20;
export const MASTER_SCORE = 6;
export const MIN_LEARNING = 8;   // unlock more birds when fewer than this are still being learned
export const UNLOCK_STEP = 5;
export const FIRST_INTERVAL = 15;
export const MAX_INTERVAL = 400;
export const REVIEW_SHARE = 0.25;
export const MAX_STRUGGLING = 3; // no new birds while this many met birds are still a struggle
export const NEW_EVERY = 15;     // a new bird at least this often (in cards)...
export const NEW_EVERY_STRUGGLING = 30; // ...or this often while MAX_STRUGGLING+ birds are a struggle
export const MISS_REST = 8;      // a bird missed twice in a row rests this many cards (+0-2)
export const PAIR_EVERY = 8;   // at most one compare card per this many cards
export const PAIR_MIN = 2;     // mix-ups (either direction) before a pair gets compare cards
export const PAIR_REST = 25;   // cards before the same pair comes up again

export function newState() {
  return { v: 1, n: 0, pool: [], birds: {}, lastId: null, sinceIntro: 99, history: [], mix: {}, pairShown: {}, sincePair: 0 };
}

function bird(state, id) {
  if (!state.birds[id]) {
    state.birds[id] = { s: 0, intro: false, due: 0, m: false, iv: 0, right: 0, wrong: 0, last: -1 };
  }
  return state.birds[id];
}

// species must be sorted commonest first.
export function ensurePool(state, species, { all = false } = {}) {
  const inPool = new Set(state.pool);
  const add = (count) => {
    for (const sp of species) {
      if (count <= 0) break;
      if (!inPool.has(sp.id)) {
        state.pool.push(sp.id);
        inPool.add(sp.id);
        bird(state, sp.id);
        count--;
      }
    }
  };
  if (all) add(species.length);
  // Pool size and unlocking are judged within the current area (species), so switching
  // area gives you that area's commonest birds without losing progress on the others.
  const ids = new Set(species.map((sp) => sp.id));
  const inArea = () => state.pool.filter((id) => ids.has(id)).length;
  const start = Math.min(state.startPool || START_POOL, species.length); // set from the experience question
  if (inArea() < start) add(start - inArea());
  let guard = species.length;
  while (learningCount(state, species) < MIN_LEARNING && inArea() < species.length && guard-- > 0) {
    add(UNLOCK_STEP);
  }
}

export const NEARLY_SCORE = MASTER_SCORE - 2; // one clean answer from mastered

// Re-line-up: when the order changes (iconic first, shared difficulty, another region) the
// study set is made to match what the CURRENT order would give you now. Birds near the front
// of the order stay; further down, unmet birds are re-picked and
// met birds that aren't mastered or nearly mastered are set aside ("later", progress kept)
// until the order reaches them again. Existing users were stuck with hard birds lined up
// before the iconic-first order (user 2026-11-17). Mastered birds stay for their checks.
export function realign(state, species, keep = null) {
  const ids = new Set(species.map((sp) => sp.id));
  const k = state.pool.filter((id) => ids.has(id)).length;
  // Room to spare (2x the set, at least 40 birds), so only birds far down the order are set
  // aside, not easy ones just past the current set size.
  const target = new Set(species.slice(0, Math.max(2 * k, 40)).map((sp) => sp.id));
  const before = state.pool.length;
  state.pool = state.pool.filter((id) => {
    if (!ids.has(id) || id === keep || target.has(id)) return true;
    const b = bird(state, id);
    if (b.m) return true;
    if (!(b.intro || b.right || b.wrong)) return false;
    return b.s >= NEARLY_SCORE;
  });
  if (state.pool.length !== before) {
    if (state.pairTest && !state.pool.includes(state.pairTest.id)) state.pairTest = null;
    ensurePool(state, species);
  }
}

// Adds the next `count` birds of the area (in `species` order) to the study set.
export function addBirds(state, species, count) {
  const inPool = new Set(state.pool);
  for (const sp of species) {
    if (count <= 0) break;
    if (!inPool.has(sp.id)) { state.pool.push(sp.id); bird(state, sp.id); count--; }
  }
}

// Struggling = met, not mastered, and doing badly NOW (score 0 or less after a miss).
// It used to be "missed at least as often as got right" over all time, which kept birds
// you'd since improved on blocking new birds for ages (user 2026-11-17: getting stuck).
export const isStruggling = (b) => b.intro && !b.m && b.wrong > 0 && b.s <= 0;

// species: when given, count only birds in that list (the current area).
export function learningCount(state, species = null) {
  const ids = species ? new Set(species.map((sp) => sp.id)) : null;
  return state.pool.filter((id) => (!ids || ids.has(id)) && !bird(state, id).m).length;
}

function pickFrom(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

// intros: show each new bird (name, photo, sound) once before testing it.
// Without intros, new birds are tested straight away and the reveal teaches them.
export function nextCard(state, species, rand = Math.random, { intros = false } = {}) {
  ensurePool(state, species);
  // Steady trickle: with every bird in play already met, one new bird joins every
  // NEW_EVERY cards (NEW_EVERY_STRUGGLING while struggling), so a few hard birds can't
  // stall progress. The user wants met birds learnt first, so struggling slows it down.
  {
    const ids = new Set(species.map((sp) => sp.id));
    const inPlay = state.pool.filter((id) => ids.has(id)).map((id) => bird(state, id));
    const struggling = inPlay.filter(isStruggling).length;
    const every = struggling < MAX_STRUGGLING ? NEW_EVERY : NEW_EVERY_STRUGGLING;
    if (inPlay.every((b) => b.intro) && state.sinceIntro >= every && inPlay.length < species.length) {
      addBirds(state, species, 1);
      if (!intros) state.sinceIntro = 0;
    }
  }
  if (!intros) {
    for (const id of state.pool) {
      const b = bird(state, id);
      if (!b.intro) { b.intro = true; b.due = state.n; }
    }
  }
  const inArea = new Set(species.map((sp) => sp.id));
  const pool = state.pool.filter((id) => inArea.has(id)).map((id) => [id, bird(state, id)]);
  const notLast = pool.filter(([id]) => id !== state.lastId || pool.length === 1);
  const due = notLast.filter(([, b]) => b.intro && b.due <= state.n);
  const learningDue = due.filter(([, b]) => !b.m).sort((a, b) => a[1].due - b[1].due);
  const masteredDue = due.filter(([, b]) => b.m);
  const fresh = pool.filter(([, b]) => !b.intro);

  // Struggling = met, not mastered, and missed at least as often as got right.
  const struggling = pool.filter(([, b]) => isStruggling(b)).length;
  const mayIntro = struggling < MAX_STRUGGLING || state.sinceIntro >= NEW_EVERY_STRUGGLING;
  if (fresh.length && mayIntro && !learningDue.some(([, b]) => b.miss)
      && (learningDue.length === 0 || state.sinceIntro >= 3)) {
    return { id: fresh[0][0], intro: true };
  }
  const missedDue = learningDue.filter(([, b]) => b.miss);
  if (missedDue.length) {
    return { id: missedDue[0][0], intro: false };
  }
  // "Which of the two?" test a few cards after a compare card, with a random one of the pair.
  const pt = state.pairTest;
  if (pt && pt.due <= state.n && pt.id !== state.lastId && inArea.has(pt.id) && inArea.has(pt.pair)) {
    return { id: pt.id, intro: false, pair: pt.pair, test: true };
  }
  // Mix due mastered birds in among the learning ones so "remembered" checks happen.
  if (masteredDue.length && (!learningDue.length || rand() < REVIEW_SHARE)) {
    return { id: pickFrom(masteredDue, rand)[0], intro: false };
  }
  const pair = (state.sincePair ?? 0) >= PAIR_EVERY ? duePair(state, inArea) : null;
  if (pair) {
    const [a, b] = rand() < 0.5 ? pair : [pair[1], pair[0]];
    return { id: a, intro: false, pair: b, compare: true };
  }
  if (learningDue.length) {
    return { id: pickFrom(learningDue.slice(0, 3), rand)[0], intro: false };
  }
  if (masteredDue.length) {
    return { id: pickFrom(masteredDue, rand)[0], intro: false };
  }
  // Nothing due: take whichever bird is due soonest.
  const soonest = notLast.filter(([, b]) => b.intro).sort((a, b) => a[1].due - b[1].due)[0];
  return { id: (soonest || pool[0])[0], intro: !soonest };
}

function tick(state, id) {
  state.n++;
  state.lastId = id;
  bird(state, id).last = state.n;
}

// "Other recording" pressed before answering: counted per bird (b.oth). Needing more
// recordings to place a bird is a sign it's hard; shared difficulty uses it (bird_stats).
export function otherPressed(state, id) {
  const b = bird(state, id);
  b.oth = (b.oth || 0) + 1;
}

export function introduced(state, id) {
  const b = bird(state, id);
  b.intro = true;
  tick(state, id);
  b.due = state.n + 2;
  state.sinceIntro = 0;
}

// Compare card done: the two birds were only heard side by side. The test of which is which
// comes 3-5 cards later (not straight away), on a random one of the two.
export function compared(state, id, pair, rand = Math.random) {
  tick(state, id);
  (state.pairShown ||= {})[pairKey(id, pair)] = state.n;
  state.sincePair = 0;
  const [t, o] = rand() < 0.5 ? [id, pair] : [pair, id];
  state.pairTest = { id: t, pair: o, due: state.n + 3 + Math.floor(rand() * 3) };
}

// "Skip for later": a met bird comes back SKIP_LATER cards later (a pending pair test with it
// too); a new bird goes to the back of the queue of new birds.
export const SKIP_LATER = 8;
export function skip(state, id) {
  const b = bird(state, id);
  tick(state, id);
  if (!b.intro) state.pool = [...state.pool.filter((x) => x !== id), id];
  else b.due = state.n + SKIP_LATER;
  if (state.pairTest?.id === id) state.pairTest.due = state.n + SKIP_LATER;
}

// Returns 'mastered' | 'remembered' | 'lost' | null for the celebration popups.
// day (YYYY-MM-DD, optional): logs answers and mastered count per day for usage reports.
export function answer(state, species, id, { correct, hinted = false, pair = null, day = null }, rand = Math.random) {
  const b = bird(state, id);
  tick(state, id);
  state.sinceIntro++;
  if (pair) {
    (state.pairShown ||= {})[pairKey(id, pair)] = state.n;
    state.sincePair = 0;
    state.pairTest = null;
  } else {
    state.sincePair = (state.sincePair ?? 0) + 1;
  }
  state.answered = (state.answered || 0) + 1;
  state.history = [...state.history.slice(-49), { id, correct, hinted, n: state.n }];
  let event = null;
  b.miss = !correct;
  b.missRun = correct ? 0 : (b.missRun || 0) + 1;
  if (correct) {
    b.right++;
    if (b.m) {
      event = 'remembered';
      b.iv = Math.min(b.iv * 2, MAX_INTERVAL);
      b.due = state.n + b.iv;
    } else {
      b.s += hinted ? 1 : 2;
      if (b.s >= MASTER_SCORE) {
        b.m = true;
        if (b.firstM == null) b.firstM = b.right + b.wrong; // cards it took to master
        b.iv = FIRST_INTERVAL;
        b.due = state.n + b.iv;
        event = 'mastered';
      } else {
        b.due = state.n + 2 + b.s * 2 + Math.floor(rand() * 3);
      }
    }
  } else {
    b.wrong++;
    if (b.m) {
      b.m = false;
      b.s = 2;
      event = 'lost';
    } else {
      b.s = Math.max(b.s - 2, -4);
    }
    // Missed: back after 3-5 cards. Missed twice in a row: rest longer, so the same hard
    // birds don't take over the session.
    b.due = state.n + (b.missRun >= 2 ? MISS_REST : 3) + Math.floor(rand() * 3);
  }
  if (day) logDay(state, day);
  ensurePool(state, species);
  return event;
}

const KEEP_DAYS = 400;
function logDay(state, day) {
  const days = (state.days ||= {});
  const d = (days[day] ||= { a: 0, m: 0 });
  d.a++;
  d.m = Object.values(state.birds).filter((x) => x.m).length;
  const keys = Object.keys(days);
  if (keys.length > KEEP_DAYS) for (const k of keys.sort().slice(0, keys.length - KEEP_DAYS)) delete days[k];
}

// ---------- mix-ups ----------

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// heard: the bird that was playing; thought: the bird the user took it for.
export function recordMix(state, heard, thought) {
  if (!heard || !thought || heard === thought) return;
  const m = (state.mix ||= {});
  const row = (m[heard] ||= {});
  row[thought] = (row[thought] || 0) + 1;
}

// Birds mixed up with id in either direction, most often first.
export function confusedWith(state, id) {
  const m = state.mix || {};
  const counts = {};
  for (const [other, n] of Object.entries(m[id] || {})) counts[other] = (counts[other] || 0) + n;
  for (const [heard, row] of Object.entries(m)) {
    if (row[id]) counts[heard] = (counts[heard] || 0) + row[id];
  }
  return Object.entries(counts).map(([other, count]) => ({ id: other, count })).sort((a, b) => b.count - a.count);
}

// Only pairs where both birds are in the current area.
function duePair(state, inArea) {
  const met = new Set(state.pool.filter((id) => inArea.has(id) && state.birds[id]?.intro));
  let best = null;
  for (const heard of Object.keys(state.mix || {})) {
    if (!met.has(heard)) continue;
    for (const { id: other, count } of confusedWith(state, heard)) {
      if (!met.has(other) || count < PAIR_MIN) continue;
      // Both mastered: you can tell them apart now, so no more compare cards (a miss on
      // either puts it back in learning and the pair can return).
      if (state.birds[heard]?.m && state.birds[other]?.m) continue;
      const shown = state.pairShown?.[pairKey(heard, other)];
      if (shown !== undefined && state.n - shown < PAIR_REST) continue;
      if (!best || count > best.count) best = { pair: [heard, other], count };
    }
  }
  return best ? best.pair : null;
}

export function status(state, id) {
  const b = state.birds[id];
  if (b && b.intro && !b.m && !state.pool.includes(id)) return 'later'; // set aside by realign
  if (!b || !state.pool.includes(id)) return 'locked';
  if (!b.intro) return 'new';
  return b.m ? 'mastered' : 'learning';
}

export function summary(state, species) {
  const tiers = {};
  for (const sp of species) {
    const t = (tiers[sp.tier] ||= { mastered: 0, learning: 0, new: 0, later: 0, locked: 0, total: 0 });
    t[status(state, sp.id)]++;
    t.total++;
  }
  const recent = state.history.slice(-20);
  return {
    tiers,
    mastered: species.filter((sp) => status(state, sp.id) === 'mastered').length,
    inPlay: species.filter((sp) => state.pool.includes(sp.id)).length,
    met: species.filter((sp) => state.pool.includes(sp.id) && state.birds[sp.id]?.intro).length,
    answered: state.answered || 0,
    recentAccuracy: recent.length ? recent.filter((h) => h.correct).length / recent.length : null,
  };
}
