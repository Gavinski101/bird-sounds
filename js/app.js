import * as L from './learn.js';
import * as Sync from './sync.js';
import { OWNER_HASHES } from './config.js';

// Version shown faintly at the bottom of the screen. Bump it with SHELL in sw.js on every release
// and add a line to CHANGELOG.md. Each release adds 0.0.1; after x.y.9 comes x.(y+1).0.
// 1.0.0 = first public version (2026-11-12).
const VERSION = '1.6.1';
const STORE_KEY = 'bird-sounds-v1';
const MEDIA_CACHE = 'bird-sounds-media';
const TIER_ORDER = ['Beginner', 'Easy', 'Medium', 'Hard'];
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
  const privacy = [local.prefs?.privacy, data.prefs?.privacy].filter(Boolean).sort((a, b) => b.v - a.v)[0];
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
      <p class="small muted">By signing in you agree to the <a href="privacy.html">privacy policy</a>: your progress is saved with your account, and counted without your name in shared totals that help everyone.</p>
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
    agreePrivacy(); // the form shows the privacy notice
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
// A recording 2+ people flagged (or 2+ rated 1-2 on average) is dropped for everyone, and
// the average rating orders the rest. Your own rating, flag or "Use anyway" always wins.
const SCORES_KEY = 'bird-sounds-scores';
const SHARED_MIN = 2;
let scores = {};
try { scores = JSON.parse(localStorage.getItem(SCORES_KEY))?.map || {}; } catch { /* none yet */ }
const shared = (r) => scores[recKey(r)];
// How often a recording led to a right answer, across everyone (v1.4.6): only once it has
// been answered on REC_ANSWERS_MIN times. A recording people mostly get wrong (below
// REC_CONFUSING) is dropped like a flagged one; otherwise the rate nudges the order.
const REC_ANSWERS_MIN = 5;
const REC_CONFUSING_MIN = 8;
const REC_CONFUSING = 0.3;
const rightRate = (r, min = REC_ANSWERS_MIN) => {
  const c = shared(r);
  const n = c ? (c.ok || 0) + (c.no || 0) : 0;
  return n >= min ? c.ok / n : null;
};
const sharedOff = (r) => {
  const c = shared(r);
  if (!c) return false;
  const rate = rightRate(r, REC_CONFUSING_MIN);
  return c.flags >= SHARED_MIN || (c.raters >= SHARED_MIN && c.avg <= 2) || (rate != null && rate < REC_CONFUSING);
};
const sharedStars = (r) => { const c = shared(r); return c && c.raters >= SHARED_MIN ? c.avg : null; };

async function loadScores(force = false) {
  if (!Sync.configured || !navigator.onLine) return;
  try {
    const c = JSON.parse(localStorage.getItem(SCORES_KEY));
    if (!force && c && Date.now() - c.at < 6 * 3600e3) return;
  } catch { /* fetch */ }
  try {
    const rows = await Sync.recScores();
    scores = Object.fromEntries((rows || []).map((x) => [x.rec, { flags: x.flags, raters: x.raters, avg: x.avg_stars == null ? null : +x.avg_stars, ok: x.right_answers || 0, no: x.wrong_answers || 0 }]));
    localStorage.setItem(SCORES_KEY, JSON.stringify({ at: Date.now(), map: scores }));
  } catch (e) { console.warn('recording scores', e); }
}

