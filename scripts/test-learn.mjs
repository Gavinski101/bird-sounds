// Checks the progression rules in js/learn.js.  Run: node scripts/test-learn.mjs
import assert from 'node:assert/strict';
import * as L from '../js/learn.js';

const species = Array.from({ length: 100 }, (_, i) => ({ id: `b${i}`, tier: i < 30 ? 'Beginner' : 'Easy' }));
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function play(state, knows, cards) {
  const events = [];
  for (let i = 0; i < cards; i++) {
    const c = L.nextCard(state, species, rand, { intros: true });
    if (c.intro) { L.introduced(state, c.id); continue; }
    const ev = L.answer(state, species, c.id, { correct: knows(c.id) }, rand);
    if (ev) events.push([ev, c.id]);
  }
  return events;
}

// Starts with the 20 commonest, introduced in order.
{
  const s = L.newState();
  const first = L.nextCard(s, species, rand, { intros: true });
  assert.equal(s.pool.length, 20);
  assert.deepEqual(first, { id: 'b0', intro: true });
}

// Without intros, the first card is already a test, drawn from the commonest birds.
{
  const s = L.newState();
  const first = L.nextCard(s, species, rand);
  assert.equal(first.intro, false);
  assert.ok(['b0', 'b1', 'b2'].includes(first.id));
  for (let i = 0; i < 100; i++) {
    const c = L.nextCard(s, species, rand);
    assert.equal(c.intro, false);
    L.answer(s, species, c.id, { correct: true }, rand);
  }
}

// A missed bird comes back within 3-5 cards.
{
  const s = L.newState();
  L.ensurePool(s, species);
  for (const id of s.pool) L.introduced(s, id);
  s.lastId = null;
  L.answer(s, species, 'b3', { correct: false }, rand);
  const missedAt = s.n;
  let back = null;
  for (let i = 0; i < 8 && back === null; i++) {
    const c = L.nextCard(s, species, rand);
    if (c.id === 'b3') back = s.n - missedAt;
    else L.answer(s, species, c.id, { correct: true }, rand);
  }
  assert.ok(back !== null && back >= 2 && back <= 6, `missed bird back after ${back}`);
}

// Never the same bird twice in a row.
{
  const s = L.newState();
  let last = null;
  for (let i = 0; i < 300; i++) {
    const c = L.nextCard(s, species, rand, { intros: i % 2 === 0 });
    assert.notEqual(c.id, last);
    last = c.id;
    if (c.intro) L.introduced(s, c.id); else L.answer(s, species, c.id, { correct: rand() < 0.7 }, rand);
  }
}

// Knowing everything: birds get mastered, more unlock, mastered ones are remembered.
{
  const s = L.newState();
  const events = play(s, () => true, 600);
  const kinds = new Set(events.map((e) => e[0]));
  assert.ok(kinds.has('mastered'));
  assert.ok(kinds.has('remembered'));
  assert.ok(s.pool.length > 20, `pool grew to ${s.pool.length}`);
  assert.ok(L.learningCount(s) >= L.MIN_LEARNING || s.pool.length === species.length);
}

// Missing a mastered bird sends it back to learning.
{
  const s = L.newState();
  play(s, () => true, 200);
  const m = s.pool.find((id) => s.birds[id].m);
  assert.equal(L.answer(s, species, m, { correct: false }, rand), 'lost');
  assert.equal(L.status(s, m), 'learning');
}

// Hints halve the gain: 6 hinted answers to master instead of 3.
{
  const s = L.newState();
  L.ensurePool(s, species);
  L.introduced(s, 'b0');
  let ev = null, n = 0;
  while (!ev) { ev = L.answer(s, species, 'b0', { correct: true, hinted: true }, rand); n++; }
  assert.equal(n, 6);
}

// Unlock all.
{
  const s = L.newState();
  L.ensurePool(s, species, { all: true });
  assert.equal(s.pool.length, 100);
}

