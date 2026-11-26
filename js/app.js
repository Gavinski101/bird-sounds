import * as L from './learn.js';
import * as Sync from './sync.js';
import { OWNER_HASHES } from './config.js';

// Version shown faintly at the bottom of the screen. Bump it with SHELL in sw.js on every release
// and add a line to CHANGELOG.md. Each release adds 0.0.1; after x.y.9 comes x.(y+1).0.
// 1.0.0 = first public version (2026-11-12).
const VERSION = '2.1.3';
const STORE_KEY = 'bird-sounds-v1';
const MEDIA_CACHE = 'bird-sounds-media';
const TIER_ORDER = ['Common', 'Regular', 'Uncommon', 'Scarce']; // v2.1.3: was Beginner/Easy/Medium/Hard
const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let species = [];      // birds in the current area, commonest first (rank/tier for that area)
let allSpecies = [];
let areas = [];
let byId = {};
let areaIds = new Set(); // ids of `species`: birds of the current area
let calls = {};
let nameSets = {};
let guide = { birds: {}, similar: [] }; // data/guide.json: ease by ear, memory aids, sound-alike pairs
let habitats = {}; // data/habitats.json (scripts/build_habitats.py): bird id -> habitat keys
let area = '';
let areaTotal = 0;
let S = loadStore();
let cur = null; // current study card

// ---------- storage ----------

function defaultStore() {
  return { learn: L.newState(), prefs: { nameSet: 'en_ZA', autoplay: true, intros: true }, recs: {}, streak: { run: 0, best: 0 } };
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const prefs = { ...defaultStore().prefs, ...s.prefs };
      if (!prefs.introsChosen) prefs.intros = true; // intros were briefly off by default; restore unless the user chose
      return { ...defaultStore(), ...s, prefs };
    }
  } catch { /* private mode or corrupt: start fresh */ }
  return defaultStore();
}

function saveLocal() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch { /* storage full or blocked */ }
}

function save() {
  if (Sync.signedIn()) {
    (S.sync ||= {}).dirty = true;
    schedulePush();
  }
  saveLocal();
}

// ---------- sync ----------

// Supabase returns timestamps as "…+00:00", we send "…Z": compare the moments, not the text.
const sameTime = (a, b) => !!a && !!b && Date.parse(a) === Date.parse(b);
const syncPayload = () => ({ learn: S.learn, recs: S.recs, prefs: S.prefs, streak: S.streak });
const answers = (d) => d?.learn?.answered || 0;
let pushTimer = null;
let syncing = false;

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushNow().catch(() => {}), 3000);
}

async function pushNow() {
  if (!Sync.signedIn() || !navigator.onLine) return;
  const ts = await Sync.push(syncPayload());
  S.sync = { seen: ts, dirty: false, at: Date.now() };
  saveLocal();
  renderAccount();
}

function adopt(data, keepLocalRecs) {
  const local = S;
  const privacy = [local.prefs?.privacy, data.prefs?.privacy].filter(Boolean)
    .sort((a, b) => (b.v || 0) - (a.v || 0) || String(b.at || '').localeCompare(String(a.at || '')))[0];
  S = {
    ...defaultStore(),
    ...data,
    prefs: { ...defaultStore().prefs, ...data.prefs, ...(privacy ? { privacy } : {}) },
    recs: keepLocalRecs ? { ...(data.recs || {}), ...(local.recs || {}) } : data.recs || {},
    sync: local.sync,
  };
}

// Pull the saved copy and reconcile it with this device. When both changed, the copy
// with more answers wins; recording ratings and flags from both are kept.
async function syncNow({ firstSignIn = false } = {}) {
  if (!Sync.signedIn() || syncing || !navigator.onLine) return;
  syncing = true;
  try {
    const remote = await Sync.pull();
    const st = (S.sync ||= {});
    if (!remote) {
      await pushNow();
    } else if (firstSignIn) {
      const mine = answers(S);
      const theirs = answers(remote.data);
      let useCloud = mine === 0;
      if (!useCloud && theirs > 0) {
        useCloud = confirm(`Your account already has saved progress (${theirs} answers). This device has ${mine} answers.\n\nOK = use the account's progress\nCancel = keep this device's progress`);
      }
      if (useCloud) {
        adopt(remote.data, true);
        S.sync = { seen: remote.updated_at, dirty: false, at: Date.now() };
        saveLocal();
        afterAdopt();
        if (Object.keys(S.recs).length) await pushNow();
      } else {
        S.recs = { ...(remote.data.recs || {}), ...S.recs };
        await pushNow();
      }
    } else if (!sameTime(remote.updated_at, st.seen)) {
      // Another device saved since we last synced. Take its copy unless that would lose
      // answers made here (progress only ever grows, so fewer answers = older copy).
      const theirs = answers(remote.data);
      const mine = answers(S);
      if (theirs > mine || (theirs === mine && !st.dirty)) {
        adopt(remote.data, st.dirty);
        S.sync = { seen: remote.updated_at, dirty: !!st.dirty, at: Date.now() };
        saveLocal();
        afterAdopt();
        if (S.sync.dirty) await pushNow();
      } else {
        S.recs = { ...(remote.data.recs || {}), ...S.recs };
        await pushNow();
      }
    } else if (st.dirty) {
      await pushNow();
    }
  } catch (e) {
    if (!Sync.signedIn()) toast('Signed out: please sign in again to keep syncing');
    console.warn('sync failed', e);
  } finally {
    syncing = false;
    renderAccount();
  }
}

function afterAdopt() {
  if (!species.length) return;
  renderTop();
  const active = document.querySelector('.view.active')?.id;
  // Keep the card the person is on; only start a new one if that bird is gone.
  if (active === 'view-study') { if (cur && byId[cur.id]) renderCard(); else newCard(); }
  else if (active === 'view-progress') renderProgress();
  else if (active === 'view-birds') renderBirds();
  else if (active === 'view-settings') renderSettings();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncNow();
  else if (S.sync?.dirty) pushNow().catch(() => {});
});
window.addEventListener('online', () => syncNow());

// ---------- account panel ----------

const GOOGLE_SVG = '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.5-5 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg>';

let authMode = 'signin';

function renderAccount() {
  const el = $('account');
  if (!el) return;
  renderAvatar();
  if (species.length) {
    updateOwner().then((changed) => {
      if (!changed) return;
      applyArea();
      renderTop();
      if ($('view-settings').classList.contains('active')) renderSettings();
    });
  }
  $('accountPanel').hidden = !Sync.configured;
  if (Sync.signedIn()) {
    const st = S.sync || {};
    const when = st.at ? new Date(st.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : null;
    const state = !navigator.onLine ? 'Offline: changes will sync when you are back online.'
      : st.dirty ? 'Saving your latest changes…'
      : when ? `Last synced ${when}.` : 'Not synced yet.';
    el.innerHTML = `<p>Signed in as <b>${esc(Sync.email())}</b></p>
      <p class="muted small"><span data-tip="Your progress, recording ratings, flags and settings are saved to your account a few seconds after each change, and fetched when you open the app.">${esc(state)}</span></p>
      <div class="btn-row">
        <button class="btn" id="syncNowBtn">Sync now</button>
        <button class="btn ghost" id="signOutBtn">Sign out</button>
      </div>
      <label class="row small" style="margin:10px 0 4px"><input type="checkbox" id="shareChk" ${S.prefs.privacy?.share ? 'checked' : ''}>
        <span data-tip="${esc(TIPS.share)}">Add my answers (anonymously) to the shared totals</span></label>
      <button class="link danger-link" id="deleteAccountBtn">Delete my account</button>`;
  } else {
    const typed = $('emailInput')?.value || '';
    if (authMode === 'reset' || authMode === 'resetSent') {
      el.innerHTML = authMode === 'reset'
        ? `<p><b>Forgot your password?</b></p>
          <p class="muted small">Enter your account's email and we'll send you a link to choose a new password.</p>
          <form id="resetForm" method="post" action="#" novalidate>
            <input class="search" id="emailInput" name="email" type="email" autocomplete="username" placeholder="Email address" value="${esc(typed)}" required>
            <button type="submit" class="btn block" id="resetSubmit">Email me a reset link</button>
          </form>
          <button type="button" class="link" data-mode="signin">← Back to sign in</button>`
        : `<p><b>Check your email</b></p>
          <p class="muted small">If <b>${esc(typed)}</b> has an account, a reset link is on its way. Open it on this device
          and the app will ask for your new password. It can take a minute to arrive; check spam too.
          Signed up with Google? Then there's no password to reset: just use Continue with Google.</p>
          <input type="hidden" id="emailInput" value="${esc(typed)}">
          <button type="button" class="link" data-mode="signin">← Back to sign in</button>`;
      return;
    }
    const signup = authMode === 'signup';
    // A real <form> with the right autocomplete values lets the browser's password manager
    // fill saved passwords on Sign in and suggest a strong one on Create account.
    el.innerHTML = `<p class="muted">Sign in to save your progress online and keep it the same on all your devices.</p>
      ${Sync.googleEnabled ? `<button type="button" class="btn block google" id="googleBtn">${GOOGLE_SVG} Continue with Google</button>
      <div class="or"><span>or use email</span></div>` : ''}
      <div class="seg" role="tablist">
        <button type="button" role="tab" class="${signup ? '' : 'on'}" data-mode="signin" aria-selected="${!signup}">Sign in</button>
        <button type="button" role="tab" class="${signup ? 'on' : ''}" data-mode="signup" aria-selected="${signup}">Create account</button>
      </div>
      <form id="authForm" method="post" action="#" novalidate>
        <input class="search" id="emailInput" name="email" type="email" autocomplete="username" placeholder="Email address" value="${esc(typed)}" required>
        <input class="search" id="passwordInput" name="${signup ? 'new-password' : 'password'}" type="password"
          autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required
          placeholder="${signup ? 'Choose a password (at least 6 characters)' : 'Password'}">
        <label class="row small muted" style="margin:-4px 0 8px"><input type="checkbox" id="showPw"> Show password</label>
        <button type="submit" class="btn block" id="authSubmit">${signup ? 'Create account' : 'Sign in'}</button>
      </form>
      <p class="small muted">Signing in saves your progress with your account (see the <a href="privacy.html">privacy policy</a>). You then choose whether your answers also count, anonymously, in shared totals.</p>
      ${signup ? '' : '<button type="button" class="link" data-mode="reset">Forgot password?</button>'}`;
  }
}

function friendly(err) {
  const m = (err.message || '').toLowerCase();
  if (m.includes('invalid login')) return 'Wrong email or password';
  if (m.includes('already registered') || m.includes('already been registered')) return 'That email already has an account: tap Sign in';
  if (m.includes('password should be') || m.includes('weak')) return 'Choose a longer password (at least 6 characters)';
  if (m.includes('email not confirmed')) return 'This account still needs its email confirmed';
  if (m.includes('rate limit')) return 'Too many tries: wait a minute and try again';
  if (m.includes('failed to fetch') || m.includes('network')) return "Couldn't reach the server. Check your connection.";
  if (m.includes('delete_my_account') || m.includes('could not find the function')) return "Account deletion isn't set up on the server yet";
  return err.message && err.message.length < 120 ? err.message : 'Something went wrong. Try again.';
}

// Sign in / create account runs on the form's submit event, so the button, the Enter key
// and password managers that submit the form all take the same path.
$('account').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.target.id === 'resetForm') {
    const address = $('emailInput').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return toast('Enter your email address');
    $('resetSubmit').disabled = true;
    try {
      await Sync.requestReset(address);
      authMode = 'resetSent';
    } catch (err) {
      toast(friendly(err));
    }
    renderAccount();
    return;
  }
  const btn = $('authSubmit');
  try {
    const address = $('emailInput').value.trim();
    const password = $('passwordInput').value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return toast('Enter your email address');
    if (password.length < 6) return toast('Password needs at least 6 characters');
    btn.disabled = true;
    if (authMode === 'signin') {
      await Sync.signIn(address, password);
    } else if (!(await Sync.signUp(address, password))) {
      renderAccount();
      return toast('Account created, but it needs email confirmation first');
    }
    toast(authMode === 'signin' ? 'Signed in' : 'Account created');
    renderAccount();
    await syncNow({ firstSignIn: true });
    checkPrivacy();
    if (welcomeOpen()) closeWelcome();
  } catch (err) {
    toast(friendly(err));
    renderAccount();
  }
});

$('account').addEventListener('change', (e) => {
  if (e.target.id === 'showPw') $('passwordInput').type = e.target.checked ? 'text' : 'password';
  if (e.target.id === 'shareChk') {
    setPrivacy(e.target.checked);
    toast(e.target.checked ? 'Your answers now count in the shared totals, without your name' : 'Your answers are no longer counted in the shared totals');
  }
});

$('account').addEventListener('click', async (e) => {
  const mode = e.target.closest('[data-mode]');
  if (mode) {
    authMode = mode.dataset.mode;
    renderAccount();
    $(authMode === 'signup' ? 'passwordInput' : 'emailInput').focus();
    return;
  }
  const id = e.target.closest('button')?.id;
  if (!id) return;
  try {
    if (id === 'googleBtn') {
      location.href = Sync.googleSignInUrl();
    } else if (id === 'syncNowBtn') {
      e.target.disabled = true;
      await syncNow();
      toast('Synced');
    } else if (id === 'deleteAccountBtn') {
      if (!confirm(`Delete the account ${Sync.email()}?\n\nThis permanently removes the account and the progress saved in it. It cannot be undone.\n\nYour progress on this device stays, so you can keep studying without an account.`)) return;
      if (!confirm('Are you sure? Tap OK to delete the account for good.')) return;
      e.target.disabled = true;
      await Sync.deleteAccount();
      S.sync = {};
      saveLocal();
      showView('study');
      openWelcome();
      toast('Account deleted');
    } else if (id === 'signOutBtn') {
      if (!confirm('Sign out? Your progress stays on this device and in your account.')) return;
      await Sync.signOut();
      S.sync = {};
      saveLocal();
      // Back to the welcome screen (sign in again, or carry on without an account), like first open.
      showView('study');
      openWelcome();
      toast('Signed out');
    }
  } catch (err) {
    toast(friendly(err));
    renderAccount();
  }
});

// ---------- helpers ----------

const nm = (sp) => sp.names[S.prefs.nameSet] || sp.names.en_ZA;
// Ratings and flags are keyed by the recording: the XC number, or "inat-<id>" for iNaturalist.
const recKey = (r) => (r.xc != null ? String(r.xc) : r.key);
const recPref = (r) => S.recs[recKey(r)] || {};

// Shared verdicts: every signed-in user's flags and ratings, totalled by the database.
// Everything from other people counts as a SHARE of the people who encountered the
// recording, never a fixed number of people (v1.8.3, user's rule: 1 of 1 counts fully,
// 2 of 5 less, 2 of 10 less again). Flags and 1-2 star ratings move it down by that share.
// Dropping it for everyone is a hard step, so it also weighs how many people that share rests
// on (v1.8.4): dropped when flags / (people who encountered it + DROP_WEIGHT) >= DROP_SHARE.
// 1 of 1 = 0.33: not dropped, only moved to the bottom; 2 of 2 = 0.5, 2 of 3 = 0.4, 5 of 10
// = 0.42: dropped; 3 of 10 = 0.25: not. Your own rating, flag or "Use anyway" always wins.
const SCORES_KEY = 'bird-sounds-scores';
const DROP_WEIGHT = 2;
const DROP_SHARE = 0.4;
let scores = {};
try { scores = JSON.parse(localStorage.getItem(SCORES_KEY))?.map || {}; } catch { /* none yet */ }
const shared = (r) => scores[recKey(r)];
// People who encountered it: played it (load times, v1.7.3+), rated it or flagged it.
const encountered = (c) => Math.max(c.playPeople || 0, c.waitPeople || 0, c.raters || 0, c.flags || 0, 1);
const flagShare = (r) => { const c = shared(r); return c ? Math.min(1, (c.flags || 0) / encountered(c)) : 0; };
const lowShare = (r) => { const c = shared(r); return c && c.avg != null && c.avg <= 2 ? Math.min(1, (c.raters || 0) / encountered(c)) : 0; };
// How often a recording led to a right answer, across everyone (v1.4.6). Each answer counts
// from the first (v1.8.3, was 5+ answers): the rate starts at a neutral RATE_PRIOR and moves
// towards the real rate as answers come in (RATE_WEIGHT = how many answers that prior is
// worth). Below REC_CONFUSING it is dropped like a flagged one; otherwise it nudges the order.
const RATE_PRIOR = 0.6;
const RATE_WEIGHT = 5;
const REC_CONFUSING = 0.3;
const answersOn = (r) => { const c = shared(r); return c ? (c.ok || 0) + (c.no || 0) : 0; };
const rightRate = (r) => {
  const n = answersOn(r);
  return n ? (shared(r).ok + RATE_PRIOR * RATE_WEIGHT) / (n + RATE_WEIGHT) : null;
};
const flaggedByOthers = (r) => {
  const c = shared(r);
  if (!c) return false;
  const lows = c.avg != null && c.avg <= 2 ? c.raters || 0 : 0;
  return Math.max(c.flags || 0, lows) / (encountered(c) + DROP_WEIGHT) >= DROP_SHARE;
};
const sharedOff = (r) => {
  if (!shared(r)) return false;
  const rate = rightRate(r);
  return flaggedByOthers(r) || (rate != null && rate < REC_CONFUSING);
};
// Everyone's average stars, weighted by the share of people who rated it.
const sharedStars = (r) => {
  const c = shared(r);
  return c && c.raters && c.avg != null ? 3 + (c.avg - 3) * Math.min(1, c.raters / encountered(c)) : null;
};
// How slow a recording is to start, 0-1 (v1.8.2, shared load times, supabase/14): the share
// of the people who played it who had to wait. Scales with how many encountered it, not a
// fixed number of people (user's rule): 1 of 1 = 1, 2 of 5 = 0.4, 2 of 10 = 0.2. Moves it
// down the order by that much when the bird has others; it is never dropped for it.
const slowShared = (r) => {
  const c = shared(r);
  const people = c ? Math.max(c.playPeople || 0, c.waitPeople || 0) : 0;
  return people ? Math.min(1, (c.waitPeople || 0) / people) : 0;
};
// Big file (v1.8.1, user): over BIG_KB, by the size anyone who shares has seen (shared
// totals) or this device has, so it needs only one download by anyone; before that, very long
// recordings count as big. Moves down like a slow one, never dropped for it.
const BIG_KB = 3072;
const bigRec = (r) => {
  const kb = shared(r)?.kb || (fileSizes.get(r.file) || 0) / 1024;
  return kb ? kb > BIG_KB : (r.secs || 0) > 120;
};