// Shared difficulty (supabase/9-shared-bird-difficulty.sql): a bird many people struggle
// with moves one ease group later for everyone (only affects birds not yet in play), and
// pairs many people mix up are kept apart like the hand-made sound-alikes. The user's
// iconic birds (ease 0) never move. Cached 6 h like the recording scores.
const DIFF_KEY = 'bird-sounds-difficulty';
// Votes scale with the user base (user 2026-11-17): with one user, they are the whole base.
const SHARED_HARD_SHARE = 0.5;  // share of people (who answered it 3+ times) missing it more than not
const SHARED_PAIR_SHARE = 0.25; // share of people who mixed the pair up 2+ times (min 1 person)
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
    const base = Math.max(1, ...(birds || []).map((x) => x.users)); // people answering, roughly
    const data = {
      hard: (birds || []).filter((x) => x.strugglers >= 1 && x.strugglers / x.users >= SHARED_HARD_SHARE).map((x) => x.bird).sort(),
      pairs: (mixes || []).filter((x) => x.users >= Math.max(1, Math.ceil(base * SHARED_PAIR_SHARE))).map((x) => [x.a, x.b]).sort(),
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
const nearScore = (r) => (recKm(r) ?? 3000) + (Q_KM[r.q] ?? 600) + 40 * (r.bg || 0);

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
  return [...shuffle(pick), ...all.filter((r) => !picked.has(recKey(r)))];
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
  return (sharedStars(r) ?? 3) + (rate != null ? (rate - 0.6) * 2.5 : 0); // 100% right = +1, 20% = -1
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

function credit(r) {
  const link = r.src === 'inat'
    ? `<a href="https://www.inaturalist.org/observations/${r.obs}" target="_blank" rel="noopener">iNaturalist</a>`
    : `<a href="https://xeno-canto.org/${r.xc}" target="_blank" rel="noopener">XC${r.xc}</a>`;
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
  soundsLike: 'Birds you have taken this one for at least twice: from wrong hint choices and your answers to "What did you think it was?".',
  mixUps: 'Pairs you have confused: from wrong picks in hints and your answers to "What did you think it was?" after a miss. Play both to compare.',
  hardest: 'Birds you have met and missed at least twice, with the highest share of misses first.',
  area: 'Your home area. Beginner to Hard tiers are based on how often each bird is recorded around here.',
  inPlay: "Birds in your study set: the ones you've met plus any waiting to be introduced. More are added as you master these.",
  met: "Birds you've been introduced to and are now being tested on (includes mastered ones).",
  confused: 'Birds you have mixed this one up with: from wrong hint choices and what you said you thought it was. Pairs you mix up 2+ times get compare cards.',
  mastered: "Mastered birds by medal: 🥉 bronze, 🥈 silver, 🥇 gold. Mastered = birds you've got right enough times to count as known (6 points: each clean right answer +2, with a hint +1, a miss -2, all in one total): each has at least a bronze medal. They still come back now and then, with harder recordings, to earn silver and gold.",
  medal: {
    1: 'Bronze: mastered on its 1-2 study recordings (its typical sound).',
    2: "Silver: also mastered on its varied sounds: random recordings from the bird's other good ones, other calls and songs included.",
    3: 'Gold: mastered from any recording of it at all, any quality, in random order.',
  },
  level: {
    2: 'Silver test: a random recording from this bird\'s varied sounds. 4 points earns silver: clean right +2, with a hint +1, a miss -1, all in one total. Medals are never taken away; a miss just brings it back sooner.',
    3: 'Gold test: any recording of this bird, in random order. 4 points earns gold: clean right +2, with a hint +1, a miss -1, all in one total. Medals are never taken away.',
  },
  habitat: "Where this bird is usually found. From AVONET (Tobias et al. 2022, CC BY 4.0), plus extra habitats for birds often heard elsewhere too.",
  habitats: 'Birds of the habitats you pick join your study set first, in the usual order among themselves; the other birds follow after them. Pick none to mix all habitats. Progress on every bird is kept.',
  points: 'One total for each bird: a clean right answer adds 2 points, one with a hint adds 1, a miss takes 2 off. 6 points = mastered. Hinted and clean answers count together, so e.g. 2 clean + 2 with hints is enough.',
  medalAnswers: 'Answers on silver and gold cards. Counted apart, so the harder recordings do not make this bird look hard for others.',
  streak: 'Birds right in a row: now / your record. A miss starts the current run again from 0. Answers with a hint still count.',
  accuracy: 'How many of your last 20 answers were right.',
  recInfo: "Which recording is playing and what kind of sound it is. The first 1-2 are your study recordings. Next recording and Previous then go through every xeno-canto recording of this bird made in Africa, nearest to your region and best quality first. Rate one 4-5 stars to make it a study recording.",
  family: 'The bird family this species belongs to.',
  soundClue: "A description of this bird's sound. Words from the birds' names are hidden (…) so it doesn't give the answer away.",
  sharedOff: 'Two or more people flagged this recording or rated it low, so it is no longer used. "Use anyway" brings it back for you.',
  rightRate: 'How often people got this bird right when this recording was the one playing. Recordings people often get right are used first; one most people get wrong (under 30% after 8 answers) is no longer used.',
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
  return `${sp.tier} in ${area}: number ${sp.rank} of the ${areaTotal} birds recorded there, by how often they're recorded. Beginner = top 40, Easy = 41-100, Medium = 101-180, Hard = rarer.`;
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
  if (tipEl.contains(e.target)) return;
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

const audio = $('audio');

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
let audioOwner = null;
let blobUrl = null;

async function srcFor(r) {
  try {
    const cache = await caches.open(MEDIA_CACHE);
    const hit = await cache.match(r.file);
    if (hit) {
      // Offline copy: play from a blob URL (works on iOS, which rejects cached media through a service worker).
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(await hit.blob());
      return blobUrl + (r.t ? `#t=${r.t[0]},${r.t[1]}` : '');
    }
  } catch { /* Cache API unavailable */ }
  return r.file + (r.t ? `#t=${r.t[0]},${r.t[1]}` : '');
}

async function playRec(r, button) {
  const key = recKey(r);
  // Still loading this one: ignore extra taps. (They used to resume the PREVIOUS sound,
  // which was still in the player, so the button seemed to need several taps.)
  if (audioKey === key && audioOwner === button && button.classList.contains('loading')) return;
  if (audioKey === key && audioOwner === button) {
    if (!audio.paused) return audio.pause();
    if (audio.ended) audio.currentTime = 0;
    return audio.play().catch(() => {});
  }
  const seq = ++playSeq;
  audioKey = key;
  audioOwner = button;
  audioSecs = r.t ? r.t[1] - r.t[0] : r.secs || 0;
  $('recError').hidden = true;
  setPlaying(button, 'loading');
  loadingFile = r.file;
  showLoad(r.file);
  // Whole file first (ring shows how far), so it plays straight through; if the download
  // fails it streams from xeno-canto as before.
  await cacheRec(r);
  if (seq !== playSeq) return;
  const src = await srcFor(r);
  if (seq !== playSeq) return; // a newer card or sound started while this one was loading
  audio.src = src;
  audio.play().catch((e) => {
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

audio.addEventListener('playing', () => setPlaying(playingBtn, 'playing'));
audio.addEventListener('pause', () => setPlaying(playingBtn, 'paused'));
audio.addEventListener('ended', () => setPlaying(playingBtn, 'paused'));
audio.addEventListener('timeupdate', () => {
  if (playingBtn !== $('playBtn')) return;
  // xeno-canto doesn't send the file length up front, so the browser often only learns the
  // duration at the end of the download.
  const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : audioSecs;
  const p = d ? Math.min(100, (audio.currentTime / d) * 100) : 0;
  $('barFill').style.width = `${p}%`;
});
// Tap or drag the progress bar to jump to another part of the recording. If this recording
// isn't playing yet, it starts and then jumps once the browser knows where it can go.
let pendingSeek = null;
function audioLength() {
  return Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : audioSecs;
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
['loadedmetadata', 'playing'].forEach((ev) => audio.addEventListener(ev, () => {
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

audio.addEventListener('error', () => {
  if (!audioKey) return;
  if (audioOwner === $('playBtn')) $('recError').hidden = false;
  setPlaying(playingBtn, 'paused');
});

// ---------- study ----------

function currentRec() {
  const recs = cardRecs();
  return recs[Math.min(cur.recIdx, recs.length - 1)];
}

async function newCard() {
  if (overlayOpen()) return; // welcome or survey showing: start when it closes
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
const loads = new Map(); // file -> { got, total, done }
function cacheRec(r) {
  if (!r) return Promise.resolve(false);
  if (loads.has(r.file)) return loads.get(r.file).done;
  const st = { got: 0, total: 0 };
  st.done = (async () => {
    try {
      const cache = await caches.open(MEDIA_CACHE);
      if (await cache.match(r.file)) return true;
      if (!navigator.onLine) return false;
      const res = await fetch(r.file, { mode: 'cors' });
      if (!res.ok) return false;
      st.total = +res.headers.get('content-length') || 0;
      let blob;
      if (res.body?.getReader) {
        const reader = res.body.getReader();
        const parts = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          st.got += value.length;
          showLoad(r.file);
        }
        blob = new Blob(parts, { type: res.headers.get('content-type') || 'audio/mpeg' });
      } else blob = await res.blob();
      await cache.put(r.file, new Response(blob, { headers: { 'content-type': blob.type, 'content-length': String(blob.size) } }));
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
function likelyNext() {
  const out = new Map();
  if (!cur) return out;
  const c = cur;
  const acts = c.stage === 'intro' ? [(s) => L.introduced(s, c.id)]
    : c.stage === 'compare' ? [(s) => L.compared(s, c.id, c.pair)]
    : [true, false].map((ok) => (s) => L.answer(s, species, c.id, { correct: ok, pair: c.pair || null, level: c.level }));
  for (const act of acts) {
    const base = structuredClone(S.learn);
    act(base);
    for (let i = 0; i < 4; i++) {
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
  for (const r of now) await cacheRec(r);
  if (run !== prefetchRun || !navigator.onLine || navigator.connection?.saveData) return;
  try {
    for (const [id, level] of likelyNext()) {
      if (run !== prefetchRun) return;
      let r = activeRecs(id)[0];
      if (level > 1) {
        await loadAllRecs(id);
        let plan = planned.get(id);
        if (plan?.level !== level) { plan = { level, recs: levelRecs(id, level) }; planned.set(id, plan); }
        r = plan.recs[0];
      }
      await cacheRec(r);
    }
    if (run === prefetchRun && cur === card && card.stage !== 'compare') await cacheRec(cardRecs()[card.recIdx + 1]);
  } catch { /* best effort */ }
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
    : "Who's calling?";
  if (cur.level > 1 && !shown) label.dataset.tip = TIPS.level[cur.level]; else delete label.dataset.tip;
  document.querySelector('.player').hidden = cur.stage === 'compare';

  $('recInfo').dataset.tip = TIPS.recInfo;
  const km = r ? recKm(r) : null;
  const total = allRecs[cur.id] ? recs.length : `${recs.length}+`;
  $('recInfo').textContent = `Recording ${Math.min(cur.recIdx, recs.length - 1) + 1} of ${total} · ${r ? r.type : ''}`
    + (km != null ? ` · ${km < 10 ? 'under 10' : Math.round(km / 10) * 10} km away` : '');
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
          ${b.photo ? `<img src="${esc(b.photo.url)}" alt="">` : ''}
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
      + `<div class="hint-text">${cur.pair ? 'Which of these two?' : 'Which one is it?'}</div>
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
    $('revealMeta').innerHTML = `<span class="chip" data-tip="${esc(TIPS.family)}">${esc(sp.family)}</span><span class="chip" data-tip="${esc(tierTip(sp))}">${esc(sp.tier)}</span>${chip(L.status(S.learn, sp.id))}${medalChip(sp.id)}`;
    $('revealTip').innerHTML = soundTipHtml(sp.id);
    $('revealTip').hidden = !$('revealTip').innerHTML;
    $('revealCredit').innerHTML = (r ? `Sound: ${credit(r)}<br>` : '') + (sp.photo ? `Photo: ${esc(sp.photo.attr)}` : '');
  }

  // Buttons
  const a = $('actions');
  if (cur.stage === 'intro') {
    a.innerHTML = '<button class="btn ghost" data-act="skip">Skip for later</button><button class="btn" data-act="introDone">Got it, next bird</button>';
  } else if (cur.stage === 'compare') {
    a.innerHTML = '<button class="btn wide" data-act="compared">Got it, test me later</button>';
  } else if (cur.stage === 'guess' && cur.pair) {
    a.innerHTML = '<button class="btn ghost wide" data-act="reveal">Reveal</button>';
  } else if (cur.stage === 'thought') {
    a.innerHTML = renderThought();
  } else if (cur.stage === 'guess') {
    a.innerHTML = `<button class="btn ghost" data-act="hint" ${cur.hint >= 2 ? 'disabled' : ''}>${cur.hint ? 'More hint' : 'Hint'}</button>
      <button class="btn" data-act="reveal">Reveal</button>`;
  } else if (cur.stage === 'revealed') {
    a.innerHTML = '<button class="btn bad" data-act="missed">Missed it</button><button class="btn good" data-act="got">Got it</button>';
  } else {
    a.innerHTML = '<button class="btn wide" data-act="next">Next bird</button>';
  }
  $('skipBtn').hidden = cur.stage !== 'guess'; // intro cards have it beside "Got it"
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
  <button class="btn ghost wide" data-act="next">Skip, I had no idea</button>`;
}

function makeChoices() {
  const sp = byId[cur.id];
  const pool = new Set(S.learn.pool);
  const confused = [...new Set([...L.confusedWith(S.learn, sp.id).map((c) => c.id), ...similarTo(sp.id)])]
    .filter((id) => areaIds.has(id)).map((id) => byId[id]);
  const confusedIds = new Set(confused.map((x) => x.id));
  const others = species.filter((x) => x.id !== sp.id && !confusedIds.has(x.id));
  const sameFam = shuffle(others.filter((x) => x.familySci === sp.familySci));
  const inPlay = shuffle(others.filter((x) => pool.has(x.id) && x.familySci !== sp.familySci));
  const rest = shuffle(others.filter((x) => !pool.has(x.id) && x.familySci !== sp.familySci));
  const pick = [...confused.slice(0, 2), ...sameFam, ...inPlay, ...rest].slice(0, 3).map((x) => x.id);
  return shuffle([sp.id, ...pick]);
}

async function grade(correct) {
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
async function stepRec(step) {
  const id = cur.id;
  stopAudio();
  // Only before answering, and only on level-1 cards (silver/gold are meant to be harder).
  if (cur.stage === 'guess' && cur.level === 1) { L.otherPressed(S.learn, id); save(); }
  await loadAllRecs(id); // the full list, the first time
  if (!cur || cur.id !== id) return;
  const n = cardRecs().length;
  if (n < 2) return toast('No other recordings of this bird');
  cur.recIdx = (Math.min(cur.recIdx, n - 1) + step + n) % n;
  renderCard();
  playRec(currentRec(), $('playBtn'));
}
$('otherRecBtn').addEventListener('click', () => stepRec(1));
$('prevRecBtn').addEventListener('click', () => stepRec(-1));

function skipCard() {
  // Name it only on an intro card: on a test card the name would give the answer away.
  toast(cur.stage === 'intro' ? `${nm(byId[cur.id])} skipped: it comes back later` : 'Skipped: this bird comes back later');
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
}

function renderStars(el, rec, big) {
  const v = recPref(rec).stars || 0;
  el.innerHTML = [1, 2, 3, 4, 5].map((i) =>
    `<button class="star ${i <= v ? 'on' : ''}" data-star="${i}" data-xc="${esc(recKey(rec))}" role="radio" aria-checked="${i === v}" aria-label="${i} star${i > 1 ? 's' : ''}">★</button>`).join('');
  el.classList.toggle('small', !big);
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
  const r = currentRec();
  if (!r) return;
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
        <img src="${esc(sp.photo?.url || '')}" alt="" loading="lazy">
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
        ${byId[c.id].photo ? `<img src="${esc(byId[c.id].photo.url)}" alt="">` : ''}
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
          ${!pref.flag && !pref.stars && !pref.keep && sharedOff(r) ? `${shared(r).flags >= SHARED_MIN || (shared(r).raters >= SHARED_MIN && shared(r).avg <= 2) ? `<span class="chip" data-tip="${esc(TIPS.sharedOff)}">Flagged by others</span>` : `<span class="chip" data-tip="${esc(TIPS.rightRate)}">Often answered wrong</span>`} <button class="link" data-unflag="${esc(recKey(r))}">Use anyway</button>` : ''}</div>
      </div>
      <div class="stars small" data-rate="${esc(recKey(r))}"></div>
      ${shared(r)?.raters ? `<div class="small muted" data-tip="${esc(TIPS.sharedStars)}">Everyone: ${shared(r).avg.toFixed(1)}★ from ${shared(r).raters} ${shared(r).raters === 1 ? 'person' : 'people'}</div>` : ''}
      ${rightRate(r, 3) != null ? `<div class="small muted" data-tip="${esc(TIPS.rightRate)}">Everyone: right ${Math.round(rightRate(r, 3) * 100)}% of ${shared(r).ok + shared(r).no} answers</div>` : ''}
      <div class="credit">${credit(r)}${r.loc ? '<br>' + esc(r.loc) : ''}</div>
      ${pref.flag ? '' : `<button class="link" data-flagrec="${esc(recKey(r))}">⚑ Rate / flag</button>`}
    </div>`;
  }
  if (sp.photo) html += `<p class="credit">Photo: ${esc(sp.photo.attr)}</p>`;
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
    : '<p class="muted small">None yet. When you miss a bird, use a hint or answer "What did you think it was?" and the app learns which birds you mix up.</p>';
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
// One total: clean right +2, with a hint +1.
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
      <div class="tier-head" style="margin:0"><span class="tier-name" data-tip="${esc(`${tier}: how common these birds are around ${area}. Beginner = the 40 most recorded birds, Easy = 41-100, Medium = 101-180, Hard = rarer.`)}">${tier}</span><span>${t.mastered} of ${t.total} mastered</span></div>
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
    Each right answer adds points toward mastered: +2 clean, +1 with a hint, all in one total; 6 points = mastered (a miss takes 2 off). Silver and gold then need 4 points each.
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

// Colour themes (Settings -> Colours); colours are in styles.css under :root[data-theme].
// c = [light accent, dark accent], for the swatches and the browser bar. Calmer set (v1.5.7,
// user: the bright ones looked 'vibe coded'; greens were the best). Picks of removed themes
// fall back to the default.
const THEMES = {
  original: { label: 'Original', c: ['#1f6b4a', '#5cc08d'] },
  bushveld: { label: 'Bushveld', c: ['#174f37', '#4fae7f'] },
  spring: { label: 'Spring', c: ['#2a8a5c', '#6fd39f'] },
  jade: { label: 'Jade', c: ['#1d6b5e', '#5cc0ad'] },
  forest: { label: 'Forest', c: ['#2f5d45', '#8fc1a3'] },
  fynbos: { label: 'Fynbos', c: ['#5f7a5a', '#a9c3a0'] },
  eucalyptus: { label: 'Eucalyptus', c: ['#4f7a74', '#9cc7c0'] },
  moss: { label: 'Moss', c: ['#55703a', '#aac68a'] },
  olive: { label: 'Olive', c: ['#66663a', '#c4c38a'] },
  savanna: { label: 'Savanna', c: ['#8a6a4a', '#d4b494'] },
  sunset: { label: 'Terracotta', c: ['#a5583a', '#e3a084'] },
  ocean: { label: 'Ocean', c: ['#3f6680', '#9fc0d6'] },
  granite: { label: 'Granite', c: ['#4a4f57', '#c3c7ce'] },
  dusk: { label: 'Dusk', c: ['#5e5a8a', '#b7b2e0'] },
  black: { label: 'Black', c: ['#161616', '#e8e8e8'], bar: ['#161616', '#000000'] },
};
const DEFAULT_THEME = 'moss'; // for everyone who hasn't picked one (index.html sets it before paint too)
const themeOf = () => (THEMES[S.prefs.theme] ? S.prefs.theme : DEFAULT_THEME);
function applyTheme() {
  const t = themeOf();
  if (document.documentElement.dataset.theme !== t) document.documentElement.dataset.theme = t;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', (THEMES[t].bar || THEMES[t].c)[dark ? 1 : 0]);
}

function renderSettings() {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  $('themeOpts').innerHTML = Object.entries(THEMES).map(([k, v]) =>
    `<button type="button" class="theme-opt ${k === themeOf() ? 'on' : ''}" data-theme-pick="${k}" aria-pressed="${k === themeOf()}">
      <i style="background:${v.c[dark ? 1 : 0]}"></i>${esc(v.label)}</button>`).join('');
  $('nameSet').innerHTML = Object.entries(nameSets).map(([k, v]) =>
    `<option value="${k}" ${k === S.prefs.nameSet ? 'selected' : ''}>${esc(v)}</option>`).join('');
  $('autoplay').checked = S.prefs.autoplay;
  $('intros').checked = S.prefs.intros;
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
    let i = queue.slice(0, 15).findIndex((b) => !last.some((o) => o.familySci === b.familySci || alike.has(`${o.id}|${b.id}`)));
    if (i < 0) i = 0;
    out.push(queue.splice(i, 1)[0]);
  }
  return out;
}

// Birds that can sound like this one (hand-made pairs + pairs many people mix up), used as
// hint choices.
const similarTo = (id) => [...(guide.similar || []), ...community.pairs].flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : [])).filter((x) => byId[x]);

function tierFor(rank) {
  return rank <= 40 ? 'Beginner' : rank <= 100 ? 'Easy' : rank <= 180 ? 'Medium' : 'Hard';
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
    if (sp.photo) items.push({ url: sp.photo.url, audio: false });
  }
  return items;
}

// Rough size: MP3s are ~25 KB per second of sound, photos ~60 KB.
const offlineMB = (items) => Math.max(1, Math.round(items.reduce((t, i) => t + (i.audio ? (i.secs || 20) * 25 : 60), 0) / 1024));

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
      if (await cache.match(it.url)) continue;
      try {
        const res = await fetch(it.url, { mode: it.audio ? 'cors' : 'no-cors' });
        if (it.audio && !res.ok) throw new Error(res.status);
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

// ---------- privacy agreement ----------
// Signed-in users agree to the privacy policy; prefs.privacy = { v, at } (synced). When the
// policy changes in a way that affects accounts, bump PRIVACY_VERSION and say what changed in
// PRIVACY_CHANGES: everyone signed in who hasn't agreed to that version is asked once.
// (v1 = the first agreement, so accounts made before it are asked too.)
const PRIVACY_VERSION = 1;
const PRIVACY_CHANGES = 'Your progress is saved with your account. It is also counted, without your name, in shared totals (which recordings and birds people find hard, and which birds they mix up) that help everyone. "Near me" sends a location rounded to about 10 km to iNaturalist.';

function agreePrivacy() {
  S.prefs.privacy = { v: PRIVACY_VERSION, at: new Date().toISOString() };
  save();
}

function checkPrivacy() {
  if (!Sync.signedIn() || (S.prefs.privacy?.v || 0) >= PRIVACY_VERSION || !$('privacySheet').hidden) return;
  $('privacyTitle').textContent = S.prefs.privacy ? 'Privacy policy updated' : 'Before you carry on';
  $('privacyText').textContent = PRIVACY_CHANGES;
  $('privacySheet').hidden = false;
}

$('privacyAgree').addEventListener('click', () => {
  agreePrivacy();
  $('privacySheet').hidden = true;
  toast('Thanks');
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
    if (back === 'google') { toast('Signed in with Google'); agreePrivacy(); } // Google button sits on the same form as the notice
    if (needsWelcome()) openWelcome();
    else if (needsSurvey()) openSurvey();
    else newCard();
    if (back === 'recovery') openPwSheet();
    syncNow({ firstSignIn: !!back }).finally(checkPrivacy); // after the cloud copy, which may hold an agreement from another device
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