// Mix-ups: recorded both ways, and a confused pair gets a compare card.
{
  const s = L.newState();
  L.ensurePool(s, species);
  for (const id of s.pool) L.introduced(s, id);
  L.recordMix(s, 'b1', 'b2');
  L.recordMix(s, 'b2', 'b1');
  L.recordMix(s, 'b1', 'b1');
  assert.deepEqual(L.confusedWith(s, 'b1'), [{ id: 'b2', count: 2 }]);
  let pairCard = null;
  for (let i = 0; i < 40 && !pairCard; i++) {
    const c = L.nextCard(s, species, rand);
    if (c.pair) pairCard = c;
    else L.answer(s, species, c.id, { correct: true }, rand);
  }
  assert.ok(pairCard && pairCard.compare, 'compare card shown');
  assert.deepEqual([pairCard.id, pairCard.pair].sort(), ['b1', 'b2']);
  L.compared(s, pairCard.id, pairCard.pair, rand);
  // The test is not the next card, comes within a few cards, and has the same two birds.
  let test = null, gap = 0;
  for (let i = 0; i < 10 && !test; i++) {
    const c = L.nextCard(s, species, rand);
    if (c.test) test = c;
    else { gap++; L.answer(s, species, c.id, { correct: true }, rand); }
  }
  assert.ok(test, 'pair test comes');
  assert.ok(gap >= 2, `pair test not straight after the compare card (gap ${gap})`);
  assert.deepEqual([test.id, test.pair].sort(), ['b1', 'b2']);
  L.answer(s, species, test.id, { correct: true, hinted: true, pair: test.pair }, rand);
  for (let i = 0; i < L.PAIR_REST - 12; i++) {
    const c = L.nextCard(s, species, rand);
    assert.ok(!c.pair, 'same pair rests');
    L.answer(s, species, c.id, { correct: true }, rand);
  }
  // The tested bird is random: both birds get tested over many compare cards.
  const picked = new Set();
  for (let k = 0; k < 40; k++) {
    const t = L.newState();
    L.compared(t, 'b1', 'b2', Math.random);
    picked.add(t.pairTest.id);
  }
  assert.equal(picked.size, 2, 'either bird can be tested');
  assert.ok(L.summary(s, species).met >= 20, 'met birds kept (the trickle may add more)');
}

// Skip for later: a new bird goes to the back of the new-bird queue; a met bird waits SKIP_LATER cards.
{
  const s = L.newState();
  L.ensurePool(s, species);
  const first = L.nextCard(s, species, rand, { intros: true });
  assert.ok(first.intro);
  L.skip(s, first.id);
  const next = L.nextCard(s, species, rand, { intros: true });
  assert.notEqual(next.id, first.id, 'skipped new bird not next');
  assert.equal(s.pool[s.pool.length - 1], first.id, 'skipped new bird at the back');
  L.introduced(s, next.id);
  L.skip(s, next.id);
  assert.equal(s.birds[next.id].due, s.n + L.SKIP_LATER, 'met bird waits');
}

// Compare cards only pair birds of the current area.
{
  const s = L.newState();
  L.ensurePool(s, species);
  for (const id of s.pool) L.introduced(s, id);
  for (let k = 0; k < 2; k++) L.recordMix(s, 'b1', 'b2');
  s.sincePair = 99;
  const area = species.filter((sp) => sp.id !== 'b2');
  for (let i = 0; i < 30; i++) {
    const c = L.nextCard(s, area, rand);
    assert.ok(!c.pair, 'no compare card with a bird outside the area');
    assert.ok(c.id !== 'b2', 'no card for a bird outside the area');
    L.answer(s, area, c.id, { correct: true }, rand);
  }
}