// How long people listen to a recording before answering (v1.9.7), and how much of it is
// played: long recordings only play their first part (a media fragment: the file itself is
// never changed, fine for no-derivatives licences), so less has to stream. The part is 1.5x the
// average listening time for THAT recording, at least LIMIT_MIN s. A recording few people heard
// leans on the average over all recordings (LISTEN_WEIGHT listens' worth), like the other shared
// numbers. Tap play again after it stops to hear the rest.
const LISTEN_PRIOR = 10;
const LISTEN_WEIGHT = 3;
const LIMIT_MIN = 15;
const LIMIT_MARGIN = 1.5;
let listenAll = LISTEN_PRIOR;
try { const c = JSON.parse(localStorage.getItem('bird-sounds-listen-all')); if (c > 0) listenAll = c; } catch { /* default */ }
const listenAvg = (r) => {
  const c = shared(r);
  return ((c?.listenSecs || 0) + listenAll * LISTEN_WEIGHT) / ((c?.listens || 0) + LISTEN_WEIGHT);
};
const playLimit = (r) => Math.max(LIMIT_MIN, Math.round(listenAvg(r) * LIMIT_MARGIN));
// The part of a recording to play: its hand-set range, or the first playLimit seconds of a long one.
const clipOf = (r) => (r.t ? r.t : (r.secs || 0) > playLimit(r) + 3 ? [0, playLimit(r)] : null);
const fragFor = (r) => { const t = clipOf(r); return t ? `#t=${t[0]},${t[1]}` : ''; };

async function loadScores(force = false) {
  if (!Sync.configured || !navigator.onLine) return;
  try {
    const c = JSON.parse(localStorage.getItem(SCORES_KEY));
    // Kept 15 minutes (was 6 h, v1.9.3: new ratings took hours to show).
    if (!force && c && Date.now() - c.at < 15 * 60e3) return;
  } catch { /* fetch */ }
  try {
    const rows = await Sync.recScores();
    scores = Object.fromEntries((rows || []).map((x) => [x.rec, { flags: x.flags, raters: x.raters, avg: x.avg_stars == null ? null : +x.avg_stars, ok: x.right_answers || 0, no: x.wrong_answers || 0,
      plays: x.plays || 0, waits: x.waits || 0, waitPeople: x.wait_people || 0, kb: x.size_kb || 0, playPeople: x.play_people || 0,
      listenSecs: x.listen_secs || 0, listens: x.listens || 0 }]));
    const ls = (rows || []).reduce((n, x) => n + (x.listen_secs || 0), 0);
    const lc = (rows || []).reduce((n, x) => n + (x.listens || 0), 0);
    listenAll = (ls + LISTEN_PRIOR * LISTEN_WEIGHT) / (lc + LISTEN_WEIGHT);
    localStorage.setItem(SCORES_KEY, JSON.stringify({ at: Date.now(), map: scores }));
    try { localStorage.setItem('bird-sounds-listen-all', JSON.stringify(listenAll)); } catch { /* full */ }
    if (cur) renderRecInfo();
  } catch (e) { console.warn('recording scores', e); }
}

// Shared difficulty (supabase/9-shared-bird-difficulty.sql): a bird many people struggle
// with moves one ease group later for everyone (only affects birds not yet in play), and
// pairs many people mix up are kept apart like the hand-made sound-alikes. The user's
// iconic birds (ease 0) never move. Cached 6 h like the recording scores.
const DIFF_KEY = 'bird-sounds-difficulty';
// Votes scale with the user base (user 2026-11-17): with one user, they are the whole base.
const SHARED_HARD_SHARE = 0.5;  // share of people (who answered it 3+ times) missing it more than not
const SHARED_PAIR_SHARE = 0.25; // share of the people who answered both birds who mixed them up 2+ times
let community = { hard: [], pairs: [] };
try { community = JSON.parse(localStorage.getItem(DIFF_KEY))?.data || community; } catch { /* none yet */ }
let communityHard = new Set(community.hard);

async function loadDifficulty() {
  if (!Sync.configured || !navigator.onLine) return;
  try {
    const c = JSON.parse(localStorage.getItem(DIFF_KEY));
    if (c && Date.now() - c.at < 6 * 3600e3) return;
  } catch { /* fetch */ }
  try {
    const [birds, mixes] = await Promise.all([Sync.birdStats(), Sync.mixStats()]);
    // Pairs (v1.8.3, user's rule): a share of the people who encountered BOTH birds (answered
    // each 3+ times), not of the whole user base: 1 of 1 counts.
    const met = Object.fromEntries((birds || []).map((x) => [x.bird, x.users]));
    const both = (x) => Math.max(x.users, Math.min(met[x.a] || 0, met[x.b] || 0), 1);
    const data = {
      hard: (birds || []).filter((x) => x.strugglers >= 1 && x.strugglers / x.users >= SHARED_HARD_SHARE).map((x) => x.bird).sort(),
      pairs: (mixes || []).filter((x) => x.users / both(x) >= SHARED_PAIR_SHARE).map((x) => [x.a, x.b]).sort(),
    };
    localStorage.setItem(DIFF_KEY, JSON.stringify({ at: Date.now(), data }));
    if (JSON.stringify(data) !== JSON.stringify(community)) {
      community = data;
      communityHard = new Set(data.hard);
      applyArea();
      renderTop();
    }
  } catch (e) { console.warn('shared difficulty', e); }
}

function isOff(r) {
  const p = recPref(r);
  if (p.flag || (p.stars ?? 3) <= 2) return true;
  if (p.stars || p.keep) return false;
  return sharedOff(r);
}

// ---------- every recording of a bird ("Other recording") ----------
// "Other recording" goes through the 1-2 study recordings, then the bird's other candidates,
// then EVERY xeno-canto recording made in Africa (data/recs/<id>.json from
// scripts/build_all_recs.py, fetched only when needed), nearest to the user and best quality
// first (user 2026-11-18: e.g. no Southern Boubou whistle among the 8 candidates).
const allRecs = {}; // bird id -> recordings from data/recs, once loaded
const allRecsLoading = {};

function loadAllRecs(id) {
  if (allRecs[id] || allRecsLoading[id]) return allRecsLoading[id] || Promise.resolve();
  allRecsLoading[id] = fetch(`data/recs/${id}.json`)
    .then((res) => (res.ok ? res.json() : []))
    .then((rows) => { allRecs[id] = rows.map((r) => ({ ...r, file: `https://xeno-canto.org/${r.xc}/download`, bird: id })); })
    .catch(() => { allRecs[id] = []; })
    .finally(() => { delete allRecsLoading[id]; });
  return allRecsLoading[id];
}

// Rough centre of each region, for "nearest recordings first" (not in areas.json).
const AREA_CENTER = {
  all: [-28, 25], za: [-29, 25], wc: [-33.5, 20.5], 'cape-town': [-33.95, 18.5], 'table-mountain': [-34.1, 18.4],
  'west-coast-np': [-33.15, 18.1], cederberg: [-32.35, 19.05], overberg: [-34.4, 19.8], 'de-hoop': [-34.45, 20.4],
  'karoo-np': [-32.3, 22.5], 'garden-route': [-33.9, 22.8], george: [-33.97, 22.52], mylist: [-33.97, 22.52],
  ec: [-32.3, 26.5], gqeberha: [-33.95, 25.6], addo: [-33.45, 25.75], 'mountain-zebra': [-32.25, 25.45],
  nc: [-29.5, 21.5], kgalagadi: [-25.8, 20.5], augrabies: [-28.6, 20.35], namaqua: [-30.1, 17.6],
  fs: [-28.7, 26.5], 'golden-gate': [-28.5, 28.6], kzn: [-28.7, 30.8], durban: [-29.85, 31.0],
  isimangaliso: [-28.0, 32.5], hluhluwe: [-28.2, 31.95], drakensberg: [-29.3, 29.3], gp: [-26.1, 28.1],
  johannesburg: [-26.2, 28.05], pretoria: [-25.75, 28.2], lp: [-23.6, 29.5], mapungubwe: [-22.2, 29.4],
  marakele: [-24.45, 27.6], magoebaskloof: [-23.88, 29.98], mp: [-25.6, 30.5], kruger: [-24.0, 31.5],
  wakkerstroom: [-27.35, 30.15], nw: [-26.0, 25.5], pilanesberg: [-25.25, 27.1], na: [-22.5, 17.5],
  etosha: [-18.85, 16.3], 'namib-naukluft': [-24.5, 15.5], bw: [-22.3, 24.0], okavango: [-19.3, 22.9],
  chobe: [-18.6, 24.5], zw: [-19.0, 29.8], hwange: [-18.75, 26.5], 'victoria-falls': [-17.93, 25.85],
  gonarezhou: [-21.5, 31.8], mz: [-23.5, 33.5], 'maputo-reserve': [-26.4, 32.8], ls: [-29.6, 28.25], sz: [-26.5, 31.5],
};

// Where the user is: their Near me location, else the centre of their region (or a parent).
function userPoint() {
  if (currentAreaId() === 'near') {
    try {
      const n = JSON.parse(localStorage.getItem(NEAR_KEY));
      if (n?.lat != null) return [n.lat, n.lng];
    } catch { /* fall through */ }
  }
  for (let a = areaById(currentAreaId()); a; a = areaById(a.parent)) if (AREA_CENTER[a.id]) return AREA_CENTER[a.id];
  return AREA_CENTER.george;
}

function kmBetween([la1, lo1], [la2, lo2]) {
  const rad = Math.PI / 180;
  const h = Math.sin(((la2 - la1) * rad) / 2) ** 2
    + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(((lo2 - lo1) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

const recKm = (r) => (r.lat != null && r.lon != null ? kmBetween(userPoint(), [r.lat, r.lon]) : null);
// Nearest first; lower quality and other birds in the background count as "further away".
const Q_KM = { A: 0, B: 150, C: 400, D: 900 };
// Clips over 30 s also count as further away: long ones were flagged far more often (v2.0.7).
const nearScore = (r) => (recKm(r) ?? 3000) + (Q_KM[r.q] ?? 600) + 40 * (r.bg || 0) + ((r.secs || 0) > 30 ? 150 : 0);

// Recordings from the full list that you rated 4-5 stars become study recordings too. Their
// details are kept with the rating (synced), since the full list isn't always loaded.
function pickedExtras(id) {
  return Object.values(S.recs || {}).filter((p) => p.meta?.bird === id && (p.stars || 0) >= 4).map((p) => p.meta);
}

// Everything "Other recording" goes through, in order.
// After the study recordings, every other one (spares from calls.json included) is sorted by
// distance and quality; the full list supplies the coordinates calls.json doesn't have.
function recList(id) {
  const full = Object.fromEntries((allRecs[id] || []).map((r) => [recKey(r), r]));
  const withPlace = (r) => (full[recKey(r)] ? { ...r, lat: full[recKey(r)].lat, lon: full[recKey(r)].lon, bg: full[recKey(r)].bg } : r);
  const first = activeRecs(id).map(withPlace);
  const seen = new Set(first.map(recKey));
  const rest = [...(calls[id] || []).map(withPlace), ...(allRecs[id] || [])]
    .filter((r) => !seen.has(recKey(r)) && !isOff(r) && seen.add(recKey(r)))
    .sort((a, b) => nearScore(a) - nearScore(b));
  return [...first, ...rest];
}

// ---------- medals (v1.5.0, learn.js) ----------
// Bronze = mastered on the study recordings. A mastered bird's check cards then play at the
// next level: silver = a random one of its other good recordings (hand-picked spares, then
// the nearest A/B quality ones), gold = any recording of it at all, in random order.
const MEDAL = { 1: '🥉', 2: '🥈', 3: '🥇' };
const MEDAL_NAME = { 1: 'Bronze', 2: 'Silver', 3: 'Gold' };
const LEVEL_NAME = { 2: 'varied sounds', 3: 'any recording' };
const SILVER_SET = 12;

// The recordings a card at this level plays, in order (Next / Previous go on through the rest).
function levelRecs(id, level) {
  const all = recList(id); // study recordings first, then nearest and best first, flagged left out
  const study = new Set(activeRecs(id).map(recKey));
  const others = all.filter((r) => !study.has(recKey(r)));
  let pick = level >= 3 ? others.slice() : others.filter((r) => !r.q || r.q === 'A' || r.q === 'B').slice(0, SILVER_SET);
  if (pick.length < 2) pick = others.length ? others.slice() : all.slice(); // too few: whatever there is
  const picked = new Set(pick.map(recKey));
  // Random, but quick ones first: slow-to-start (shared load times) and long (> 90 s, big
  // files) recordings go after the others (v1.7.9).
  const heavy = (r) => slowShared(r) * 2 + (bigRec(r) ? 2 : 0) + ((r.secs || 0) > 90 ? 1 : 0);
  return [...shuffle(pick).sort((a, b) => heavy(a) - heavy(b)), ...all.filter((r) => !picked.has(recKey(r)))];
}

// What this card plays: its own shuffled list on a silver/gold card, else the usual list.
const cardRecs = () => cur.recs || recList(cur.id);

const medalOf = (id) => L.medalOf(S.learn.birds[id]);
function medalChip(id) {
  const m = medalOf(id);
  return m ? `<span class="chip medal" data-tip="${esc(TIPS.medal[m])}">${MEDAL[m]} ${MEDAL_NAME[m]}</span>` : '';
}

// The 1-2 recordings used for study: not flagged, not rated 1-2, highest rated first
// (your rating, else everyone's), otherwise in the order the build script ranked them.
const recStars = (r) => {
  if (recPref(r).stars) return recPref(r).stars; // your own rating always wins
  const rate = rightRate(r);
  return (sharedStars(r) ?? 3) + (rate != null ? (rate - 0.6) * 2.5 : 0) // 100% right = +1, 20% = -1
    - (flagShare(r) + lowShare(r)) * 2 // flagged or rated 1-2 by some of the people who heard it
    - slowShared(r) * 1.5 // slow to start for the people who played it (0-1.5)
    - (bigRec(r) ? 1 : 0); // big file: slow to download
};
function activeRecs(id) {
  const all = [...(calls[id] || []), ...pickedExtras(id)];
  const ok = all.filter((r) => !isOff(r));
  return (ok.length ? ok : all)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => recStars(b.r) - recStars(a.r) || a.i - b.i)
    .slice(0, 2)
    .map((x) => x.r);
}

// Photo sizes (v2.1.2): iNat serves square 75 / small 240 / medium 500 / large 1024 px, same name
// pattern. Thumbnails (48-52 px, so ~150 px on a 3x phone screen) use small, a quarter of medium's
// bytes; the answer photo and bird page (up to ~360 x 300 px) keep medium.
const thumbUrl = (sp) => (sp.photo?.url || '').replace(/\/medium\.(\w+)$/, '/small.$1');

// Credits share one layout: who · linked number at the source · licence (· country).
const extLink = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${esc(text)}</a>`;
const licLabel = (code) => (code === 'cc0' ? 'CC0' : String(code || '').replace(/^cc-/, 'CC ').toUpperCase());

function photoCredit(sp) {
  const p = sp.photo;
  const id = /\/photos\/(\d+)\//.exec(p.url || '')?.[1];
  if (!p.by) return `Photo: ${esc(p.attr)}${id ? ' · ' + extLink(`https://www.inaturalist.org/photos/${id}`, `iNat ${id}`) : ''}`;
  return `Photo: ${esc(p.by)}${id ? ' · ' + extLink(`https://www.inaturalist.org/photos/${id}`, `iNat ${id}`) : ''} · ${esc(licLabel(p.lic))}`;
}

function credit(r) {
  const link = r.src === 'inat'
    ? extLink(`https://www.inaturalist.org/observations/${r.obs}`, `iNat ${r.obs}`)
    : extLink(`https://xeno-canto.org/${r.xc}`, `XC${r.xc}`);
  return `${esc(r.rec)} · ${link} · ${esc(r.lic)}${r.cnt ? ' · ' + esc(r.cnt) : ''}`;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const TIPS = {
  order: 'The order new birds join your study set. "Easiest to tell apart first" starts with common birds that have distinctive calls and spreads out birds that sound alike.',
  memoryAid: 'A common way birders remember this call. Only shown after you answer.',
  soundsLike: 'Birds you have taken this one for at least twice: from wrong clue choices and your answers to "What did you think it was?".',
  mixUps: 'Pairs you have confused: from wrong picks among clue choices and your answers to "What did you think it was?" after a miss. Play both to compare.',
  hardest: 'Birds you have met and missed at least twice, with the highest share of misses first.',
  area: 'Your home area. Common to Scarce: how often birders come across each bird around here.',
  inPlay: "Birds in your study set: the ones you've met plus any waiting to be introduced. More are added as you master these.",
  met: "Birds you've been introduced to and are now being tested on (includes mastered ones).",
  confused: 'Birds you have mixed this one up with: from wrong clue choices and what you said you thought it was. Pairs you mix up 2+ times get compare cards.',
  mastered: "Mastered birds by medal: 🥉 bronze, 🥈 silver, 🥇 gold. Mastered = birds you've got right enough times to count as known (6 points: each clean right answer +2, with a clue +1, a miss -2, all in one total): each has at least a bronze medal. They still come back now and then, with harder recordings, to earn silver and gold.",
  medal: {
    1: 'Bronze: mastered on its 1-2 study recordings (its typical sound).',
    2: "Silver: also mastered on its varied sounds: random recordings from the bird's other good ones, other calls and songs included.",
    3: 'Gold: mastered from any recording of it at all, any quality, in random order.',
  },
  level: {
    2: 'Silver test: a random recording from this bird\'s varied sounds. 4 points earns silver: clean right +2, with a clue +1, a miss -1, all in one total. Medals are never taken away; a miss just brings it back sooner.',
    3: 'Gold test: any recording of this bird, in random order. 4 points earns gold: clean right +2, with a clue +1, a miss -1, all in one total. Medals are never taken away.',
  },
  habitat: "Where this bird is usually found. From AVONET (Tobias et al. 2022, CC BY 4.0), plus extra habitats for birds often heard elsewhere too.",
  habitats: 'Birds of the habitats you pick join your study set first, in the usual order among themselves; the other birds follow after them. Pick none to mix all habitats. Progress on every bird is kept.',
  points: 'One total for each bird: a clean right answer adds 2 points, one with a clue adds 1; a miss takes 2 off (1 when picking from the 4 choices). 3 right in a row and it has at least 4 points. 6 points = mastered. Hinted and clean answers count together, so e.g. 2 clean + 2 with hints is enough.',
  medalAnswers: 'Answers on silver and gold cards. Counted apart, so the harder recordings do not make this bird look hard for others.',
  streak: 'Birds right in a row: now / your record. A miss starts the current run again from 0. Answers with a clue still count.',
  accuracy: 'How many of your last 20 answers were right.',
  recInfo: "Long recordings play only their first part (at least 15 s, longer when people tend to listen longer); tap play again when it stops to hear the rest. Which recording is playing and what kind of sound it is. The first 1-2 are your study recordings. The ‹ › arrows beside it go through every xeno-canto recording of this bird made in Africa, nearest to your region and best quality first. Rate one 4-5 stars to make it a study recording. ★ 3.8 (5) = everyone's average rating of this recording and how many people rated it.",
  family: 'The bird family this species belongs to.',
  autoChoices: 'While a bird is new to you or you are still getting to know it, you pick it from 4. A right pick earns 1 point (naming it yourself earns 2), a wrong pick costs 1, and 3 right in a row move you on. Once it has 4 of its 6 points you name it from memory to master it; after a miss the choices come back. Turn this off in Settings → Playback.',
  share: 'Optional. When on, your answers, how long recordings took to start and how long you listened, and the birds you mix up are added (with no name and no email) to totals that help everyone: the best recordings are picked, hard birds come later for new learners, and sound-alikes are kept apart. Flags and star ratings you give always count (also anonymous), as you give them on purpose. You still get the benefit of the totals either way. Your progress itself is always saved with your account.',
  soundClue: "A description of this bird's sound. Words from the birds' names are hidden (…) so it doesn't give the answer away.",
  sharedOff: 'Enough of the people who heard this recording flagged it or rated it low that it is no longer used (one person alone only moves it to the back). "Use anyway" brings it back for you.',
  rightRate: 'How often people got this bird right when this recording was the one playing. Recordings people often get right are used first; one most people get wrong (under about 30%, counting every answer and weighing more answers more) is no longer used.',
  sharedStars: 'Average star rating from everyone signed in who rated this recording. Your own rating counts first for you.',
  inUse: 'One of the 2 recordings you study for this bird. Rate or flag recordings to change which ones are used.',
  status: {
    mastered: 'Mastered: you know this one. It comes back now and then, with harder recordings to earn silver and gold medals. Once mastered it stays mastered.',
    learning: "Learning: you've met this bird and are being tested on it.",
    new: "New: in your study set, but you haven't met it yet. It will be introduced soon.",
    later: "Later: you've met this bird, but it's set aside for now because easier birds come first in the current order. Your progress is kept and it comes back when the order reaches it.",
    locked: 'Not yet: not in your study set. Added as you master other birds, or use Progress, Add all birds now.',
  },
};

function tierTip(sp) {
  return `${sp.tier} in ${area}: number ${sp.rank} of the ${areaTotal} birds recorded there, by how often they're recorded. Common = top 40, Regular = 41-100, Uncommon = 101-180, Scarce = the rest.`;
}

function chip(status) {
  const label = { mastered: 'Mastered', learning: 'Learning', new: 'New', later: 'Later', locked: 'Not yet' }[status];
  return `<span class="chip ${status}" data-tip="${esc(TIPS.status[status])}">${label}</span>`;
}

// ---------- tooltips (hover on a computer, tap on a phone) ----------

const tipEl = document.createElement('div');
tipEl.className = 'tip';
tipEl.hidden = true;
document.body.appendChild(tipEl);
let tipTimer = null;
let tipOutTimer = null;

// Placed below the element, or above when there's more room there; a long tip gets the room
// it has and scrolls (it used to run off the bottom of the box).
function showTip(el) {
  clearTimeout(tipOutTimer);
  tipEl.textContent = el.dataset.tip;
  tipEl.style.maxHeight = '';
  tipEl.hidden = false;
  tipEl.scrollTop = 0;
  const r = el.getBoundingClientRect();
  const below = innerHeight - 76 - r.bottom - 8; // 76: the tab bar
  const above = r.top - 16;
  const down = tipEl.offsetHeight <= below || below >= above;
  tipEl.style.maxHeight = `${Math.max(80, down ? below : above)}px`;
  const w = tipEl.offsetWidth;
  const h = tipEl.offsetHeight;
  const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
  const y = down ? r.bottom + 8 : r.top - h - 8;
  // Only a tip that needs scrolling catches the mouse (v1.9.1): otherwise clicks go through it
  // to the buttons underneath (a tip over "Rate / flag" swallowed the click).
  tipEl.classList.toggle('scrolls', tipEl.scrollHeight > tipEl.clientHeight + 2);
  tipEl.style.left = `${x}px`;
  tipEl.style.top = `${Math.max(8, y)}px`;
}

function hideTip() {
  tipEl.hidden = true;
  clearTimeout(tipTimer);
  clearTimeout(tipOutTimer);
}

// Tapped tips stay up longer when they're long, and while being scrolled.
const tipTime = () => Math.min(15000, 3000 + tipEl.textContent.length * 40);
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el) showTip(el);
});
// Leaving the element hides it after a moment, so the mouse can move onto the tip to scroll it.
document.addEventListener('mouseout', (e) => {
  if (e.target.closest('[data-tip]') && !tipEl.contains(e.relatedTarget)) tipOutTimer = setTimeout(hideTip, 250);
});
tipEl.addEventListener('mouseenter', () => clearTimeout(tipOutTimer));
tipEl.addEventListener('mouseleave', hideTip);
tipEl.addEventListener('scroll', () => {
  if (!tipTimer) return;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(hideTip, tipTime());
}, { passive: true });
document.addEventListener('click', (e) => {
  if (tipEl.contains(e.target)) { hideTip(); return; } // a click on a scrolling tip closes it
  const el = e.target.closest('[data-tip]');
  if (el) {
    showTip(el);
    clearTimeout(tipTimer);
    tipTimer = setTimeout(hideTip, tipTime());
  } else hideTip();
}, true);
window.addEventListener('scroll', hideTip, { passive: true });

