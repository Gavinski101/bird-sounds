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
  assert.ok(pairCard, 'compare card shown');
  assert.deepEqual([pairCard.id, pairCard.pair].sort(), ['b1', 'b2']);
  L.answer(s, species, pairCard.id, { correct: true, hinted: true, pair: pairCard.pair }, rand);
  for (let i = 0; i < L.PAIR_REST - 2; i++) {
    const c = L.nextCard(s, species, rand);
    assert.ok(!c.pair, 'same pair rests');
    L.answer(s, species, c.id, { correct: true }, rand);
  }
  assert.equal(L.summary(s, species).met, 20);
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

// No new birds while 3 met birds are still a struggle.
{
  const s = L.newState();
  L.ensurePool(s, species);
  for (const id of ['b0', 'b1', 'b2']) { L.introduced(s, id); L.answer(s, species, id, { correct: false }, rand); }
  for (let i = 0; i < 30; i++) {
    const c = L.nextCard(s, species, rand, { intros: true });
    assert.equal(c.intro, false, 'no introduction while struggling');
    L.answer(s, species, c.id, { correct: false }, rand);
  }
  // Getting them right releases new birds again.
  for (const id of ['b0', 'b1', 'b2']) for (let k = 0; k < 4; k++) L.answer(s, species, id, { correct: true }, rand);
  let introduced = false;
  for (let i = 0; i < 20 && !introduced; i++) {
    const c = L.nextCard(s, species, rand, { intros: true });
    if (c.intro) introduced = true; else L.answer(s, species, c.id, { correct: true }, rand);
  }
  assert.ok(introduced, 'new bird once no longer struggling');
}

console.log('learn.js: all checks passed');