// Unmet birds are re-picked when the order changes; met birds stay.
{
  const s = L.newState();
  L.ensurePool(s, species);
  for (const id of s.pool.slice(0, 5)) L.introduced(s, id);
  const met = s.pool.slice(0, 5);
  const reversed = [...species].reverse();
  L.repickUnmet(s, reversed);
  for (const id of met) assert.ok(s.pool.includes(id), 'met bird kept');
  const unmet = s.pool.filter((id) => !met.includes(id));
  assert.equal(s.pool.length, 20);
  assert.deepEqual(unmet, reversed.filter((sp) => !met.includes(sp.id)).slice(0, 15).map((sp) => sp.id), 'unmet birds follow the new order');
}

// Starting pool follows the experience level.
{
  const s = L.newState();
  s.startPool = 10;
  L.ensurePool(s, species);
  assert.equal(s.pool.length, 10);
  s.startPool = 40;
  L.ensurePool(s, species);
  assert.equal(s.pool.length, 40);
}

// Switching area: cards come only from that area; its commonest birds are added.
{
  const s = L.newState();
  L.ensurePool(s, species);
  const other = species.slice(50, 70);          // a different "area" with 20 birds
  const c = L.nextCard(s, other, rand);
  assert.ok(other.some((sp) => sp.id === c.id), 'card from the current area');
  assert.equal(L.summary(s, other).inPlay, 20);
  assert.ok(s.pool.includes('b0'), 'birds from the first area are kept');
}

// While 3 met birds are a struggle, new birds slow down to one per NEW_EVERY_STRUGGLING cards.
{
  const s = L.newState();
  L.ensurePool(s, species);
  for (const id of ['b0', 'b1', 'b2']) { L.introduced(s, id); L.answer(s, species, id, { correct: false }, rand); }
  for (let i = 0; i < L.NEW_EVERY_STRUGGLING - 5; i++) {
    const c = L.nextCard(s, species, rand, { intros: true });
    assert.equal(c.intro, false, 'no introduction yet while struggling');
    L.answer(s, species, c.id, { correct: false }, rand);
  }
  let slowIntro = false;
  for (let i = 0; i < 10 && !slowIntro; i++) {
    const c = L.nextCard(s, species, rand, { intros: true });
    if (c.intro) { slowIntro = true; L.introduced(s, c.id); } else L.answer(s, species, c.id, { correct: false }, rand);
  }
  assert.ok(slowIntro, 'a new bird after NEW_EVERY_STRUGGLING cards even while struggling');
  // Getting them right releases new birds again.
  for (const id of ['b0', 'b1', 'b2']) for (let k = 0; k < 4; k++) L.answer(s, species, id, { correct: true }, rand);
  let introduced = false;
  for (let i = 0; i < 20 && !introduced; i++) {
    const c = L.nextCard(s, species, rand, { intros: true });
    if (c.intro) introduced = true; else L.answer(s, species, c.id, { correct: true }, rand);
  }
  assert.ok(introduced, 'new bird once no longer struggling');
}

// Steady trickle: with all birds met and none struggling, a new bird comes within NEW_EVERY cards.
{
  const s = L.newState();
  L.ensurePool(s, species);
  for (const id of s.pool) L.introduced(s, id);
  const before = s.pool.length;
  let intro = null;
  for (let i = 0; i < L.NEW_EVERY + 5 && !intro; i++) {
    const c = L.nextCard(s, species, rand, { intros: true });
    if (c.intro) intro = c; else L.answer(s, species, c.id, { correct: true }, rand);
  }
  assert.ok(intro, 'a new bird within NEW_EVERY cards');
  assert.ok(s.pool.length > before, 'study set grew');
}

// A bird missed twice in a row rests longer than one missed once.
{
  const s = L.newState();
  L.ensurePool(s, species);
  L.introduced(s, 'b0');
  L.answer(s, species, 'b0', { correct: false }, () => 0);
  assert.equal(s.birds.b0.due, s.n + 3);
  L.answer(s, species, 'b0', { correct: false }, () => 0);
  assert.equal(s.birds.b0.due, s.n + L.MISS_REST);
  L.answer(s, species, 'b0', { correct: true }, () => 0);
  assert.equal(s.birds.b0.missRun, 0);
}

console.log('learn.js: all checks passed');