// ---------- streak ----------

// Streak = birds right in a row; best = the record run. (It used to count days; a saved
// day-based streak has no `run` and simply starts again.)
function streakState() {
  if (!S.streak || S.streak.run === undefined) S.streak = { run: 0, best: 0 };
  return S.streak;
}

// Returns true when this answer sets a new record (worth a message once it's 5 or more).
function bumpStreak(correct) {
  const st = streakState();
  st.run = correct ? st.run + 1 : 0;
  if (st.run > st.best) {
    st.best = st.run;
    return st.best >= 5;
  }
  return false;
}

const currentStreak = () => streakState().run;

// ---------- audio ----------

let audio = $('audio');
// Listeners on the player, kept so they move along when a pre-loaded player takes over (swapAudio).
const audioHandlers = [];
function onAudio(ev, fn) { audioHandlers.push([ev, fn]); audio.addEventListener(ev, fn); }
// Streamed recordings keep their player (and what it has loaded) for this session, so going
// back to one (Previous, the same card again) plays at once (v1.9.5, user). Files downloaded
// whole are kept on the device anyway (Cache API), across sessions.
let audioFile = null; // the recording the player holds, when streamed
const sessionPlayers = new Map(); // file -> player that streamed it (at most SESSION_MAX)
const SESSION_MAX = 6;
function swapAudio(el, file) {
  if (el === audio) return;
  for (const [ev, fn] of audioHandlers) { audio.removeEventListener(ev, fn); el.addEventListener(ev, fn); }
  audio.pause();
  if (audioFile && /^https?:/.test(audio.currentSrc || audio.src)) {
    sessionPlayers.delete(audioFile);
    sessionPlayers.set(audioFile, audio);
    while (sessionPlayers.size > SESSION_MAX) {
      const [f, old] = sessionPlayers.entries().next().value;
      sessionPlayers.delete(f);
      old.removeAttribute('src');
      old.load();
    }
  }
  el.volume = audio.volume;
  audio = el;
  audioFile = file || null;
}

// Volume is per device (phone and laptop differ), so it is kept outside the synced store.
// iOS ignores audio.volume (hardware buttons only) and newer versions still report the set
// value, so the slider is hidden on iPhone/iPad by name as well as by the test.
// The slider is cubed into audio.volume: ears hear loudness on a log scale, so a straight
// 0-1 slider barely changed anything over its top half.
const VOL_KEY = 'bird-sounds-volume';
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const volWorks = !isIOS && (() => { const t = new Audio(); t.volume = 0.5; return t.volume === 0.5; })();
let volume = 1;
try { const v = parseFloat(localStorage.getItem(VOL_KEY)); if (v >= 0 && v <= 1) volume = v; } catch { /* private mode */ }
const applyVolume = () => { audio.volume = volume ** 3; };
applyVolume();
$('volume').value = volume;
$('volRow').hidden = !volWorks;
const volIcon = () => $('volBtn').classList.toggle('muted', volume === 0);
volIcon();
$('volume').addEventListener('input', (e) => {
  volume = parseFloat(e.target.value);
  applyVolume();
  volIcon();
  try { localStorage.setItem(VOL_KEY, String(volume)); } catch { /* private mode */ }
});
$('volBtn').addEventListener('click', () => {
  const open = $('volRow').classList.toggle('open');
  $('volBtn').setAttribute('aria-expanded', open);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#volRow')) $('volRow').classList.remove('open');
});
let audioKey = null;
let playSeq = 0; // bumps on every new play/stop, so a slow load from an earlier card can't take over
let audioSecs = 0; // stored length of the playing clip, used until the browser knows the duration
let clipEnd = null; // a long recording plays its first clipEnd s (playLimit); null = all of it
let playFile = null; // the file being played
let playPart = false; // only its first part is saved: the rest streams (v2.0.2)
let audioOwner = null;
let blobUrl = null;

async function srcFor(r) {
  try {
    const cache = await caches.open(MEDIA_CACHE);
    const hit = await cache.match(r.file);
    if (hit) {
      // Offline copy: play from a blob URL (works on iOS, which rejects cached media through a service worker).
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      const blob = await hit.blob();
      playPart = !!hit.headers.get('x-part');
      if (!playPart) fileSizes.set(r.file, blob.size); // also for files saved in an earlier session (load-time totals)
      blobUrl = URL.createObjectURL(blob);
      return blobUrl + fragFor(r);
    }
  } catch { /* Cache API unavailable */ }
  return r.file + fragFor(r);
}

async function playRec(r, button) {
  const key = recKey(r);
  // Still loading this one: ignore extra taps. (They used to resume the PREVIOUS sound,
  // which was still in the player, so the button seemed to need several taps.)
  if (audioKey === key && audioOwner === button && button.classList.contains('loading')) return;
  if (audioKey === key && audioOwner === button) {
    if (!audio.paused) { playTimed = null; return audio.pause(); }
    if (audio.ended) audio.currentTime = 0;
    if (clipEnd && audio.currentTime >= clipEnd - 0.5) { // after the first part: play on
      clipEnd = null;
      if (playPart && navigator.onLine) { // only that part is saved: stream the rest from here
        const t = audio.currentTime;
        playPart = false;
        audio.src = r.file;
        audio.addEventListener('loadedmetadata', () => { audio.currentTime = t; }, { once: true });
      }
    }
    return audio.play().catch(() => {});
  }
  const seq = ++playSeq;
  if (button === $('playBtn') && cur && !cur.timed) { cur.timed = true; playTimed = { seq, key, file: r.file, t0: performance.now() }; }
  audioKey = key;
  audioOwner = button;
  playFile = r.file;
  playPart = false;
  const clip = clipOf(r);
  clipEnd = clip && !r.t ? clip[1] : null;
  audioSecs = clip ? clip[1] - clip[0] : r.secs || 0;
  $('recError').hidden = true;
  setPlaying(button, 'loading');
  loadingFile = r.file;
  showLoad(r.file);
  // Saved on the device: play that. A hidden player already loading its start (v1.9.5): it
  // takes over and plays at once. A big file: stream straight away. Otherwise download it whole
  // first (ring shows how far), so it plays straight through; a slow download (v1.8.7: 1.7 MB
  // took 35 s) isn't waited for: after STREAM_AFTER_MS, unless nearly done, it streams instead.
  const saved = await caches.open(MEDIA_CACHE).then((c) => c.match(r.file)).catch(() => null);
  if (seq !== playSeq) return;
  const kept = !saved && (sessionPlayers.get(r.file) || preloads.get(r.file));
  if (kept || (!saved && !wantWhole(r) && navigator.onLine)) {
    if (kept) {
      sessionPlayers.delete(r.file);
      preloads.delete(r.file);
      swapAudio(kept, r.file);
      if (kept.ended) kept.currentTime = 0;
    } else {
      const el = new Audio();
      el.preload = 'auto';
      el.src = r.file + fragFor(r);
      swapAudio(el, r.file);
    }
    button.classList.add('spin');
    keepLater.set(r.file, r); // streamed: keep a whole copy once things are quiet (v2.0.1)
    return startPlay(r, button, seq);
  }
  const late = await Promise.race([cacheRec(r).then(() => false), new Promise((ok) => setTimeout(() => ok(true), STREAM_AFTER_MS))]);
  if (seq !== playSeq) return;
  let src;
  const st = late && loads.get(r.file);
  if (st && !(st.total && st.got / st.total > 0.7)) {
    st.ctrl.abort();
    button.classList.add('spin');
    keepLater.set(r.file, r); // slow download, streamed now: keep a whole copy later
    src = r.file + fragFor(r);
  } else {
    if (late) await cacheRec(r);
    if (seq !== playSeq) return;
    src = await srcFor(r);
  }
  if (seq !== playSeq) return; // a newer card or sound started while this one was loading
  if (audioFile) swapAudio(new Audio(), null); // keep a streamed player for this session; use a fresh one
  audio.src = src;
  if (/^https?:/.test(src)) audioFile = r.file;
  startPlay(r, button, seq);
}

function startPlay(r, button, seq) {
  audio.play().then(() => {
    // Load time = from the card asking for its sound until it actually starts (v1.8.6). Only
    // when it started by itself: if the phone blocked it or it was paused, the wait for the
    // person's own tap would count too (a 35 s "wait" seen that way), so it isn't logged.
    if (playTimed?.seq === seq) logLoad(playTimed, performance.now() - playTimed.t0);
    if (playTimed?.seq === seq) playTimed = null;
  }).catch((e) => {
    if (playTimed?.seq === seq) playTimed = null;
    if (e.name !== 'NotAllowedError' && e.name !== 'AbortError' && button === $('playBtn')) $('recError').hidden = false;
    setPlaying(button, 'paused');
  });
}

function stopAudio() {
  playSeq++;
  audio.pause();
  audioKey = null;
  audioOwner = null;
  setPlaying(null);
  $('barFill').style.width = '0';
}

let playingBtn = null;
function setPlaying(btn, mode) {
  if (playingBtn && playingBtn !== btn) {
    playingBtn.classList.remove('playing', 'loading', 'spin');
    if (playingBtn.classList.contains('mini-play')) playingBtn.innerHTML = PLAY_SVG;
  }
  playingBtn = btn;
  if (!btn) return;
  btn.classList.toggle('loading', mode === 'loading');
  if (mode !== 'loading') btn.classList.remove('spin');
  btn.setAttribute('aria-busy', String(mode === 'loading'));
  btn.classList.toggle('playing', mode === 'playing');
  if (btn.classList.contains('mini-play')) btn.innerHTML = mode === 'playing' ? PAUSE_SVG : PLAY_SVG;
}

// Screen off, app switched away or closed: stop the sound (user v1.7.6: it kept playing in the
// background on the phone). It doesn't start again by itself when you come back.
const stopInBackground = () => { if (!audio.paused) audio.pause(); playTimed = null; };
document.addEventListener('visibilitychange', () => { if (document.hidden) stopInBackground(); });
window.addEventListener('pagehide', stopInBackground);
window.addEventListener('blur', () => { if (document.hidden) stopInBackground(); });

onAudio('playing', () => {
  setPlaying(playingBtn, 'playing');
});

// Load times (v1.7.3): for each card's first play, did its sound start straight away (pw) or
// did the person wait (lw, total ms in lt)? Plus the file size (sz). Kept with the recording
// in S.recs like the right/wrong counts, so it only reaches the shared totals for people who
// share. Reports: supabase/11 (slowest recordings), 12 (how often sounds were ready).
const WAITED_MS = 600; // starting within this counts as straight away
let playTimed = null;
// This device's last 30 first-plays (1 = had to wait), kept on the device only (v1.7.9): when
// more than 15% of 10+ had to wait, the connection is slow, so downloads go two at a time and
// further ahead (prefetchSoon).
const NET_KEY = 'bird-sounds-net';
let netLog = [];
try { netLog = JSON.parse(localStorage.getItem(NET_KEY)) || []; } catch { /* none yet */ }
const slowNet = () => netLog.length >= 10 && netLog.filter(Boolean).length / netLog.length > 0.15;
function logLoad({ key, file }, ms) {
  netLog = [...netLog.slice(-29), ms > WAITED_MS ? 1 : 0];
  try { localStorage.setItem(NET_KEY, JSON.stringify(netLog)); } catch { /* storage full */ }
  const p = (S.recs[key] ||= {});
  if (ms > WAITED_MS) { p.lw = (p.lw || 0) + 1; p.lt = (p.lt || 0) + Math.round(ms); } else p.pw = (p.pw || 0) + 1;
  // Per device type, from v1.9.5 on (report 12 compares phone and computer from here):
  // m = phone/tablet (touch screen), d = computer. *w = waited, *t = ms waited, *p = straight away.
  const dev = matchMedia('(pointer: coarse)').matches ? 'm' : 'd';
  if (ms > WAITED_MS) { p[dev + 'w'] = (p[dev + 'w'] || 0) + 1; p[dev + 't'] = (p[dev + 't'] || 0) + Math.round(ms); } else p[dev + 'p'] = (p[dev + 'p'] || 0) + 1;
  if (fileSizes.has(file)) p.sz = fileSizes.get(file);
  save();
}
onAudio('pause', () => {
  setPlaying(playingBtn, 'paused');
  // Stopped at the end of the first part of a long recording: say how to hear the rest (3 times).
  if (clipEnd && audio.currentTime >= clipEnd - 0.5 && (S.prefs.clipTips || 0) < 3) {
    S.prefs.clipTips = (S.prefs.clipTips || 0) + 1;
    save();
    toast(`Played the first ${Math.round(clipEnd)} s: tap play again for the rest`);
  }
});
onAudio('playing', () => { listenLast = audio.currentTime; });
onAudio('seeking', () => { listenLast = null; });
let listenLast = null;
let listenAcc = {}; // recording key -> seconds listened on this card
// Add this card's listening to each recording's totals (S.recs[key].ls seconds, .lc times).
function flushListen() {
  for (const [k, secs] of Object.entries(listenAcc)) {
    if (secs < 0.5) continue;
    const p = (S.recs[k] ||= {});
    p.ls = (p.ls || 0) + Math.round(secs);
    p.lc = (p.lc || 0) + 1;
  }
  listenAcc = {};
  listenLast = null;
}
onAudio('ended', () => setPlaying(playingBtn, 'paused'));
onAudio('timeupdate', () => {
  if (playingBtn !== $('playBtn')) return;
  // xeno-canto doesn't send the file length up front, so the browser often only learns the
  // duration at the end of the download.
  const d = clipEnd || (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : audioSecs);
  const p = d ? Math.min(100, (audio.currentTime / d) * 100) : 0;
  $('barFill').style.width = `${p}%`;
  // Listening time on a card before it's answered (or left), per recording.
  if (audioOwner === $('playBtn') && cur?.stage === 'guess' && audioKey) {
    const t = audio.currentTime;
    if (listenLast != null && t > listenLast && t - listenLast < 1.5) listenAcc[audioKey] = (listenAcc[audioKey] || 0) + (t - listenLast);
    listenLast = t;
  }
});
// Tap or drag the progress bar to jump to another part of the recording. If this recording
// isn't playing yet, it starts and then jumps once the browser knows where it can go.
let pendingSeek = null;
function audioLength() {
  return clipEnd || (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : audioSecs);
}
function seekTo(frac) {
  frac = Math.max(0, Math.min(1, frac));
  $('barFill').style.width = `${frac * 100}%`;
  const r = currentRec();
  if (!r) return;
  if (audioKey !== recKey(r) || audioOwner !== $('playBtn')) {
    pendingSeek = frac;
    playRec(r, $('playBtn'));
    return;
  }
  const d = audioLength();
  if (d) audio.currentTime = frac * d;
  else pendingSeek = frac;
  if (audio.paused) audio.play().catch(() => {});
}
['loadedmetadata', 'playing'].forEach((ev) => onAudio(ev, () => {
  const d = audioLength();
  if (pendingSeek == null || !d || audioOwner !== $('playBtn')) return;
  audio.currentTime = pendingSeek * d;
  pendingSeek = null;
}));
{
  const seek = $('seek');
  const frac = (e) => { const b = seek.getBoundingClientRect(); return (e.clientX - b.left) / b.width; };
  seek.addEventListener('pointerdown', (e) => {
    seek.setPointerCapture(e.pointerId);
    seek.classList.add('dragging');
    seekTo(frac(e));
  });
  seek.addEventListener('pointermove', (e) => { if (seek.classList.contains('dragging')) seekTo(frac(e)); });
  const end = () => seek.classList.remove('dragging');
  seek.addEventListener('pointerup', end);
  seek.addEventListener('pointercancel', end);
}

