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
  if (state.pool.length < START_POOL) add(START_POOL - state.pool.length);
  let guard = species.length;
  while (learningCount(state) < MIN_LEARNING && state.pool.length < species.length && guard-- > 0) {
    add(UNLOCK_STEP);
  }
}

export function learningCount(state) {
  return state.pool.filter((id) => !bird(state, id).m).length;
}

function pickFrom(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

// intros: show each new bird (name, photo, sound) once before testing it.
// Without intros, new birds are tested straight away and the reveal teaches them.
export function nextCard(state, species, rand = Math.random, { intros = false } = {}) {
  ensurePool(state, species);
  if (!intros) {
    for (const id of state.pool) {
      const b = bird(state, id);
      if (!b.intro) { b.intro = true; b.due = state.n; }
    }
  }
  const pool = state.pool.map((id) => [id, bird(state, id)]);
  const notLast = pool.filter(([id]) => id !== state.lastId || pool.length === 1);
  const due = notLast.filter(([, b]) => b.intro && b.due <= state.n);
  const learningDue = due.filter(([, b]) => !b.m).sort((a, b) => a[1].due - b[1].due);
  const masteredDue = due.filter(([, b]) => b.m);
  const fresh = pool.filter(([, b]) => !b.intro);

  if (fresh.length && !learningDue.some(([, b]) => b.miss) && (learningDue.length === 0 || state.sinceIntro >= 3)) {
    return { id: fresh[0][0], intro: true };
  }
  const missedDue = learningDue.filter(([, b]) => b.miss);
  if (missedDue.length) {
    return { id: missedDue[0][0], intro: false };
  }
  // Mix due mastered birds in among the learning ones so "remembered" checks happen.
  if (masteredDue.length && (!learningDue.length || rand() < REVIEW_SHARE)) {
    return { id: pickFrom(masteredDue, rand)[0], intro: false };
  }
  const pair = (state.sincePair ?? 0) >= PAIR_EVERY ? duePair(state) : null;
  if (pair) {
    const [a, b] = rand() < 0.5 ? pair : [pair[1], pair[0]];
    return a !== state.lastId ? { id: a, intro: false, pair: b } : { id: b, intro: false, pair: a };
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

export function introduced(state, id) {
  const b = bird(state, id);
  b.intro = true;
  tick(state, id);
  b.due = state.n + 2;
  state.sinceIntro = 0;
}

export function skip(state, id) {
  tick(state, id);
  bird(state, id).due = state.n + 2;
}

// Returns 'mastered' | 'remembered' | 'lost' | null for the celebration popups.
export function answer(state, species, id, { correct, hinted = false, pair = null }, rand = Math.random) {
  const b = bird(state, id);
  tick(state, id);
  state.sinceIntro++;
  if (pair) {
    (state.pairShown ||= {})[pairKey(id, pair)] = state.n;
    state.sincePair = 0;
  } else {
    state.sincePair = (state.sincePair ?? 0) + 1;
  }
  state.answered = (state.answered || 0) + 1;
  state.history = [...state.history.slice(-49), { id, correct, hinted, n: state.n }];
  let event = null;
  b.miss = !correct;
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
    b.due = state.n + 3 + Math.floor(rand() * 3);
  }
  ensurePool(state, species);
  return event;
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

function duePair(state) {
  const met = new Set(state.pool.filter((id) => state.birds[id]?.intro));
  let best = null;
  for (const heard of Object.keys(state.mix || {})) {
    if (!met.has(heard)) continue;
    for (const { id: other, count } of confusedWith(state, heard)) {
      if (!met.has(other) || count < PAIR_MIN) continue;
      const shown = state.pairShown?.[pairKey(heard, other)];
      if (shown !== undefined && state.n - shown < PAIR_REST) continue;
      if (!best || count > best.count) best = { pair: [heard, other], count };
    }
  }
  return best ? best.pair : null;
}

export function status(state, id) {
  const b = state.birds[id];
  if (!b || !state.pool.includes(id)) return 'locked';
  if (!b.intro) return 'new';
  return b.m ? 'mastered' : 'learning';
}

export function summary(state, species) {
  const tiers = {};
  for (const sp of species) {
    const t = (tiers[sp.tier] ||= { mastered: 0, learning: 0, new: 0, locked: 0, total: 0 });
    t[status(state, sp.id)]++;
    t.total++;
  }
  const recent = state.history.slice(-20);
  return {
    tiers,
    mastered: species.filter((sp) => status(state, sp.id) === 'mastered').length,
    inPlay: state.pool.length,
    met: state.pool.filter((id) => state.birds[id]?.intro).length,
    answered: state.answered || 0,
    recentAccuracy: recent.length ? recent.filter((h) => h.correct).length / recent.length : null,
  };
}