onAudio('error', () => {
  if (!audioKey) return;
  setPlaying(playingBtn, 'paused');
  // A saved copy that won't play (damaged): forget it, so it downloads fresh next time.
  if (playFile && /^blob:/.test(audio.currentSrc || audio.src)) caches.open(MEDIA_CACHE).then((c) => c.delete(playFile)).catch(() => {});
  // A recording that won't load (seen on a gold card on an iPhone): try the next one by itself,
  // twice at most per card (v1.9.6). It doesn't count as pressing "Next recording".
  if (audioOwner === $('playBtn') && cur && (cur.autoNext || 0) < 2 && cardRecs().length > 1 && navigator.onLine) {
    cur.autoNext = (cur.autoNext || 0) + 1;
    toast("Couldn't load that recording: trying the next one");
    stepRec(1, true);
    return;
  }
  if (audioOwner === $('playBtn')) $('recError').hidden = false;
});

// ---------- study ----------

function currentRec() {
  const recs = cardRecs();
  return recs[Math.min(cur.recIdx, recs.length - 1)];
}

// Choices shown by themselves while a bird is new or shaky (v1.6.2, user: beginners get
// frustrated; a simple progression for everyone). v1.6.7 (user: still not shown for birds
// they struggle with or are fairly new to): until it is nearly mastered (L.NEARLY_SCORE, 4
// points), and always on the card after a miss. Right picks earn +1 like a hint, so the last
// step to mastered is named from memory. Never on silver/gold cards. Settings -> Playback.
function autoChoices(id) {
  if (S.prefs.autoChoices === false) return false;
  const b = S.learn.birds[id];
  return !b?.m && ((b?.s || 0) < L.NEARLY_SCORE || !!b?.miss);
}

async function newCard() {
  if (overlayOpen()) return; // welcome or survey showing: start when it closes
  flushListen(); // a card left without answering still counts its listening
  stopAudio();
  const c = L.nextCard(S.learn, species, Math.random, { intros: S.prefs.intros });
  save();
  const card = { ...c, level: c.level || 1, recs: null, recIdx: 0, stage: c.intro ? 'intro' : c.compare ? 'compare' : 'guess', hint: 0, choices: null, chose: null, thought: '' };
  cur = card;
  if (card.level > 1) { // silver / gold: a random recording from the bird's wider set
    const plan = planned.get(c.id); // picked (and downloaded) ahead by prefetchSoon
    if (plan?.level === card.level && plan.recs.length) card.recs = plan.recs.filter((x) => !isOff(x));
    else {
      await loadAllRecs(c.id);
      if (cur !== card) return;
      card.recs = levelRecs(c.id, card.level);
    }
  }
  planned.delete(c.id);
  if (c.test) { // "which of the two?" test: both names shown as the choices
    cur.hint = 1;
    cur.choices = shuffle([c.id, c.pair]);
  } else if (card.stage === 'guess' && card.level === 1 && autoChoices(c.id)) {
    cur.hint = 1;
    cur.choices = makeChoices();
    cur.autoHint = true;
  }
  renderCard();
  renderTop();
  const photo = byId[cur.id]?.photo?.url;
  if (photo) new Image().src = photo; // fetch the answer photo while the sound plays
  prefetchSoon();
  if (!S.prefs.autoplay) return;
  if (cur.stage === 'compare') {
    const first = $('hintArea').querySelector('[data-cplay]');
    if (first) playRec(activeRecs(first.dataset.cplay)[0], first);
  } else playRec(currentRec(), $('playBtn'));
}

// Save one recording on the device (Cache API) so it plays at once. Resolves true once it is
// saved (false: plays from the network instead). Download progress is kept in `loads`, for
// the ring around the play button. One download per file, however many callers.
const loads = new Map(); // file -> { got, total, done, ctrl }
const STREAM_AFTER_MS = 3000; // a sound still downloading after this streams instead (playRec)
// v1.9.5 (user: still lots of waiting on the phone): small files are downloaded whole ahead of
// time (quick, and they work offline); bigger ones are not. For those a hidden player loads the
// start (the browser's own "download the first part, stream the rest"); when the card comes,
// that player plays at once. iPhones ignore it to save data, so there it streams as before.
const WHOLE_KB = 1024;
const sizeKb = (r) => shared(r)?.kb || (fileSizes.get(r.file) || 0) / 1024;
const wantWhole = (r) => {
  if (partBytes(r, 0) < Infinity) return true; // long: only its playing part is downloaded
  const kb = sizeKb(r);
  return kb ? kb <= WHOLE_KB : (r.secs || 0) <= 30;
};
const preloads = new Map(); // file -> hidden <audio> loading its start (at most PRELOAD_MAX)
// Streamed recordings, saved in the background afterwards (v2.0.1: big files streamed again every
// time, e.g. 3 waits on the same recording): the whole file, or its playing part when long (v2.0.2).
const keepLater = new Map(); // file -> recording
const PRELOAD_MAX = 3;
function warmRec(r) {
  if (!r || preloads.has(r.file) || !navigator.onLine) return;
  const el = new Audio();
  el.preload = 'auto';
  el.src = r.file + fragFor(r);
  el.load();
  preloads.set(r.file, el);
  while (preloads.size > PRELOAD_MAX) {
    const [f, old] = preloads.entries().next().value;
    preloads.delete(f);
    if (old !== audio) { old.removeAttribute('src'); old.load(); }
  }
}
// Get a recording ready ahead of time: whole download when small, else a hidden player.
const prepRec = (r) => (r ? (wantWhole(r) ? cacheRec(r) : (warmRec(r), Promise.resolve(true))) : Promise.resolve(false));
// v2.0.2: long recordings only need their playing part, so they're downloaded too (that part),
// on every phone; the hidden players are only left for recordings with a set range.
// Downloads ahead wait while a sound is still loading, so they don't slow it down (v1.9.5).
const soundLoading = () => !!playingBtn?.classList.contains('loading');
const quietTurn = async () => { while (soundLoading()) await new Promise((ok) => setTimeout(ok, 300)); };
const fileSizes = new Map(); // file -> bytes, for the load-time totals
// Bytes that cover a long recording's playing part (playLimit + 4 s): from the file size when
// known, else at ~48 KB per second. Infinity = the whole file (short recordings, set ranges).
function partBytes(r, total) {
  const clip = clipOf(r);
  if (!clip || r.t || !(r.secs > 0)) return Infinity;
  const secs = clip[1] + 4;
  return total ? Math.ceil(total * Math.min(1, secs / r.secs)) : secs * 48 * 1024;
}

function cacheRec(r, whole = false) {
  if (!r) return Promise.resolve(false);
  if (loads.has(r.file)) return loads.get(r.file).done;
  const st = { got: 0, total: 0, ctrl: new AbortController() };
  st.done = (async () => {
    try {
      const cache = await caches.open(MEDIA_CACHE);
      if (await cache.match(r.file)) return true;
      if (!navigator.onLine) return false;
      const res = await fetch(r.file, { mode: 'cors', signal: st.ctrl.signal });
      if (!res.ok) return false;
      st.total = +res.headers.get('content-length') || 0;
      if (st.total) fileSizes.set(r.file, st.total);
      // Long recordings only play their first part (playLimit), so only that part is kept
      // (v2.0.2, user: "16 s is enough"): far less to download. Tapping play for the rest
      // streams it (playRec). whole = keep everything (offline download).
      const part = whole ? Infinity : partBytes(r, st.total);
      if (part < Infinity) st.total = st.total ? Math.min(st.total, part) : part; // ring shows the part
      let blob;
      let cut = false;
      if (res.body?.getReader) {
        const reader = res.body.getReader();
        const parts = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const room = part - st.got; // keep exactly the part, even from a big chunk
          parts.push(value.length > room ? value.subarray(0, room) : value);
          st.got += Math.min(value.length, room);
          showLoad(r.file);
          if (st.got >= part) { cut = value.length >= room; st.ctrl.abort(); break; }
        }
        blob = new Blob(parts, { type: res.headers.get('content-type') || 'audio/mpeg' });
      } else blob = await res.blob();
      const headers = { 'content-type': blob.type, 'content-length': String(blob.size) };
      if (cut) headers['x-part'] = '1';
      await cache.put(r.file, new Response(blob, { headers }));
      if (!cut) fileSizes.set(r.file, blob.size);
      return true;
    } catch { return false; } finally { loads.delete(r.file); }
  })();
  loads.set(r.file, st);
  return st.done;
}

// Ring around the play button while its recording downloads: how far it is (spins when the
// size isn't known).
let loadingFile = null;
function showLoad(file) {
  const btn = playingBtn;
  if (file !== loadingFile || !btn?.classList.contains('loading')) return;
  const st = loads.get(file);
  const pct = st?.total ? Math.min(100, Math.round((st.got / st.total) * 100)) : null;
  btn.classList.toggle('spin', pct == null);
  btn.style.setProperty('--p', pct ?? 0);
}

// The cards most likely to come next (bird id -> card level): the learning rules are run
// ahead on copies of the progress, after a right and after a wrong answer.
function likelyNext(tries = 4) {
  const out = new Map();
  if (!cur) return out;
  const c = cur;
  const acts = c.stage === 'intro' ? [(s) => L.introduced(s, c.id)]
    : c.stage === 'compare' ? [(s) => L.compared(s, c.id, c.pair)]
    : [true, false].map((ok) => (s) => L.answer(s, species, c.id, { correct: ok, pair: c.pair || null, level: c.level }));
  for (const act of acts) {
    const base = structuredClone(S.learn);
    act(base);
    for (let i = 0; i < tries; i++) {
      const n = L.nextCard(structuredClone(base), species, Math.random, { intros: S.prefs.intros });
      if (!out.has(n.id)) out.set(n.id, n.level || 1);
      if (n.pair && !out.has(n.pair)) out.set(n.pair, 1);
    }
  }
  out.delete(c.id);
  return out;
}

// Download this card's sound first, then the sounds of the cards most likely to come next
// (silver/gold cards get their random recording picked now, in `planned`), then this card's
// next recording. One file at a time, so nothing waits when the card comes up.
const planned = new Map(); // bird id -> { level, recs }
let prefetchRun = 0;
async function prefetchSoon() {
  const run = ++prefetchRun;
  const card = cur;
  if (!card) return;
  const now = card.stage === 'compare' ? [activeRecs(card.id)[0], activeRecs(card.pair)[0]] : [currentRec()];
  const slow = slowNet(); // this device often waits: two at a time, and more of the likely next birds
  if (card.stage !== 'compare') loadAllRecs(card.id); // full list now, so "Next recording" knows its order
  if (!slow || navigator.connection?.saveData) for (const r of now) await prepRec(r);
  if (run !== prefetchRun || !navigator.onLine || navigator.connection?.saveData) return;
  const tasks = slow ? now.map((r) => () => prepRec(r)) : [];
  // This card's next recording second (v1.8.5: people press "Next recording" when unsure),
  // in the order the full list gives it.
  tasks.push(async () => {
    if (card.stage === 'compare') return;
    await loadAllRecs(card.id);
    if (cur === card) await prepRec(cardRecs()[card.recIdx + 1]);
  });
  for (const [id, level] of likelyNext(slow ? 8 : 4)) {
    tasks.push(async () => {
      let r = activeRecs(id)[0];
      if (level > 1) {
        await loadAllRecs(id);
        let plan = planned.get(id);
        if (plan?.level !== level) { plan = { level, recs: levelRecs(id, level) }; planned.set(id, plan); }
        r = plan.recs[0];
      }
      await prepRec(r);
      const ph = byId[id]?.photo?.url;
      if (ph) new Image().src = ph; // its answer photo too (the service worker keeps it)
    });
  }
  // Last: whole copies of recordings that were streamed (not the one playing now).
  for (const [file, r] of keepLater) {
    if (file === playFile && !audio.paused) continue;
    tasks.push(async () => { keepLater.delete(file); await cacheRec(r); });
  }
  let i = 0;
  const worker = async () => {
    while (i < tasks.length && run === prefetchRun) {
      await quietTurn(); // not while a sound is loading
      if (run !== prefetchRun) return;
      try { await tasks[i++](); } catch { /* best effort */ }
    }
  };
  await Promise.all(Array.from({ length: slow ? 2 : 1 }, worker));
}

function renderCard() {
  const sp = byId[cur.id];
  const recs = cardRecs();
  const r = currentRec();
  const shown = cur.stage !== 'guess' && cur.stage !== 'compare';

  const label = $('cardLabel');
  label.className = 'card-label' + (cur.intro || cur.stage === 'compare' ? ' new' : '');
  label.textContent = cur.intro ? 'New bird: listen and learn'
    : cur.stage === 'compare' ? 'You mix these two up: compare'
    : shown ? 'Answer'
    : cur.pair ? 'Which of the two is this?'
    : cur.level > 1 ? `Who's calling? ${MEDAL[cur.level]} ${LEVEL_NAME[cur.level]}`
    : cur.autoHint ? "Who's calling? Pick one"
    : "Who's calling?";
  if (cur.level > 1 && !shown) label.dataset.tip = TIPS.level[cur.level];
  else if (cur.autoHint && !shown) label.dataset.tip = TIPS.autoChoices;
  else delete label.dataset.tip;
  document.querySelector('.player').hidden = cur.stage === 'compare';
  // Choosing from birds: a smaller player, so the choices fit on the screen (v1.9.6).
  $('card').classList.toggle('picking', cur.stage === 'guess' && cur.hint > 0 && !!cur.choices);
  // Where it's usually found (user v1.6.8: on the guess card too, as a gentle clue). Not on
  // "which of the two?" tests, where it could give the answer away.
  const hab = cur.stage === 'guess' && !cur.pair ? habitatChips(cur.id) : '';
  $('cardHab').innerHTML = hab;
  $('cardHab').hidden = !hab;

  $('recInfo').dataset.tip = TIPS.recInfo;
  renderRecInfo();
  $('otherRecBtn').disabled = false;
  $('prevRecBtn').disabled = cur.recIdx === 0 && !allRecs[cur.id]; // nothing behind the first until the list is loaded
  $('recError').hidden = true;
  $('bar').hidden = false;

  // Hints
  const ha = $('hintArea');
  if (cur.stage === 'compare') {
    ha.innerHTML = '<p class="small muted" style="margin:0 0 6px">Listen to both. A few cards from now you will hear one of them and pick which it is.</p>'
      + [cur.id, cur.pair].map((id) => {
        const b = byId[id];
        return `<div class="compare-row">
          <button class="mini-play" id="cmp-${id}" data-cplay="${id}" aria-label="Play ${esc(nm(b))}">${PLAY_SVG}</button>
          ${b.photo ? `<img src="${esc(thumbUrl(b))}" alt="">` : ''}
          <div class="nm">${esc(nm(b))}</div>
        </div>`;
      }).join('');
    ha.hidden = false;
  } else if (!shown && cur.hint > 0) {
    // Hints never name the family or show the photo (that gives the answer away):
    // hint 1 = pick from 4 birds, hint 2 = two of the wrong ones are crossed out.
    const out = new Set(cur.removed || []);
    const clue = hintClue(cur.id, cur.choices);
    ha.innerHTML = (clue ? `<div class="sound-tip" data-tip="${esc(TIPS.soundClue)}"><b>Sound clue:</b> ${esc(clue)}</div>` : '')
      + `<div class="hint-text">${cur.pair ? 'Which of these two?' : '👇 Tap the bird you hear'}</div>
      <div class="choices">${cur.choices.map((id) => out.has(id)
        ? `<button class="choice out" disabled>${esc(nm(byId[id]))}</button>`
        : `<button class="choice" data-choice="${id}">${esc(nm(byId[id]))}</button>`).join('')}</div>`;
    ha.hidden = false;
  } else if (cur.stage === 'graded' && cur.choices) {
    ha.innerHTML = '<div class="choices">' + cur.choices.map((id) => {
      const cls = id === cur.id ? 'right' : id === cur.chose ? 'wrong' : '';
      return `<button class="choice ${cls}" disabled>${esc(nm(byId[id]))}</button>`;
    }).join('') + '</div>';
    ha.hidden = false;
  } else {
    ha.hidden = true;
    ha.innerHTML = '';
  }

  // Reveal
  $('card').classList.toggle('revealed', shown);
  $('reveal').hidden = !shown;
  if (shown) {
    const img = $('revealPhoto');
    if (sp.photo) {
      // Hide until the new photo has loaded, so the previous bird's picture never shows.
      if (img.dataset.src !== sp.photo.url) {
        img.classList.add('loading');
        img.onload = img.onerror = () => img.classList.remove('loading');
        img.dataset.src = sp.photo.url;
        img.src = sp.photo.url;
      }
      img.alt = nm(sp);
      img.hidden = false;
    } else img.hidden = true;
    $('revealName').textContent = nm(sp);
    $('revealSci').textContent = sp.sci;
    $('revealMeta').innerHTML = `<span class="chip" data-tip="${esc(TIPS.family)}">${esc(sp.family)}</span><span class="chip" data-tip="${esc(tierTip(sp))}">${esc(sp.tier)}</span>${chip(L.status(S.learn, sp.id))}${medalChip(sp.id)}${habitatChips(sp.id)}`;
    $('revealTip').innerHTML = soundTipHtml(sp.id);
    $('revealTip').hidden = !$('revealTip').innerHTML;
    $('revealCredit').innerHTML = (r ? `Sound: ${credit(r)}<br>` : '') + (sp.photo ? photoCredit(sp) : '');
  }

  // Buttons
  const a = $('actions');
  if (cur.stage === 'intro') {
    a.innerHTML = '<button class="btn ghost" data-act="skip">Later</button><button class="btn" data-act="introDone">Next bird</button>';
  } else if (cur.stage === 'compare') {
    a.innerHTML = '<button class="btn wide" data-act="compared">Test me later</button>';
  } else if (cur.stage === 'guess' && cur.pair) {
    a.innerHTML = '<button class="btn ghost wide" data-act="reveal">Show the bird</button>';
  } else if (cur.stage === 'thought') {
    a.innerHTML = renderThought();
  } else if (cur.stage === 'guess' && cur.hint > 0) {
    // Choices showing (v1.9.6, user feedback: the green "Reveal" looked like the listen-only card,
    // so people pressed it without seeing the choices): no green button, the choices are the answer.
    a.innerHTML = `<button class="btn ghost" data-act="hint" ${cur.hint >= 2 ? 'disabled' : ''}>Another clue</button>
      <button class="btn ghost" data-act="reveal">Show the bird</button>`;
  } else if (cur.stage === 'guess') {
    a.innerHTML = `<button class="btn ghost" data-act="hint">Clue</button>
      <button class="btn" data-act="reveal">Show the bird</button>`;
  } else if (cur.stage === 'revealed') {
    a.innerHTML = '<button class="btn bad" data-act="missed">Didn&rsquo;t know</button><button class="btn good" data-act="got">Knew it</button>';
  } else {
    a.innerHTML = '<button class="btn wide" data-act="next">Next bird</button>';
  }
  $('skipBtn').hidden = cur.stage !== 'guess'; // intro cards have it beside "Next bird"
}

function renderThought() {
  const q = cur.thought.trim().toLowerCase();
  const hits = q
    ? species.filter((x) => x.id !== cur.id && [...Object.values(x.names), x.listName].some((v) => v.toLowerCase().includes(q))).slice(0, 5)
    : L.confusedWith(S.learn, cur.id).map((c) => byId[c.id]).filter(Boolean).slice(0, 3);
  return `<div class="wide thought">
    <div class="thought-q">What did you think it was?</div>
    <input class="search" id="thoughtInput" type="search" placeholder="Type a few letters" autocomplete="off" value="${esc(cur.thought)}">
    <div class="choices">${hits.map((x) => `<button class="choice" data-thought="${x.id}">${esc(nm(x))}</button>`).join('')}</div>
  </div>
  <button class="btn ghost wide" data-act="next">No idea, next bird</button>`;
}

function makeChoices() {
  const sp = byId[cur.id];
  const pool = new Set(S.learn.pool);
  // Only birds that share a habitat with it (v1.6.9, user: those are the ones you'd really
  // confuse it with in the field; the habitats also show on the card). That goes for the
  // mixed-up birds too (v1.7.8, user); mixed-up pairs from different habitats still get their
  // compare cards ("You mix these two up"). Others only fill in when too few share one.
  const habs = habitats[sp.id] || [];
  const near = (x) => !habs.length || (habitats[x.id] || []).some((h) => habs.includes(h));
  // Birds it gets mixed up with, first (up to 2): your own mix-ups, then the ones other
  // people often mix up, then the hand-made sound-alikes.
  const partners = (pairs) => pairs.flatMap(([a, b]) => (a === sp.id ? [b] : b === sp.id ? [a] : []));
  const inArea = (ids) => ids.filter((id) => areaIds.has(id) && byId[id]).map((id) => byId[id]);
  const confused = [...new Set([...inArea(L.confusedWith(S.learn, sp.id).map((c) => c.id)), ...inArea(partners(community.pairs)), ...inArea(partners(guide.similar || []))])]
    .filter(near);
  const confusedIds = new Set(confused.map((x) => x.id));
  const others = species.filter((x) => x.id !== sp.id && !confusedIds.has(x.id));
  const sameFam = shuffle(others.filter((x) => x.familySci === sp.familySci));
  const inPlay = shuffle(others.filter((x) => pool.has(x.id) && x.familySci !== sp.familySci));
  const rest = shuffle(others.filter((x) => !pool.has(x.id) && x.familySci !== sp.familySci));
  const order = [...sameFam, ...inPlay, ...rest];
  const pick = [...new Set([...confused.slice(0, 2), ...order.filter(near), ...order])].slice(0, 3).map((x) => x.id);
  return shuffle([sp.id, ...pick]);
}

async function grade(correct) {
  flushListen(); // how long they listened before answering
  const hinted = cur.hint > 0;
  const day = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD
  const event = L.answer(S.learn, species, cur.id, { correct, hinted, pair: cur.pair || null, day, level: cur.level });
  // Which recording you answered on: shared totals show which recordings help people. Only
  // level-1 answers: silver/gold play hard recordings on purpose, which would get them dropped.
  const heard = currentRec();
  if (heard && cur.level === 1) {
    const p = (S.recs[recKey(heard)] ||= {});
    if (correct) p.ok = (p.ok || 0) + 1; else p.no = (p.no || 0) + 1;
  }
  const record = bumpStreak(correct);
  save();
  if (record && !(S.streak.best % 5)) toast(`🔥 New record: ${S.streak.best} right in a row!`);
  renderTop();
  if (event === 'mastered' || event === 'remembered' || event === 'medal') await celebrate(event, byId[cur.id]);
  else if (event === 'slipped') toast(`${nm(byId[cur.id])} keeps its ${MEDAL[medalOf(cur.id)]} medal and comes back soon`);
}

async function onAction(act) {
  if (act === 'introDone') {
    L.introduced(S.learn, cur.id);
    save();
    newCard();
  } else if (act === 'hint') {
    cur.hint++;
    if (cur.hint === 1) cur.choices = makeChoices();
    if (cur.hint === 2) cur.removed = shuffle(cur.choices.filter((id) => id !== cur.id)).slice(0, 2);
    renderCard();
  } else if (act === 'reveal') {
    cur.stage = 'revealed';
    renderCard();
  } else if (act === 'got') {
    await grade(true);
    newCard();
  } else if (act === 'missed') {
    await grade(false);
    cur.stage = 'thought';
    renderCard();
  } else if (act === 'compared') {
    L.compared(S.learn, cur.id, cur.pair);
    save();
    newCard();
  } else if (act === 'next') {
    newCard();
  } else if (act === 'skip') {
    skipCard();
  }
}

$('actions').addEventListener('click', (e) => {
  const t = e.target.closest('[data-thought]');
  if (t) {
    L.recordMix(S.learn, cur.id, t.dataset.thought);
    save();
    toast(`Noted: heard ${nm(byId[cur.id])}, thought ${nm(byId[t.dataset.thought])}`);
    newCard();
    return;
  }
  const b = e.target.closest('[data-act]');
  if (b && !b.disabled) onAction(b.dataset.act);
});

$('actions').addEventListener('input', (e) => {
  if (e.target.id !== 'thoughtInput') return;
  cur.thought = e.target.value;
  const pos = e.target.selectionStart;
  $('actions').innerHTML = renderThought();
  const inp = $('thoughtInput');
  inp.focus();
  inp.setSelectionRange(pos, pos);
});

$('hintArea').addEventListener('click', async (e) => {
  const cp = e.target.closest('[data-cplay]');
  if (cp) {
    const r = activeRecs(cp.dataset.cplay)[0];
    if (r) playRec(r, cp);
    return;
  }
  const b = e.target.closest('[data-choice]');
  if (!b || cur.stage !== 'guess') return;
  cur.chose = b.dataset.choice;
  const correct = cur.chose === cur.id;
  if (!correct) L.recordMix(S.learn, cur.id, cur.chose);
  cur.stage = 'graded';
  renderCard();
  await grade(correct);
  renderCard();
});

$('playBtn').addEventListener('click', () => {
  const r = currentRec();
  if (r) playRec(r, $('playBtn'));
});

// Next / previous recording (wraps around both ways).
async function stepRec(step, auto = false) {
  const id = cur.id;
  stopAudio();
  // Only before answering, and only on level-1 cards (silver/gold are meant to be harder).
  if (!auto && cur.stage === 'guess' && cur.level === 1) { L.otherPressed(S.learn, id); save(); }
  if (!allRecs[id]) { // the full list, the first time: show it's loading straight away (v1.8.5)
    setPlaying($('playBtn'), 'loading');
    $('playBtn').classList.add('spin');
    await loadAllRecs(id);
  }
  if (!cur || cur.id !== id) return;
  const n = cardRecs().length;
  if (n < 2) { setPlaying($('playBtn'), 'paused'); return toast('No other recordings of this bird'); }
  cur.recIdx = (Math.min(cur.recIdx, n - 1) + step + n) % n;
  renderCard();
  playRec(currentRec(), $('playBtn'));
}
$('otherRecBtn').addEventListener('click', () => stepRec(1));
$('prevRecBtn').addEventListener('click', () => stepRec(-1));

function skipCard() {
  // Name it only on an intro card: on a test card the name would give the answer away.
  toast(cur.stage === 'intro' ? `${nm(byId[cur.id])} saved for later: it comes back in a while` : 'Later: this bird comes back in a while');
  L.skip(S.learn, cur.id, species);
  save();
  newCard();
}
$('skipBtn').addEventListener('click', skipCard);

// ---------- rate / flag ----------

let rateTarget = null; // { rec, after }

// Flag reasons (keys are stored with the user's progress; 'indistinct', 'busy' and 'quality'
// are older keys kept with these meanings so earlier flags still make sense).
const FLAGS = {
  atypical: 'Not its typical sound',
  indistinct: 'Sounds like other birds',
  busy: 'Other sounds in the way',
  quality: 'Bad recording',
  wrong: 'Wrong bird',
};

function openRate(rec, after) {
  rateTarget = { rec, after };
  renderStars($('stars'), rec, true);
  $('rateSheet').hidden = false;
  // Everyone's totals are kept for 6 h; here they're fetched again when 10+ minutes old, so a
  // rating given since (yours too) shows up (v1.9.2).
  let at = 0;
  try { at = JSON.parse(localStorage.getItem(SCORES_KEY))?.at || 0; } catch { /* none */ }
  if (Date.now() - at > 10 * 60e3) refreshRateInfo(0);
}

// Fetch everyone's totals again (after `wait` ms) and redraw the open rate sheet.
function refreshRateInfo(wait) {
  setTimeout(() => loadScores(true).then(() => {
    if (rateTarget && !$('rateSheet').hidden) renderStars($('stars'), rateTarget.rec, true);
  }), wait);
}

// Everyone's average rating of a recording and how many ratings it rests on ('' when none):
// "★ 3.8 (5)". Shown with the recording's details on the study card (the bird page already lists it).
const avgRating = (r) => {
  const c = shared(r);
  return c?.raters && c.avg != null ? `★ ${c.avg.toFixed(1)} (${c.raters})` : '';
};

// "Recording 1 of 64 · call · 290 km away · ★ 3.8 (5)" under the play button. The rating is
// everyone's (with how many rated it); before anyone's totals include it, your own ("yours").
function renderRecInfo() {
  const recs = cardRecs();
  const r = currentRec();
  const km = r ? recKm(r) : null;
  const total = allRecs[cur.id] ? recs.length : `${recs.length}+`;
  const mine = r && recPref(r).stars;
  const rating = r && (avgRating(r) || (mine ? `★ ${mine} (yours)` : ''));
  $('recInfo').textContent = `Recording ${Math.min(cur.recIdx, recs.length - 1) + 1} of ${total} · ${r ? r.type : ''}`
    + (km != null ? ` · ${km < 10 ? 'under 10' : Math.round(km / 10) * 10} km away` : '')
    + (rating ? ` · ${rating}` : '');
}

// Stars: your own rating; in the rate sheet (big) before you've rated it, everyone's average
// is shown in lighter stars, with the number of ratings it rests on (v1.8.8).
function renderStars(el, rec, big) {
  const v = recPref(rec).stars || 0;
  const c = shared(rec);
  const avg = c?.raters && c.avg != null ? c.avg : null;
  const shown = v || (big && avg != null ? Math.round(avg) : 0);
  const cls = v ? 'on' : 'on avg';
  el.innerHTML = [1, 2, 3, 4, 5].map((i) =>
    `<button class="star ${i <= shown ? cls : ''}" data-star="${i}" data-xc="${esc(recKey(rec))}" role="radio" aria-checked="${i === v}" aria-label="${i} star${i > 1 ? 's' : ''}">★</button>`).join('');
  el.classList.toggle('small', !big);
  if (big) {
    // A page saved before v1.8.8 has no #starsInfo: add it (the sheet stayed shut without it).
    if (!$('starsInfo')) el.insertAdjacentHTML('afterend', '<p class="small" id="starsInfo" style="text-align:center;margin:2px 0 6px"></p>');
    const all = avg != null ? `Everyone: ${avg.toFixed(1)} ★ (${c.raters} rating${c.raters === 1 ? '' : 's'})` : 'Everyone: no ratings yet';
    $('starsInfo').textContent = v ? `Your rating: ${v} ★ · ${all}` : `${all}. Tap a star to add yours.`;
  }
}

// A recording from the full list (not in calls.json): keep its details with the rating.
function keepMeta(rec) {
  if (!rec?.bird || (calls[rec.bird] || []).some((r) => recKey(r) === recKey(rec))) return;
  const p = (S.recs[recKey(rec)] ||= {});
  const { xc, file, rec: who, lic, type, secs, loc, cnt, lat, lon, q, bg, bird } = rec;
  p.meta = { xc, file, rec: who, lic, type, secs, loc, cnt, lat, lon, q, bg, bird };
  save();
}

function setStars(xc, stars) {
  const p = (S.recs[xc] ||= {});
  p.stars = p.stars === stars ? undefined : stars; // tap the same star again to clear
  save();
}

function setFlag(xc, flag) {
  const p = (S.recs[xc] ||= {});
  p.flag = flag;
  p.keep = flag ? undefined : true; // un-flagging = "use it", even if others flagged it
  save();
}

$('stars').addEventListener('click', (e) => {
  const b = e.target.closest('[data-star]');
  if (!b || !rateTarget) return;
  const stars = +b.dataset.star;
  setStars(recKey(rateTarget.rec), stars);
  keepMeta(rateTarget.rec);
  renderStars($('stars'), rateTarget.rec, true);
  if (cur) renderRecInfo();
  if (S.prefs.privacy?.share) refreshRateInfo(8000); // after your rating is saved (3 s) and totalled
  if (stars <= 2 && recPref(rateTarget.rec).stars) {
    toast('Rated low: swapped for another recording');
    closeRate(true);
  }
});

$('rateSheet').addEventListener('click', (e) => {
  const f = e.target.closest('[data-flag]');
  if (f && rateTarget) {
    setFlag(recKey(rateTarget.rec), f.dataset.flag);
    toast(`Flagged (${FLAGS[f.dataset.flag]}): using another recording`);
    closeRate(true);
  } else if (e.target === $('rateSheet') || e.target === $('rateClose')) {
    closeRate(false);
  }
});

function closeRate(changed) {
  $('rateSheet').hidden = true;
  if (rateTarget?.after) rateTarget.after(changed);
  rateTarget = null;
}

$('rateBtn').addEventListener('click', () => {
  const r = cur && currentRec();
  if (!r) return toast('Wait for the recording to load, then try again');
  openRate(r, (changed) => {
    if (!changed) return;
    stopAudio();
    if (cur.recs) cur.recs = cur.recs.filter((x) => !isOff(x));
    cur.recIdx = Math.min(cur.recIdx, cardRecs().length - 1);
    renderCard();
    if (S.prefs.autoplay && currentRec()) playRec(currentRec(), $('playBtn'));
  });
});

// ---------- celebration ----------

function celebrate(kind, sp) {
  return new Promise((resolve) => {
    const box = $('celebrate');
    const total = species.length;
    const mastered = L.summary(S.learn, species).mastered;
    const medal = medalOf(sp.id);
    box.className = 'celebrate ' + kind;
    $('celebrateBurst').textContent = kind === 'mastered' || kind === 'medal' ? MEDAL[medal] : '🧠';
    $('celebrateTitle').textContent = kind === 'mastered' ? 'Mastered!' : kind === 'medal' ? `${MEDAL_NAME[medal]} medal!` : 'Remembered!';
    $('celebrateName').textContent = nm(sp);
    $('celebrateSub').textContent = kind === 'mastered'
      ? `${MEDAL_NAME[medal]} medal · ${mastered} of ${total} birds mastered`
      : kind === 'medal'
        ? (medal >= 3 ? 'You know it from any recording.' : 'You know its varied sounds. Next: gold, any recording.')
        : medalNextText(sp.id) || 'Still know it by ear. It will come back later.';
    const inner = box.querySelector('.celebrate-box');
    inner.querySelectorAll('.confetti').forEach((c) => c.remove());
    const colours = ['#8b5a2b', '#d9a63a', '#f0b84a', '#b8441c', '#ef7a6c', '#7fb6e0'];
    for (let i = 0; i < 26; i++) {
      const c = document.createElement('i');
      c.className = 'confetti';
      c.style.left = `${Math.random() * 100}%`;
      c.style.background = colours[i % colours.length];
      c.style.animationDelay = `${Math.random() * 0.5}s`;
      inner.appendChild(c);
    }
    box.hidden = false;
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      box.hidden = true;
      box.removeEventListener('click', close);
      resolve();
    };
    box.addEventListener('click', close);
    setTimeout(close, 2600);
  });
}

// ---------- top line ----------

function initials(name, email) {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length) return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
  return (email || '?')[0].toUpperCase();
}

function renderAvatar() {
  const btn = $('avatarBtn');
  const p = Sync.profile();
  if (!p) {
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z"/></svg>';
    btn.className = 'avatar signed-out';
    btn.dataset.tip = 'Not signed in. Tap to sign in and keep your progress on all your devices.';
    btn.setAttribute('aria-label', 'Sign in');
    return;
  }
  const label = p.name ? `${p.name} (${p.email})` : p.email;
  btn.className = 'avatar';
  btn.dataset.tip = `Signed in as ${label}. Tap for your account.`;
  btn.setAttribute('aria-label', `Account: ${label}`);
  btn.innerHTML = p.avatar
    ? `<img src="${esc(p.avatar)}" alt="" referrerpolicy="no-referrer">`
    : `<span>${esc(initials(p.name, p.email))}</span>`;
  const img = btn.querySelector('img');
  if (img) img.addEventListener('error', () => { btn.innerHTML = `<span>${esc(initials(p.name, p.email))}</span>`; }, { once: true });
}

$('avatarBtn').addEventListener('click', () => {
  if (overlayOpen()) return;
  showView('settings');
  $('accountPanel').scrollIntoView({ block: 'start' });
});

// Tooltip text for a count: the explanation, then the birds it counts (commonest first).
function birdListTip(kind) {
  const pool = new Set(S.learn.pool);
  const pick = {
    inPlay: (b) => pool.has(b.id),
    met: (b) => pool.has(b.id) && S.learn.birds[b.id]?.intro,
    mastered: (b) => pool.has(b.id) && S.learn.birds[b.id]?.m,
  }[kind];
  const names = species.filter(pick).map(nm);
  return `${TIPS[kind]}

${names.length ? names.join(', ') : 'None yet.'}`;
}

function renderTop() {
  applyTheme(); // also after a synced copy from another device is adopted
  renderAvatar();
  const s = L.summary(S.learn, species);
  const st = currentStreak();
  const mc = L.medalCounts(S.learn, species);
  $('topSub').innerHTML = `<span data-tip="${esc(TIPS.area)}">${esc(area)}</span> · `
    + `<span data-tip="${esc(birdListTip('inPlay'))}">${s.inPlay} birds in play</span> · `
    + `<span data-tip="${esc(birdListTip('met'))}">${s.met} met</span> · `
    + `<span data-tip="${esc(birdListTip('mastered'))}">${[1, 2, 3].map((m) => `${MEDAL[m]}${mc[m]}`).join(' ')}</span>`
    + (streakState().best ? ` · <span data-tip="${esc(TIPS.streak)}">🔥 ${st}/${streakState().best}</span>` : '');
}

// ---------- birds view ----------

function renderBirds() {
  const q = $('search').value.trim().toLowerCase();
  const match = (sp) => !q || [...Object.values(sp.names), sp.sci, sp.listName, sp.family].some((v) => v.toLowerCase().includes(q));
  let html = '';
  for (const tier of TIER_ORDER) {
    const list = species.filter((sp) => sp.tier === tier && match(sp)).sort((x, y) => x.rank - y.rank);
    if (!list.length) continue;
    html += `<div class="tier-head">${tier}<span>${list.length} birds</span></div>`;
    for (const sp of list) {
      html += `<div class="bird-row" data-bird="${sp.id}" role="button" tabindex="0">
        <img src="${esc(thumbUrl(sp))}" alt="" loading="lazy">
        <div class="nm"><div>${esc(nm(sp))}</div><div class="small muted">${chip(L.status(S.learn, sp.id))}${medalChip(sp.id)} ${esc(sp.family)}</div></div>
        <button class="mini-play" data-play="${sp.id}" aria-label="Play ${esc(nm(sp))}">${PLAY_SVG}</button>
      </div>`;
    }
  }
  $('birdList').innerHTML = html || '<p class="muted">No birds match.</p>';
}

$('search').addEventListener('input', renderBirds);

$('birdList').addEventListener('click', (e) => {
  const p = e.target.closest('[data-play]');
  if (p) {
    e.stopPropagation();
    const r = activeRecs(p.dataset.play)[0];
    if (r) playRec(r, p);
    return;
  }
  const row = e.target.closest('[data-bird]');
  if (row) openBird(row.dataset.bird);
});

// The bird's memory aid as a hint clue. Words found in any option's name (e.g. "canary",
// "swee") are blanked so the clue never names the answer or its family outright.
function hintClue(id, choices) {
  const tip = guide.birds[id]?.tip;
  if (!tip) return '';
  const words = new Set((choices || [id]).flatMap((c) => [...Object.values(byId[c]?.names || {}), byId[c]?.family || ''])
    .flatMap((n) => n.toLowerCase().split(/[^a-z]+/)).flatMap((w) => [w, w.replace(/e?s$/, '')]).filter((w) => w.length >= 4));
  const hide = (w) => { const l = w.toLowerCase().replace(/'s$/, ''); return words.has(l) || words.has(l.replace(/e?s$/, '')); };
  return tip.replace(/[A-Za-z']+/g, (w) => (hide(w) ? '…' : w));
}

// Memory aid and the user's OWN mix-ups (2+ times). Only ever shown after the answer.
// The guide's sound-alike pairs stay behind the scenes (order, hints): shown as text they
// read as if everyone confuses those birds.
function soundTipHtml(id) {
  const tip = guide.birds[id]?.tip;
  const mixed = L.confusedWith(S.learn, id).filter((c) => c.count >= 2 && byId[c.id]).slice(0, 3);
  return (tip ? `<div data-tip="${esc(TIPS.memoryAid)}"><b>Remember it:</b> ${esc(tip)}</div>` : '')
    + (mixed.length ? `<div data-tip="${esc(TIPS.soundsLike)}"><b>You often mix it up with:</b> ${mixed.map((c) => esc(nm(byId[c.id]))).join(', ')}</div>` : '');
}

function confusedHtml(id) {
  const list = L.confusedWith(S.learn, id).filter((c) => byId[c.id]).slice(0, 5);
  if (!list.length) return '';
  return `<h2 style="margin-top:14px"><span data-tip="${esc(TIPS.confused)}">You've mixed it up with</span></h2>`
    + list.map((c) => `<div class="compare-row">
        <button class="mini-play" id="cf-${c.id}" data-cfplay="${c.id}" aria-label="Play ${esc(nm(byId[c.id]))}">${PLAY_SVG}</button>
        ${byId[c.id].photo ? `<img src="${esc(thumbUrl(byId[c.id]))}" alt="">` : ''}
        <button class="link nm" data-open="${c.id}">${esc(nm(byId[c.id]))}</button>
        <span class="small muted">${c.count}×</span>
      </div>`).join('');
}

function openBird(id) {
  const sp = byId[id];
  const active = new Set(activeRecs(id).map(recKey));
  const others = Object.entries(sp.names)
    .filter(([k, v]) => k !== S.prefs.nameSet && v !== nm(sp))
    .map(([k, v]) => `${esc(v)} (${esc(nameSets[k] || k)})`);
  const b = S.learn.birds[id];
  let html = `${sp.photo ? `<img class="photo" src="${esc(sp.photo.url)}" alt="">` : ''}
    <div class="reveal-name">${esc(nm(sp))}</div>
    <div class="reveal-sci">${esc(sp.sci)}</div>
    ${others.length ? `<div class="detail-names">Also: ${[...new Set(others)].join(', ')}</div>` : ''}
    ${habitatChips(id) ? `<div class="reveal-meta">${habitatChips(id)}</div>` : ''}
    <div class="reveal-meta"><span class="chip" data-tip="${esc(TIPS.family)}">${esc(sp.family)}</span><span class="chip" data-tip="${esc(tierTip(sp))}">${esc(sp.tier)}</span>${chip(L.status(S.learn, id))}${medalChip(id)}</div>
    ${b && (b.right || b.wrong) ? `<p class="small muted" style="text-align:center">Right ${b.right} · Missed ${b.wrong}${b.ur || b.uw ? ` <span data-tip="${esc(TIPS.medalAnswers)}">· harder recordings: right ${b.ur || 0} · missed ${b.uw || 0}</span>` : ''}</p>` : ''}
    ${medalNextHtml(id)}
    ${soundTipHtml(id) ? `<div class="sound-tip">${soundTipHtml(id)}</div>` : ''}
    ${confusedHtml(id)}
    <h2 style="margin-top:14px">Recordings</h2>
    <p class="small muted">The two marked "In use" are the ones you study. Rate or flag to change them. Signed-in users' flags and ratings also help pick recordings for everyone.</p>`;
  for (const r of calls[id] || []) {
    const pref = recPref(r);
    html += `<div class="rec-card ${isOff(r) ? 'off' : ''}">
      <div class="rc-top">
        <button class="mini-play" id="dp-${esc(recKey(r))}" data-dplay="${esc(recKey(r))}" aria-label="Play">${PLAY_SVG}</button>
        <div class="nm">${esc(r.type)} · ${r.secs ? `${r.secs}s ` : ''}${active.has(recKey(r)) ? `<span class="chip learning" data-tip="${esc(TIPS.inUse)}">In use</span>` : ''}
          ${pref.flag ? `<span class="chip">Flagged: ${esc(FLAGS[pref.flag] || 'yes')}</span> <button class="link" data-unflag="${esc(recKey(r))}">Restore</button>` : ''}
          ${!pref.flag && !pref.stars && !pref.keep && sharedOff(r) ? `${flaggedByOthers(r) ? `<span class="chip" data-tip="${esc(TIPS.sharedOff)}">Flagged by others</span>` : `<span class="chip" data-tip="${esc(TIPS.rightRate)}">Often answered wrong</span>`} <button class="link" data-unflag="${esc(recKey(r))}">Use anyway</button>` : ''}</div>
      </div>
      <div class="stars small" data-rate="${esc(recKey(r))}"></div>
      ${shared(r)?.raters ? `<div class="small muted" data-tip="${esc(TIPS.sharedStars)}">Everyone: ${shared(r).avg.toFixed(1)}★ from ${shared(r).raters} ${shared(r).raters === 1 ? 'person' : 'people'}</div>` : ''}
      ${answersOn(r) ? `<div class="small muted" data-tip="${esc(TIPS.rightRate)}">Everyone: right ${Math.round((shared(r).ok / answersOn(r)) * 100)}% of ${answersOn(r)} answers</div>` : ''}
      <div class="credit">${credit(r)}${r.loc ? '<br>' + esc(r.loc) : ''}</div>
      ${pref.flag ? '' : `<button class="link" data-flagrec="${esc(recKey(r))}">⚑ Rate / flag</button>`}
    </div>`;
  }
  if (sp.photo) html += `<p class="credit">${photoCredit(sp)}</p>`;
  $('birdDetail').innerHTML = html;
  $('birdDetail').querySelectorAll('[data-rate]').forEach((el) => {
    renderStars(el, (calls[id] || []).find((r) => recKey(r) === el.dataset.rate), false);
  });
  $('birdDetail').dataset.bird = id;
  $('birdSheet').hidden = false;
}

$('birdDetail').addEventListener('click', (e) => {
  const id = $('birdDetail').dataset.bird;
  const find = (k) => (calls[id] || []).find((r) => recKey(r) === k);
  const p = e.target.closest('[data-dplay]');
  if (p) return playRec(find(p.dataset.dplay), p);
  const cf = e.target.closest('[data-cfplay]');
  if (cf) { const r = activeRecs(cf.dataset.cfplay)[0]; return r && playRec(r, cf); }
  const op = e.target.closest('[data-open]');
  if (op) { stopAudio(); return openBird(op.dataset.open); }
  const s = e.target.closest('[data-star]');
  if (s) { setStars(s.dataset.xc, +s.dataset.star); return openBird(id); }
  const f = e.target.closest('[data-flagrec]');
  if (f) {
    const rec = (calls[id] || []).find((r) => recKey(r) === f.dataset.flagrec);
    if (rec) openRate(rec, () => openBird(id));
    return;
  }
  const u = e.target.closest('[data-unflag]');
  if (u) { setFlag(u.dataset.unflag, undefined); return openBird(id); }
});

$('birdSheet').addEventListener('click', (e) => {
  if (e.target === $('birdSheet') || e.target === $('birdClose')) {
    stopAudio();
    $('birdSheet').hidden = true;
    renderBirds();
  }
});

// ---------- progress view ----------

const mixBird = (id) => `<div class="mix-bird"><button class="mini-play" data-mplay="${id}" aria-label="Play ${esc(nm(byId[id]))}">${PLAY_SVG}</button>
  <button class="link nm" data-pbird="${id}">${esc(nm(byId[id]))}</button></div>`;

// Pairs you've mixed up (wrong hint picks and "What did you think it was?"), most first.
function mixUpsHtml() {
  const pairs = {};
  for (const [heard, row] of Object.entries(S.learn.mix || {})) {
    for (const [thought, n] of Object.entries(row)) {
      if (!areaIds.has(heard) || !areaIds.has(thought)) continue; // current region only
      const key = [heard, thought].sort().join('|');
      pairs[key] = (pairs[key] || 0) + n;
    }
  }
  const top = Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const body = top.length
    ? top.map(([key, n]) => {
      const [a, b] = key.split('|');
      return `<div class="mix-row"><div class="mix-pair">${[a, b].map(mixBird).join('')}</div>
        <span class="small muted">${n}×</span></div>`;
    }).join('')
    : '<p class="muted small">None yet. When you miss a bird, use a clue or answer "What did you think it was?" and the app learns which birds you mix up.</p>';
  return `<div class="panel"><h2><span data-tip="${esc(TIPS.mixUps)}">Birds you mix up</span></h2>${body}</div>`;
}

// Met birds you get wrong most often (2+ misses, by share of misses).
function hardestHtml() {
  const list = Object.entries(S.learn.birds || {})
    .filter(([id, b]) => areaIds.has(id) && (b.wrong || 0) >= 2) // current region only
    .map(([id, b]) => ({ id, right: b.right || 0, wrong: b.wrong, share: b.wrong / ((b.right || 0) + b.wrong) }))
    .sort((a, b) => b.share - a.share || b.wrong - a.wrong)
    .slice(0, 8);
  if (!list.length) return '';
  return `<div class="panel"><h2><span data-tip="${esc(TIPS.hardest)}">Birds you miss most</span></h2>`
    + list.map((x) => `<div class="mix-row"><div class="mix-pair">${mixBird(x.id)}</div>
      <span class="small muted">right ${x.right} · missed ${x.wrong}</span></div>`).join('')
    + '</div>';
}

// Medal counts for the current area, each with a tip listing the birds.
function medalsHtml() {
  const c = L.medalCounts(S.learn, species);
  const names = (m) => species.filter((sp) => medalOf(sp.id) === m).map(nm).sort();
  const cell = (m) => {
    const list = names(m);
    const tip = `${TIPS.medal[m]}\n\n${list.length ? list.join(', ') : 'None yet.'}`;
    return `<div class="stat" data-tip="${esc(tip)}"><b>${MEDAL[m]} ${c[m]}</b><span>${MEDAL_NAME[m].toLowerCase()}</span></div>`;
  };
  return `<div class="big-stats medals">${cell(1)}${cell(2)}${cell(3)}</div>`;
}

// How far a bird is towards mastered or its next medal, in points ('' at gold or not met yet).
// One total: clean right +2, with a clue +1.
function medalNextText(id) {
  const b = S.learn.birds[id];
  const m = medalOf(id);
  if (!b?.intro || m >= 3) return '';
  if (!b.m) {
    const lvl = Math.min(S.learn.startLevel || 1, 3);
    return `${MEDAL[lvl]} Mastered at ${L.MASTER_SCORE} points: ${Math.max(0, b.s)} of ${L.MASTER_SCORE} so far`;
  }
  return `Next: ${MEDAL[m + 1]} ${MEDAL_NAME[m + 1]} (${LEVEL_NAME[m + 1]}): ${b.up || 0} of ${L.MEDAL_SCORE} points`;
}
function medalNextHtml(id) {
  const t = medalNextText(id);
  const b = S.learn.birds[id];
  return t ? `<p class="small muted" style="text-align:center" data-tip="${esc(b?.m ? TIPS.level[medalOf(id) + 1] : TIPS.points)}">${esc(t)}</p>` : '';
}

function renderProgress() {
  const s = L.summary(S.learn, species);
  const st = currentStreak();
  let html = `<div class="big-stats">
    <div class="stat" data-tip="${esc(birdListTip('mastered'))}"><b>${s.mastered}</b><span>mastered</span></div>
    <div class="stat" data-tip="${esc(birdListTip('met'))}"><b>${s.met}</b><span>met</span></div>
    <div class="stat" data-tip="${esc(birdListTip('inPlay'))}"><b>${s.inPlay}</b><span>in play</span></div>
    <div class="stat" data-tip="${esc(TIPS.accuracy)}"><b>${s.recentAccuracy == null ? '–' : Math.round(s.recentAccuracy * 100) + '%'}</b><span>last 20 right</span></div>
  </div>
  <div class="streak-line" data-tip="${esc(TIPS.streak)}">🔥 ${st}/${streakState().best} right in a row (now / record)</div>
  ${medalsHtml()}`;
  for (const tier of TIER_ORDER) {
    const t = s.tiers[tier];
    if (!t) continue;
    const pct = (n) => (n / t.total) * 100;
    html += `<div class="panel">
      <div class="tier-head" style="margin:0"><span class="tier-name" data-tip="${esc(`${tier}: how common these birds are around ${area}. Common = the 40 most often found, Regular = 41-100, Uncommon = 101-180, Scarce = the rest.`)}">${tier}</span><span>${t.mastered} of ${t.total} mastered</span></div>
      <div class="tier-bar"><div class="m" style="width:${pct(t.mastered)}%"></div><div class="l" style="width:${pct(t.learning + t.new)}%"></div></div>
      <div class="legend"><span data-tip="${esc(TIPS.status.mastered)}">Mastered ${t.mastered}</span><span data-tip="${esc(TIPS.status.learning)}">Learning ${t.learning + t.new}</span>${t.later ? `<span data-tip="${esc(TIPS.status.later)}">Later ${t.later}</span>` : ''}<span data-tip="${esc(TIPS.status.locked)}">Not yet ${t.locked}</span></div>
    </div>`;
  }
  html += mixUpsHtml() + hardestHtml();
  const distinct = (S.prefs.order || 'distinct') === 'distinct';
  html += `<div class="panel">
    <h2>How birds are added</h2>
    <p class="muted small">${distinct
    ? `You start with common birds around ${esc(area)} that have distinctive calls. Birds that sound alike (one family, or pairs people often mix up) are spread out and come later.`
    : `You start with the most common birds around ${esc(area)}.`}
    Each right answer adds points toward mastered: +2 clean, +1 with a clue, all in one total; 6 points = mastered (a miss takes 2 off). Silver and gold then need 4 points each.
    When fewer than 8 birds are still being learned, the next 5 are added, and a new bird joins at least every 15 cards. While 3 or more birds you've met are still a struggle (score at zero or below), that slows to one every 30 cards, so you can catch up on them first.
    Missed birds come back after a few cards (a bird missed twice in a row rests a bit longer); mastered birds come back less and less often. Change the order in Settings.</p>
    ${s.inPlay < species.length ? '<button class="btn block ghost" id="unlockAll">Add all birds now</button>' : ''}
  </div>
  <p class="small muted" style="text-align:center">${s.answered} answers so far</p>`;
  $('progress').innerHTML = html;
  const u = $('unlockAll');
  if (u) u.addEventListener('click', () => {
    if (!confirm(`Add all ${species.length} birds to your study set now?`)) return;
    L.ensurePool(S.learn, species, { all: true });
    save();
    renderProgress();
    renderTop();
  });
}

$('progress').addEventListener('click', (e) => {
  const p = e.target.closest('[data-mplay]');
  if (p) { const r = activeRecs(p.dataset.mplay)[0]; return r && playRec(r, p); }
  const b = e.target.closest('[data-pbird]');
  if (b) openBird(b.dataset.pbird);
});

// ---------- settings ----------

// Colours (Settings -> Colours): the background family only; buttons, links and highlights
// always stay the original green (v1.6.4, user). Colours are in styles.css under
// :root[data-theme]. c = swatch [light, dark], bar = browser bar [light, dark].
const THEMES = {
  original: { label: 'Original', c: ['#f4f1ea', '#111814'], bar: ['#f4f1ea', '#111814'] },
  stone: { label: 'Stone', c: ['#e8e9e0', '#262b24'], bar: ['#f3f3ee', '#141713'] },
  sand: { label: 'Sand', c: ['#e8dcc8', '#2d261f'], bar: ['#f3ebdd', '#18140f'] },
  mist: { label: 'Mist', c: ['#e1e8ec', '#242c31'], bar: ['#eef2f4', '#12171a'] },
  white: { label: 'White', c: ['#ffffff', '#292d2a'], bar: ['#fafafa', '#161816'] },
  black: { label: 'Black', c: ['#1c1c1c', '#000000'], bar: ['#ececec', '#000000'] },
};
// Picks from the earlier colour themes (v1.5.2-1.6.3) map to the nearest background.
const OLD_THEMES = { forest: 'stone', fynbos: 'stone', eucalyptus: 'stone', moss: 'stone', olive: 'stone', bushveld: 'original', spring: 'original', jade: 'original', savanna: 'sand', sunset: 'sand', ocean: 'mist', granite: 'mist', dusk: 'mist' };
// Greens for buttons, links and highlights (v1.6.6, user: variations of the original green).
// c = swatch [light, dark]; colours in styles.css under :root[data-accent]. Original = :root.
const ACCENTS = {
  original: { label: 'Original', c: ['#1f6b4a', '#5cc08d'] },
  bushveld: { label: 'Bushveld', c: ['#174f37', '#4fae7f'] },
  spring: { label: 'Spring', c: ['#2a8a5c', '#6fd39f'] },
  jade: { label: 'Jade', c: ['#1d6b5e', '#5cc0ad'] },
  moss: { label: 'Moss', c: ['#4f6f2f', '#a6c97a'] },
  sage: { label: 'Sage', c: ['#5b7a63', '#a6c4ac'] },
};
const accentOf = () => (ACCENTS[S.prefs.accent] ? S.prefs.accent : 'original');

const DEFAULT_THEME = 'original'; // for everyone who hasn't picked one (index.html sets it before paint too)
const themeOf = () => {
  const t = OLD_THEMES[S.prefs.theme] || S.prefs.theme;
  return THEMES[t] ? t : DEFAULT_THEME;
};
function applyTheme() {
  const t = themeOf();
  if (document.documentElement.dataset.theme !== t) document.documentElement.dataset.theme = t;
  const a = accentOf();
  if (document.documentElement.dataset.accent !== a) document.documentElement.dataset.accent = a;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', THEMES[t].bar[dark ? 1 : 0]);
}

function renderSettings() {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  $('accentOpts').innerHTML = Object.entries(ACCENTS).map(([k, v]) =>
    `<button type="button" class="theme-opt ${k === accentOf() ? 'on' : ''}" data-accent-pick="${k}" aria-pressed="${k === accentOf()}">
      <i class="solid" style="background:${v.c[dark ? 1 : 0]}"></i>${esc(v.label)}</button>`).join('');
  $('themeOpts').innerHTML = Object.entries(THEMES).map(([k, v]) =>
    `<button type="button" class="theme-opt ${k === themeOf() ? 'on' : ''}" data-theme-pick="${k}" aria-pressed="${k === themeOf()}">
      <i style="background:${v.c[dark ? 1 : 0]}"></i>${esc(v.label)}</button>`).join('');
  $('nameSet').innerHTML = Object.entries(nameSets).map(([k, v]) =>
    `<option value="${k}" ${k === S.prefs.nameSet ? 'selected' : ''}>${esc(v)}</option>`).join('');
  $('autoplay').checked = S.prefs.autoplay;
  $('intros').checked = S.prefs.intros;
  $('autoChoices').checked = S.prefs.autoChoices !== false;
  $('levelSel').innerHTML = Object.entries(LEVELS).map(([k, v]) =>
    `<option value="${k}" ${k === (S.prefs.level || 'some') ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
  $('orderLabel').dataset.tip = TIPS.order;
  $('orderSel').innerHTML = Object.entries(ORDERS).map(([k, v]) =>
    `<option value="${k}" ${k === (S.prefs.order || 'distinct') ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
  $('habSettings').innerHTML = habitatOpts(S.prefs.habitats || [], true);
  $('habLabel').dataset.tip = TIPS.habitats;
  const ca = areaById(currentAreaId()) || areaById(DEFAULT_AREA);
  const caWhere = areaPath(areaById(ca.parent) || { name: '' }).split(' › ').slice(1).join(' › ');
  $('areaBtn').innerHTML = `<b>${esc(ca.name)} <span class="change">Change</span></b>`
    + (caWhere ? `<span class="area-where">${esc(caWhere)}</span>` : '') + `<span>${birdCount(ca)} birds</span>`;
  $('syncCode').value = exportCode();
  renderAccount();
  updateOfflineInfo();
}

$('nameSet').addEventListener('change', (e) => {
  S.prefs.nameSet = e.target.value;
  save();
  toast(`Names: ${nameSets[S.prefs.nameSet]}`);
});

$('levelSel').addEventListener('change', (e) => {
  const before = S.learn.pool.length;
  applyLevel(e.target.value);
  save();
  renderSettings();
  renderTop();
  const added = S.learn.pool.length - before;
  toast(added > 0 ? `${LEVELS[e.target.value].label}: ${added} more birds added` : `${LEVELS[e.target.value].label}: birds already in play stay in play`);
});

$('habSettings').addEventListener('click', (e) => {
  const hb = e.target.closest('[data-hab]');
  if (!hb) return;
  S.prefs.habitats = toggleIn(S.prefs.habitats || [], hb.dataset.hab);
  applyArea();
  save();
  renderSettings();
  renderTop();
  const n = S.prefs.habitats.length;
  toast(n ? `${S.prefs.habitats.map((h) => HABITATS[h].label).join(', ')} first: progress on every bird is kept` : 'No habitat focus: all habitats mixed');
});

$('orderSel').addEventListener('change', (e) => {
  S.prefs.order = e.target.value;
  applyArea();
  save();
  toast(`${ORDERS[e.target.value].label}: progress on every bird is kept`);
});

// Settings region picker: the survey's tree + search, shown in a sheet.
$('areaBtn').addEventListener('click', () => {
  surveyPick.area = currentAreaId();
  for (let a = areaById(surveyPick.area); a; a = areaById(a.parent)) if (a.parent) openAreas.add(a.parent);
  areaQuery = '';
  $('areaSheetBody').append($('areaOpts'));
  renderAreaPicker();
  $('areaSheet').hidden = false;
  $('areaOpts').querySelector('.on')?.scrollIntoView({ block: 'center' });
});

function closeAreaSheet() {
  $('areaSheet').hidden = true;
  $('surveyDone').before($('areaOpts'));
}

$('areaSheet').addEventListener('click', async (e) => {
  if (e.target === $('areaSheet') || e.target.id === 'areaClose') return closeAreaSheet();
  if (toggleArea(e)) return;
  const ar = e.target.closest('[data-area]');
  if (!ar) return;
  if (ar.dataset.area !== currentAreaId() && await chooseArea(ar.dataset.area)) {
    cur = null;
    toast(`Region: ${area}`);
  }
  closeAreaSheet();
  renderSettings();
});

// ---------- areas ----------

const DEFAULT_AREA = 'all';
const NEAR_KEY = 'bird-sounds-near';
const NEAR_KM = 50;
let isOwner = false; // signed in with an account allowed to see private regions

// "Near me" is built on the device from iNaturalist records around the person's location.
function nearArea() {
  let n = null;
  try { n = JSON.parse(localStorage.getItem(NEAR_KEY)); } catch { /* none yet */ }
  return { id: 'near', name: `Near me (${NEAR_KM} km)`, parent: null, near: true, ranks: n?.ranks || {}, totalSpecies: n?.total || 0, at: n?.at };
}

const visibleAreas = () => [nearArea(), ...areas.filter((a) => !a.private || isOwner)];
const areaById = (id) => visibleAreas().find((a) => a.id === id);
const currentAreaId = () => (areaById(S.prefs.area) ? S.prefs.area : DEFAULT_AREA);
// Only birds we have recordings for count (allSpecies is already filtered to those).
let knownIds = new Set();
const birdCount = (a) => Object.keys(a.ranks).filter((id) => knownIds.has(id)).length;

async function updateOwner() {
  const before = isOwner;
  isOwner = false;
  const mail = Sync.signedIn() ? Sync.email().trim().toLowerCase() : '';
  if (mail && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(mail));
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    isOwner = OWNER_HASHES.includes(hex);
  }
  return before !== isOwner;
}

// Areas as a flat list in tree order (parents before children) with their depth.
// Top level: Near me, Southern Africa (with countries, provinces and areas below), private lists.
function areaTree(parent = null, depth = 0, list = visibleAreas()) {
  return list.filter((a) => a.parent === parent)
    .flatMap((a) => [{ a, depth }, ...areaTree(a.id, depth + 1, list)]);
}

const areaPath = (a) => {
  const names = [];
  for (let x = a; x; x = areaById(x.parent)) names.unshift(x.name);
  return names.join(' › ');
};

// Look up birds recorded within NEAR_KM of the device and rank them, then cache for a week.
async function locateNear() {
  if (!navigator.geolocation) throw new Error('Location is not available on this device');
  const pos = await new Promise((ok, fail) => navigator.geolocation.getCurrentPosition(ok, fail, { timeout: 20000, maximumAge: 6e5 }));
  // Rounded to about 10 km before it goes to iNaturalist: enough for a 50 km search.
  const lat = +pos.coords.latitude.toFixed(1);
  const lng = +pos.coords.longitude.toFixed(1);
  const byInat = Object.fromEntries(allSpecies.map((b) => [b.inat, b.id]));
  const ranks = {};
  let total = 0;
  for (let page = 1; page <= 3; page++) {
    const q = new URLSearchParams({ iconic_taxa: 'Aves', quality_grade: 'research', rank: 'species', lat, lng, radius: NEAR_KM, per_page: 500, page });
    const res = await fetch(`https://api.inaturalist.org/v1/observations/species_counts?${q}`);
    if (!res.ok) throw new Error(`iNaturalist ${res.status}`);
    const d = await res.json();
    d.results.forEach((r, i) => {
      const id = byInat[r.taxon.id];
      if (id && ranks[id] == null) ranks[id] = (page - 1) * 500 + i + 1;
    });
    total = d.total_results;
    if (page * 500 >= total) break;
  }
  try { localStorage.setItem(NEAR_KEY, JSON.stringify({ lat: +lat.toFixed(2), lng: +lng.toFixed(2), at: Date.now(), ranks, total })); } catch { /* storage full */ }
  return Object.keys(ranks).length;
}

// Switch to an area. "Near me" fetches (or refreshes after a week) the local list first.
async function chooseArea(id) {
  if (id === 'near') {
    if (!S.prefs.nearOk) {
      if (!confirm('Near me uses your location to find the birds recorded within 50 km of you.\n\nIt is rounded to about 10 km and sent to iNaturalist for that search, then kept only on this device. Nothing about it is saved with your account.\n\nUse your location?')) return false;
      S.prefs.nearOk = true;
      save();
    }
    const n = nearArea();
    if (!birdCount(n) || Date.now() - (n.at || 0) > 7 * 864e5) {
      toast('Finding birds recorded near you…');
      try {
        const found = await locateNear();
        if (!found) throw new Error('No bird records near you yet');
      } catch (err) {
        toast(err.code === 1 ? 'Location permission is off, so Near me cannot be used' : `Near me didn't work: ${err.message || 'no location'}`);
        return false;
      }
    }
  }
  S.prefs.area = id;
  applyArea();
  L.ensurePool(S.learn, species);
  save();
  renderTop();
  return true;
}

// The order new birds join your study set (learn.js adds them in `species` order).
// 'distinct' (default): commonness weighted by how easy the bird is to tell apart by ear
// (data/guide.json), then spread out so birds of one family or sound-alikes don't arrive
// together. 'common': plain commonness rank.
const ORDERS = {
  distinct: { label: 'Easiest to tell apart first', desc: 'Common birds with distinctive calls first. Birds that sound alike are spread out and added later.' },
  common: { label: 'Most common first', desc: 'Strictly the most recorded birds in your region first, however alike they sound.' },
};
// Ease groups go strictly in order (1 distinctive, 2 average, 3 similar-sounding families,
// 4 seen more than heard), commonest first within each. A distinctive bird only counts as
// group 1 among the area's DISTINCT_CAP commonest, so rare iconic birds don't jump the queue.
// (A rank x factor blend let common look-alikes like Cape Weaver beat Hadeda: user 2026-11-17.)
const DISTINCT_CAP = 150;
// Group 0 = the user's iconic sounds of their area (ICONIC in build_sound_guide.py), first of all
// when among the area's ICONIC_CAP commonest; otherwise they count as distinctive (group 1).
const ICONIC_CAP = 250;
const SPREAD = 6; // a new bird avoids the family / sound-alikes of the last 6 added

const easeOf = (id) => {
  const e = guide.birds[id]?.ease ?? 2;
  return e >= 1 && communityHard.has(id) ? Math.min(4, e + 1) : e; // see loadDifficulty
};

// Sound-alike pairs: hand-made ones plus pairs you've mixed up twice or more.
function soundAlikes() {
  const set = new Set();
  const add = (a, b) => { set.add(`${a}|${b}`); set.add(`${b}|${a}`); };
  for (const [a, b] of [...(guide.similar || []), ...community.pairs]) add(a, b);
  for (const [heard, row] of Object.entries(S.learn.mix || {})) {
    for (const [thought, n] of Object.entries(row)) if (n >= 2) add(heard, thought);
  }
  return set;
}

// Habitats to focus on (v1.5.1, prefs.habitats; none = all): birds of those habitats come
// first, in the usual order among themselves; the rest follow.
const inFocus = (id) => {
  const want = S.prefs.habitats || [];
  return !want.length || (habitats[id] || []).some((h) => want.includes(h));
};

function learnOrder(list) {
  const focus = (b) => (inFocus(b.id) ? 0 : 1);
  if ((S.prefs.order || 'distinct') !== 'distinct') return [...list].sort((x, y) => focus(x) - focus(y) || x.rank - y.rank);
  const group = (b) => {
    let e = easeOf(b.id);
    if (e === 0 && b.rank > ICONIC_CAP) e = 1;
    return e === 1 && b.rank > DISTINCT_CAP ? 2 : e;
  };
  const queue = [...list].sort((x, y) => focus(x) - focus(y) || group(x) - group(y) || x.rank - y.rank);
  const alike = soundAlikes();
  const out = [];
  while (queue.length) {
    const last = out.slice(-SPREAD);
    // Spread out families and sound-alikes, but never past the end of the habitat focus
    // (v1.9.4: the last forest raptors kept being passed over for non-forest birds).
    const f0 = focus(queue[0]);
    let i = queue.slice(0, 15).findIndex((b) => focus(b) === f0 && !last.some((o) => o.familySci === b.familySci || alike.has(`${o.id}|${b.id}`)));
    if (i < 0) i = 0;
    out.push(queue.splice(i, 1)[0]);
  }
  return out;
}

// Birds that can sound like this one (hand-made pairs + pairs many people mix up), used as
// hint choices.
const similarTo = (id) => [...(guide.similar || []), ...community.pairs].flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : [])).filter((x) => byId[x]);

function tierFor(rank) {
  return rank <= 40 ? 'Common' : rank <= 100 ? 'Regular' : rank <= 180 ? 'Uncommon' : 'Scarce';
}

// Rebuild the study list for the chosen area: its birds, ranked and tiered for that area.
function applyArea() {
  let a = areaById(currentAreaId());
  if (!a || !birdCount(a)) a = areaById(DEFAULT_AREA); // e.g. Near me before the location is known
  area = a.name;
  areaTotal = a.totalSpecies;
  species = learnOrder(allSpecies
    .filter((b) => a.ranks[b.id] != null)
    .map((b) => ({ ...b, rank: a.ranks[b.id], tier: tierFor(a.ranks[b.id]) }))
    .sort((x, y) => x.rank - y.rank));
  byId = { ...Object.fromEntries(allSpecies.map((b) => [b.id, b])), ...Object.fromEntries(species.map((b) => [b.id, b])) };
  areaIds = new Set(species.map((b) => b.id));
  L.realign(S.learn, species, cur?.id); // birds in play follow the current order (learn.js)
}

$('accentOpts').addEventListener('click', (e) => {
  const b = e.target.closest('[data-accent-pick]');
  if (!b) return;
  S.prefs.accent = b.dataset.accentPick;
  applyTheme();
  save();
  renderSettings();
});

$('themeOpts').addEventListener('click', (e) => {
  const b = e.target.closest('[data-theme-pick]');
  if (!b) return;
  S.prefs.theme = b.dataset.themePick;
  applyTheme();
  save();
  renderSettings();
});

$('autoplay').addEventListener('change', (e) => {
  S.prefs.autoplay = e.target.checked;
  save();
});

$('autoChoices').addEventListener('change', (e) => {
  S.prefs.autoChoices = e.target.checked;
  save();
});

$('intros').addEventListener('change', (e) => {
  S.prefs.intros = e.target.checked;
  S.prefs.introsChosen = true;
  save();
});

function exportCode() {
  const json = JSON.stringify({ learn: S.learn, recs: S.recs, prefs: S.prefs, streak: S.streak });
  return btoa(unescape(encodeURIComponent(json)));
}

$('copyCode').addEventListener('click', async () => {
  $('syncCode').value = exportCode();
  try {
    await navigator.clipboard.writeText($('syncCode').value);
    toast('Code copied');
  } catch {
    $('syncCode').select();
    toast('Select the code and copy it');
  }
});

$('loadCode').addEventListener('click', () => {
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob($('syncCode').value.trim()))));
    if (!data.learn || !data.learn.birds) throw new Error('bad');
    if (!confirm('Replace the progress on this device with the pasted code?')) return;
    S = { ...defaultStore(), ...data, prefs: { ...defaultStore().prefs, ...data.prefs } };
    save();
    toast('Progress loaded');
    renderSettings();
    newCard();
  } catch {
    toast("That code doesn't look right");
  }
});

$('resetBtn').addEventListener('click', () => {
  if (!confirm('Reset all progress? Your ratings and flags are kept.')) return;
  S.learn = L.newState();
  save();
  toast('Progress reset');
  newCard();
});

// ---------- offline ----------

// Offline saves the birds in the study set of the current region (not the whole region:
// that could be ~1,700 files, and xeno-canto asks people not to bulk-download).
function offlineBirds() {
  const pool = new Set(S.learn.pool);
  return species.filter((sp) => pool.has(sp.id));
}

function offlineItems() {
  const items = [];
  for (const sp of offlineBirds()) {
    for (const r of activeRecs(sp.id)) items.push({ url: r.file, audio: true, secs: r.secs });
    if (sp.photo) items.push({ url: sp.photo.url, audio: false }, { url: thumbUrl(sp), audio: false, thumb: true });
  }
  return items;
}

// Rough size: MP3s are ~25 KB per second of sound, photos ~60 KB.
const offlineMB = (items) => Math.max(1, Math.round(items.reduce((t, i) => t + (i.audio ? (i.secs || 20) * 25 : i.thumb ? 15 : 60), 0) / 1024));

async function updateOfflineInfo() {
  try {
    const cache = await caches.open(MEDIA_CACHE);
    const have = new Set((await cache.keys()).map((k) => k.url));
    const items = offlineItems();
    const got = items.filter((i) => have.has(new URL(i.url, location.href).href)).length;
    let size = '';
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if (est.usage) size = ` · about ${Math.round(est.usage / 1e6)} MB used`;
    }
    $('offlineInfo').textContent = got
      ? `${got} of ${items.length} sounds and photos for your ${offlineBirds().length} study birds in ${area} saved on this device${size}.${got < items.length ? ' Tap Download to save the rest.' : ''}`
      : `Save the sounds and photos of the ${offlineBirds().length} birds in your study set for ${area}, so the app works without signal (about ${offlineMB(items)} MB). Download again when new birds are added.`;
  } catch {
    $('offlineInfo').textContent = "Offline saving isn't available in this browser.";
  }
}

let downloading = false;
$('dlBtn').addEventListener('click', async () => {
  if (downloading) return;
  downloading = true;
  $('dlBtn').disabled = true;
  $('dlProgress').hidden = false;
  let failed = 0;
  try {
    const cache = await caches.open(MEDIA_CACHE);
    const items = offlineItems();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      $('dlFill').style.width = `${((i + 1) / items.length) * 100}%`;
      const have = await cache.match(it.url);
      if (have && !have.headers.get('x-part')) continue; // saved whole already (a saved part gets the whole file)
      try {
        // CORS for photos too (iNat's bucket allows it): an opaque no-cors copy counts as ~7 MB
        // of storage quota each in Chrome.
        const res = await fetch(it.url, { mode: 'cors' });
        if (!res.ok) throw new Error(res.status);
        await cache.put(it.url, res);
      } catch { failed++; }
      // One file at a time with a short pause, to go easy on xeno-canto's server.
      await new Promise((r) => setTimeout(r, 250));
    }
    toast(failed ? `Done, but ${failed} files failed. Tap Download again to retry.` : 'All saved for offline use');
  } catch {
    toast("Couldn't save files on this device");
  }
  downloading = false;
  $('dlBtn').disabled = false;
  $('dlProgress').hidden = true;
  updateOfflineInfo();
});

$('dlDelete').addEventListener('click', async () => {
  if (!confirm('Delete the offline sounds and photos from this device?')) return;
  await caches.delete(MEDIA_CACHE);
  await caches.delete('bird-sounds-photos'); // photos kept as they were seen (sw.js PHOTOS)
  toast('Downloads deleted');
  updateOfflineInfo();
});

// ---------- tabs ----------

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  if (name !== 'study') stopAudio();
  if (name === 'birds') renderBirds();
  if (name === 'progress') renderProgress();
  if (name === 'settings') renderSettings();
  if (name === 'study') { if (cur) renderCard(); else newCard(); }
  window.scrollTo(0, 0);
}

document.querySelector('.tabs').addEventListener('click', (e) => {
  const t = e.target.closest('[data-view]');
  if (t) showView(t.dataset.view);
});

// No keyboard shortcuts: typing elsewhere while this window had focus answered cards (user 2026-11-17).

// ---------- start ----------

// ---------- choose a new password (after a reset link) ----------

function openPwSheet() {
  $('newPw').value = '';
  $('newPw').type = 'password';
  $('showNewPw').checked = false;
  $('pwSheet').hidden = false;
  $('newPw').focus();
}

$('showNewPw').addEventListener('change', (e) => { $('newPw').type = e.target.checked ? 'text' : 'password'; });
$('pwCancel').addEventListener('click', () => { $('pwSheet').hidden = true; });
$('pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('newPw').value;
  if (pw.length < 6) return toast('Password needs at least 6 characters');
  $('pwSave').disabled = true;
  try {
    await Sync.setPassword(pw);
    $('pwSheet').hidden = true;
    toast('Password changed. You are signed in.');
    renderAccount();
  } catch (err) {
    const m = (err.message || '').toLowerCase();
    toast(m.includes('different') ? 'Choose a password different from your old one' : friendly(err));
  }
  $('pwSave').disabled = false;
});

// ---------- what's new ----------
// Shown once when the app opens after an update, only for changes people will enjoy (not
// fixes or behind-the-scenes work; user: rule tuning such as points needed or when choices
// show is NOT news). Add an entry here for each appealing release; the full
// list of changes is in CHANGELOG.md. prefs.seenNews = the last version whose news was seen
// (synced). New users start at the current version, so they see nothing until the next one.
const WHATS_NEW = [
  { v: '1.5.0', items: ['🥉🥈🥇 Medals for every bird: bronze when you master it, then silver on its varied sounds and gold on any recording of it.'] },
  { v: '1.5.1', items: ['🌳 Pick habitats to focus on (forest, coast, fynbos…) in Settings: their birds come first.'] },
  { v: '1.6.4', items: ['🎨 Choose your background and shade of green in Settings → Colours.'] },
  { v: '1.6.9', items: ['🌿 Each bird\'s usual habitats show on its cards, and the 4 choices are birds from the same habitats: the ones you\'d really mix it up with outside.'] },
];
const verNum = (v) => v.split('.').reduce((n, x) => n * 1000 + (+x || 0), 0);

function maybeShowNews() {
  if (S.prefs.seenNews == null) {
    // First time with this feature: start from now, for everyone. (v1.7.0 started existing
    // users at 1.4.9 and showed old news they had already used; user didn't want that.)
    S.prefs.seenNews = VERSION;
    save();
  }
  if (overlayOpen() || !$('privacySheet').hidden || !$('newsSheet').hidden) return;
  const seen = verNum(S.prefs.seenNews);
  const items = WHATS_NEW.filter((n) => verNum(n.v) > seen && verNum(n.v) <= verNum(VERSION)).flatMap((n) => n.items);
  if (!items.length) {
    if (S.prefs.seenNews !== VERSION) { S.prefs.seenNews = VERSION; save(); }
    return;
  }
  $('newsList').innerHTML = items.slice(-6).reverse().map((t) => `<li>${esc(t)}</li>`).join('');
  $('newsSheet').hidden = false;
}

$('newsOk').addEventListener('click', () => {
  $('newsSheet').hidden = true;
  S.prefs.seenNews = VERSION;
  save();
});

// ---------- your data: choices ----------
// Signed-in users choose what happens with their data; prefs.privacy = { v, at, share } (synced).
// Saving progress with the account is essential (always on). share = their answers, ratings
// and mix-ups (and, from v3, recording load times) count, anonymously, in the shared totals.
// Ticked by default (user's choice, v1.7.3), they can untick it before saving; a choice made
// before is kept. The SQL totals only read accounts with share = true
// (supabase/10-only-count-people-who-share.sql). Location isn't asked here: "Near me" asks when
// it's picked (prefs.nearOk). When the policy changes in a way that affects accounts, bump
// PRIVACY_VERSION and say what changed in PRIVACY_CHANGES: everyone signed in is asked again.
const PRIVACY_VERSION = 5; // v2 (v1.6.5): choices instead of one "I agree"; v3 (v1.7.3): load times shared too;
// v4 (v2.0.4): asked again, ticked, because the v2 box started unticked and most people just saved it;
// v5 (v2.0.5): flags and star ratings always count in the shared totals (given on purpose; SQL 18).
const PRIVACY_CHANGES = 'Please check your choices. Flags and star ratings you give now always count towards the shared totals, anonymously, so a bad recording gets replaced for everyone. When you were last asked, the box to add your answers started unticked, so many people left it off without meaning to. You can change this any time in Settings → Account.';
const SHARE_KEPT_FROM = 4; // earlier choices made from this version on are shown as they were

function setPrivacy(share) {
  S.prefs.privacy = { v: PRIVACY_VERSION, at: new Date().toISOString(), share: !!share };
  save();
}

function checkPrivacy() {
  if (!Sync.signedIn() || (S.prefs.privacy?.v || 0) >= PRIVACY_VERSION || !$('privacySheet').hidden) return;
  $('privacyTitle').textContent = 'Your data';
  $('privacyText').textContent = PRIVACY_CHANGES;
  const p = S.prefs.privacy;
  $('privacyShare').checked = p && p.v >= SHARE_KEPT_FROM ? !!p.share : true; // ticked unless they said no since v4
  $('privacySheet').hidden = false;
}

$('privacyAgree').addEventListener('click', () => {
  setPrivacy($('privacyShare').checked);
  $('privacySheet').hidden = true;
  if ($('view-settings').classList.contains('active')) renderAccount();
  maybeShowNews();
});
$('privacyDecline').addEventListener('click', async () => {
  $('privacySheet').hidden = true;
  await Sync.signOut().catch(() => {});
  S.sync = {};
  saveLocal();
  showView('study');
  openWelcome();
  toast('Signed out: your progress stays on this device. To delete your account, sign in and use Settings → Account.');
});

// ---------- welcome (first open) ----------

const welcomeOpen = () => !$('welcome').hidden;
const needsWelcome = () => Sync.configured && !Sync.signedIn() && !S.prefs.welcomeDone;

// The sign-in form is one element (#account), moved between the welcome screen and Settings.
function openWelcome() {
  $('welcomeSlot').appendChild($('account'));
  $('welcome').hidden = false;
  renderAccount();
}

function closeWelcome() {
  S.prefs.welcomeDone = true;
  save();
  $('accountPanel').appendChild($('account'));
  $('welcome').hidden = true;
  renderAccount();
  if (needsSurvey()) openSurvey();
  else newCard();
}

// ---------- habitats ----------
const HABITATS = {
  forest: { icon: '🌳', label: 'Forest' },
  woodland: { icon: '🌿', label: 'Woodland & bushveld' },
  scrub: { icon: '🌸', label: 'Fynbos, karoo & scrub' },
  grassland: { icon: '🌾', label: 'Grassland' },
  dry: { icon: '🏜️', label: 'Dry, desert & rocky' },
  water: { icon: '💧', label: 'Wetlands & rivers' },
  coast: { icon: '🌊', label: 'Coast & sea' },
  town: { icon: '🏡', label: 'Gardens & towns' },
};

// Toggle buttons, one per habitat; counts = birds of the current region in that habitat.
function habitatOpts(chosen, counts) {
  return Object.entries(HABITATS).map(([k, v]) => {
    const n = counts ? species.filter((b) => (habitats[b.id] || []).includes(k)).length : null;
    return `<button type="button" class="opt hab-opt ${chosen.includes(k) ? 'on' : ''}" data-hab="${k}" aria-pressed="${chosen.includes(k)}">
      <b>${v.icon} ${esc(v.label)}</b>${n != null ? `<span>${n} birds</span>` : ''}</button>`;
  }).join('');
}
const toggleIn = (list, k) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);

function habitatChips(id) {
  return (habitats[id] || []).map((h) => HABITATS[h]
    ? `<span class="chip" data-tip="${esc(TIPS.habitat)}">${HABITATS[h].icon} ${esc(HABITATS[h].label)}</span>` : '').join('');
}

// ---------- survey (experience + area) ----------

const LEVELS = {
  new: { label: 'New to bird calls', desc: 'Start with 10 birds. Each new bird is introduced before you are tested on it.', pool: 10, intros: true },
  some: { label: 'I know a few calls', desc: 'Start with 20 birds, with an introduction for each new one.', pool: 20, intros: true },
  good: { label: 'I know most common calls', desc: 'Start with 40 birds, with introductions.', pool: 40, intros: true },
  expert: { label: 'Experienced', desc: 'All birds in play from the start, no introductions, and varied recordings from the start: a bird you master earns silver straight away.', pool: 0, intros: false, startLevel: 2 },
};

const overlayOpen = () => !$('welcome').hidden || !$('survey').hidden;
const needsSurvey = () => !S.prefs.surveyDone;
let surveyPick = { level: 'some', area: DEFAULT_AREA, order: 'distinct', habitats: [], nameSet: 'en_ZA' };

function openSurvey() {
  surveyPick = { level: S.prefs.level || 'some', area: currentAreaId(), order: S.prefs.order || 'distinct',
    habitats: [...(S.prefs.habitats || [])], nameSet: S.prefs.nameSet || 'en_ZA' };
  renderSurvey();
  $('survey').hidden = false;
}

function renderSurvey() {
  for (let a = areaById(surveyPick.area); a; a = areaById(a.parent)) if (a.parent) openAreas.add(a.parent);
  $('levelOpts').innerHTML = Object.entries(LEVELS).map(([k, v]) =>
    `<button class="opt ${k === surveyPick.level ? 'on' : ''}" data-level="${k}"><b>${esc(v.label)}</b><span>${esc(v.desc)}</span></button>`).join('');
  $('orderOpts').innerHTML = Object.entries(ORDERS).map(([k, v]) =>
    `<button class="opt ${k === surveyPick.order ? 'on' : ''}" data-order="${k}"><b>${esc(v.label)}${k === 'distinct' ? ' (recommended)' : ''}</b><span>${esc(v.desc)}</span></button>`).join('');
  $('habOpts').innerHTML = habitatOpts(surveyPick.habitats, false);
  $('nameOpts').innerHTML = Object.entries(nameSets).map(([k, v]) =>
    `<button class="opt ${k === surveyPick.nameSet ? 'on' : ''}" data-nameset="${k}"><b>${esc(v)}${k === 'en_ZA' ? ' (as in Merlin set to South Africa)' : ''}</b></button>`).join('');
  renderAreaPicker();
}

// Region picker: a tree that opens level by level (Southern Africa › country › province ›
// area), plus a search box that lists matching regions directly.
const openAreas = new Set(['all']);
let areaQuery = '';

function areaOpt(a, depth, showPath) {
  const kids = visibleAreas().some((x) => x.parent === a.id);
  const sub = a.near
    ? (birdCount(a) ? `${birdCount(a)} birds recorded within ${NEAR_KM} km of you` : `Birds recorded within ${NEAR_KM} km of you (uses your location)`)
    : `${birdCount(a)} birds${a.private ? ' · only you can see this' : ''}`;
  // Search results: name in bold, the regions it sits in as a short grey line (no "Southern Africa").
  const where = showPath ? areaPath(areaById(a.parent) || {}).split(' › ').slice(1).join(' › ') : '';
  const toggle = showPath ? ''
    : kids ? `<button class="area-toggle" data-toggle="${a.id}" aria-label="${openAreas.has(a.id) ? 'Close' : 'Open'} ${esc(a.name)}">${openAreas.has(a.id) ? '▾' : '▸'}</button>`
    : '<span class="area-toggle-space"></span>';
  return `<div class="area-row" style="--depth:${depth}">
    ${toggle}
    <button class="opt area-opt ${a.id === surveyPick.area ? 'on' : ''}" data-area="${a.id}">
      <b>${esc(a.name)}</b>${where ? `<span class="area-where">${esc(where)}</span>` : ''}<span>${esc(sub)}</span></button>
  </div>`;
}

function renderAreaPicker() {
  const q = areaQuery.trim().toLowerCase();
  let rows;
  if (q) {
    rows = visibleAreas().filter((a) => a.name.toLowerCase().includes(q)).map((a) => areaOpt(a, 0, true));
    if (!rows.length) rows = ['<p class="muted small">No region matches that.</p>'];
  } else {
    const shown = (parent, depth) => visibleAreas().filter((a) => a.parent === parent).flatMap((a) =>
      [areaOpt(a, depth, false), ...(openAreas.has(a.id) ? shown(a.id, depth + 1) : [])]);
    rows = shown(null, 0);
  }
  $('areaOpts').innerHTML = `<input class="search" id="areaSearch" type="search" placeholder="Search regions, e.g. Kruger" value="${esc(areaQuery)}" autocomplete="off">`
    + rows.join('');
}

$('areaOpts').addEventListener('input', (e) => {
  if (e.target.id !== 'areaSearch') return;
  areaQuery = e.target.value;
  const pos = e.target.selectionStart;
  renderAreaPicker();
  $('areaSearch').focus();
  $('areaSearch').setSelectionRange(pos, pos);
});

function applyLevel(level) {
  const L0 = LEVELS[level] || LEVELS.some;
  S.prefs.level = level;
  S.prefs.intros = L0.intros;
  S.prefs.introsChosen = true;
  S.learn.startPool = L0.pool || species.length;
  S.learn.startLevel = L0.startLevel || 1;
  L.ensurePool(S.learn, species, { all: !L0.pool });
}

// Open/close a region in the tree; true when the click was on an arrow.
function toggleArea(e) {
  const tg = e.target.closest('[data-toggle]');
  if (!tg) return false;
  if (openAreas.has(tg.dataset.toggle)) openAreas.delete(tg.dataset.toggle);
  else openAreas.add(tg.dataset.toggle);
  renderAreaPicker();
  return true;
}

$('survey').addEventListener('click', (e) => {
  const lv = e.target.closest('[data-level]');
  const ar = e.target.closest('[data-area]');
  if (toggleArea(e)) return;
  const od = e.target.closest('[data-order]');
  if (od) { surveyPick.order = od.dataset.order; return renderSurvey(); }
  const hb = e.target.closest('[data-hab]');
  if (hb) { surveyPick.habitats = toggleIn(surveyPick.habitats, hb.dataset.hab); return renderSurvey(); }
  const ns = e.target.closest('[data-nameset]');
  if (ns) { surveyPick.nameSet = ns.dataset.nameset; return renderSurvey(); }
  if (lv) surveyPick.level = lv.dataset.level;
  if (ar) surveyPick.area = ar.dataset.area;
  if (lv) renderSurvey();
  if (ar) renderAreaPicker();
  if (e.target.id === 'surveyDone') finishSurvey();
});

async function finishSurvey() {
  {
    $('surveyDone').disabled = true;
    S.prefs.order = surveyPick.order;
    S.prefs.habitats = surveyPick.habitats;
    S.prefs.nameSet = surveyPick.nameSet;
    const ok = await chooseArea(surveyPick.area);
    $('surveyDone').disabled = false;
    if (!ok) return;
    applyLevel(surveyPick.level);
    S.prefs.surveyDone = true;
    save();
    $('survey').hidden = true;
    newCard();
  }
}

$('skipSignIn').addEventListener('click', closeWelcome);

$('replayWelcome').addEventListener('click', () => {
  stopAudio();
  S.prefs.welcomeDone = false;
  S.prefs.surveyDone = false;
  save();
  showView('study');
  if (needsWelcome()) openWelcome();
  else openSurvey();
});

async function start() {
  $('buildNo').textContent = `v${VERSION}`;
  try {
    const [sp, cl, ar, gd, hb] = await Promise.all([
      fetch('data/species.json').then((r) => r.json()),
      fetch('data/calls.json').then((r) => r.json()),
      fetch('data/areas.json').then((r) => r.json()),
      fetch('data/guide.json').then((r) => r.json()).catch(() => null),
      fetch('data/habitats.json').then((r) => r.json()).catch(() => ({})),
    ]);
    if (gd) guide = gd;
    habitats = hb;
    allSpecies = sp.species.filter((b) => (cl[b.id] || []).length);
    areas = ar.areas;
    nameSets = sp.nameSets;
    calls = cl;
    knownIds = new Set(allSpecies.map((b) => b.id));
    await updateOwner();
    // George / Wilderness used to be just the owner's 100 birds; with the full app it holds
    // every bird recorded there, so move the owner to their practice list once.
    if (isOwner && S.prefs.area === 'george' && !S.prefs.myListMoved) {
      S.prefs.area = 'mylist';
      S.prefs.myListMoved = true;
      save(); // also syncs, so other devices don't move back
      setTimeout(() => toast('Moved you to My practice list (your 100 birds). Change region in Settings.'), 1200);
    }
    applyArea();
    if (!nameSets[S.prefs.nameSet]) S.prefs.nameSet = 'en_ZA';
    let back = false;
    try {
      back = await Sync.takeRedirect();
    } catch (err) {
      const m = (err.message || '').toLowerCase();
      toast(m.includes('expired') || m.includes('invalid')
        ? 'That link has expired or was already used. Ask for a new one.'
        : "Sign-in didn't finish. Try again.");
    }
    if (back) S.prefs.welcomeDone = true;
    if (back === 'google') toast('Signed in with Google');
    if (needsWelcome()) openWelcome();
    else if (needsSurvey()) openSurvey();
    else newCard();
    if (back === 'recovery') openPwSheet();
    // After the cloud copy, which may hold an agreement (and seen news) from another device.
    syncNow({ firstSignIn: !!back }).finally(() => { checkPrivacy(); maybeShowNews(); });
    loadScores();
    loadDifficulty();
    Sync.refreshProfile().then(renderAvatar).catch(() => {});
    if (await updateOwner()) { applyArea(); renderTop(); }
  } catch (e) {
    $('topSub').textContent = "Couldn't load the bird data. Check your connection and reload.";
    console.error(e);
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
