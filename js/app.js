import * as L from './learn.js';
import * as Sync from './sync.js';
import { OWNER_HASHES } from './config.js';

const STORE_KEY = 'bird-sounds-v1';
const MEDIA_CACHE = 'bird-sounds-media';
const BIG_DAY = new Date('2026-12-05T00:00:00');
const TIER_ORDER = ['Beginner', 'Easy', 'Medium', 'Hard'];
const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let species = [];      // birds in the current area, commonest first (rank/tier for that area)
let allSpecies = [];
let areas = [];
let byId = {};
let calls = {};
let nameSets = {};
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
  S = {
    ...defaultStore(),
    ...data,
    prefs: { ...defaultStore().prefs, ...data.prefs },
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
      renderAccount();
      toast('Account deleted');
    } else if (id === 'signOutBtn') {
      if (!confirm('Sign out? Your progress stays on this device and in your account.')) return;
      await Sync.signOut();
      S.sync = {};
      saveLocal();
      renderAccount();
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
const isOff = (r) => !!recPref(r).flag || (recPref(r).stars ?? 3) <= 2;

// The 1-2 recordings used for study: not flagged, not rated 1-2, highest rated first,
// otherwise in the order the build script ranked them.
function activeRecs(id) {
  const all = calls[id] || [];
  const ok = all.filter((r) => !isOff(r));
  return (ok.length ? ok : all)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (recPref(b.r).stars ?? 3) - (recPref(a.r).stars ?? 3) || a.i - b.i)
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
  area: 'Your home area. Beginner to Hard tiers are based on how often each bird is recorded around here.',
  inPlay: "Birds in your study set: the ones you've met plus any waiting to be introduced. More are added as you master these.",
  met: "Birds you've been introduced to and are now being tested on (includes mastered ones).",
  confused: 'Birds you have mixed this one up with: from wrong hint choices and what you said you thought it was. Pairs you mix up 2+ times get compare cards.',
  mastered: "Birds you've got right enough times to count as known (3 clean answers, or 6 with hints). They still come back now and then to check.",
  streak: 'Birds right in a row. A miss starts it again from 0. Answers with a hint still count.',
  accuracy: 'How many of your last 20 answers were right.',
  recInfo: "Which of this bird's 2 study recordings is playing, and what kind of sound it is (song, call, alarm...).",
  family: 'The bird family this species belongs to.',
  inUse: 'One of the 2 recordings you study for this bird. Rate or flag recordings to change which ones are used.',
  status: {
    mastered: 'Mastered: you know this one. It comes back less and less often to check you still remember it.',
    learning: "Learning: you've met this bird and are being tested on it.",
    new: "New: in your study set, but you haven't met it yet. It will be introduced soon.",
    locked: 'Not yet: not in your study set. Added as you master other birds, or use Progress, Add all birds now.',
  },
};

function tierTip(sp) {
  return `${sp.tier} in ${area}: number ${sp.rank} of the ${areaTotal} birds recorded there, by how often they're recorded. Beginner = top 40, Easy = 41-100, Medium = 101-180, Hard = rarer.`;
}

function chip(status) {
  const label = { mastered: 'Mastered', learning: 'Learning', new: 'New', locked: 'Not yet' }[status];
  return `<span class="chip ${status}" data-tip="${esc(TIPS.status[status])}">${label}</span>`;
}

// ---------- tooltips (hover on a computer, tap on a phone) ----------

const tipEl = document.createElement('div');
tipEl.className = 'tip';
tipEl.hidden = true;
document.body.appendChild(tipEl);
let tipTimer = null;

function showTip(el) {
  tipEl.textContent = el.dataset.tip;
  tipEl.hidden = false;
  const r = el.getBoundingClientRect();
  const w = tipEl.offsetWidth;
  const h = tipEl.offsetHeight;
  const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
  let y = r.bottom + 8;
  if (y + h > innerHeight - 76) y = r.top - h - 8;
  tipEl.style.left = `${x}px`;
  tipEl.style.top = `${Math.max(8, y)}px`;
}

function hideTip() {
  tipEl.hidden = true;
  clearTimeout(tipTimer);
}

document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el) showTip(el);
});
document.addEventListener('mouseout', (e) => {
  if (e.target.closest('[data-tip]')) hideTip();
});
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el) {
    showTip(el);
    clearTimeout(tipTimer);
    tipTimer = setTimeout(hideTip, 4000);
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
    playingBtn.classList.remove('playing', 'loading');
    if (playingBtn.classList.contains('mini-play')) playingBtn.innerHTML = PLAY_SVG;
  }
  playingBtn = btn;
  if (!btn) return;
  btn.classList.toggle('loading', mode === 'loading');
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
audio.addEventListener('error', () => {
  if (!audioKey) return;
  if (audioOwner === $('playBtn')) $('recError').hidden = false;
  setPlaying(playingBtn, 'paused');
});

// ---------- study ----------

function currentRec() {
  const recs = activeRecs(cur.id);
  return recs[Math.min(cur.recIdx, recs.length - 1)];
}

function newCard() {
  if (overlayOpen()) return; // welcome or survey showing: start when it closes
  stopAudio();
  const c = L.nextCard(S.learn, species, Math.random, { intros: S.prefs.intros });
  save();
  cur = { ...c, recIdx: 0, stage: c.intro ? 'intro' : c.pair ? 'compare' : 'guess', hint: 0, choices: null, chose: null, thought: '' };
  renderCard();
  renderTop();
  const photo = byId[cur.id]?.photo?.url;
  if (photo) new Image().src = photo; // fetch the answer photo while the sound plays
  setTimeout(prefetchSoon, 1500);
  if (!S.prefs.autoplay) return;
  if (cur.stage === 'compare') {
    const first = $('hintArea').querySelector('[data-cplay]');
    if (first) playRec(activeRecs(first.dataset.cplay)[0], first);
  } else playRec(currentRec(), $('playBtn'));
}

// Quietly save the recordings of the birds most likely to come up next, so the next card
// starts playing straight away. One small file at a time; skipped on data-saver connections.
let prefetching = false;
async function prefetchSoon() {
  if (prefetching || !navigator.onLine || navigator.connection?.saveData) return;
  prefetching = true;
  try {
    const ids = new Set(species.map((b) => b.id));
    const soon = S.learn.pool
      .filter((id) => ids.has(id) && id !== cur?.id)
      .map((id) => [id, S.learn.birds[id] || {}])
      .sort((a, b) => (a[1].intro === b[1].intro ? (a[1].due || 0) - (b[1].due || 0) : a[1].intro ? -1 : 1))
      .slice(0, 4);
    const cache = await caches.open(MEDIA_CACHE);
    for (const [id] of soon) {
      const r = activeRecs(id)[0];
      if (!r || (await cache.match(r.file))) continue;
      const res = await fetch(r.file, { mode: 'cors' });
      if (res.ok) await cache.put(r.file, res);
    }
  } catch { /* best effort */ }
  prefetching = false;
}

function renderCard() {
  const sp = byId[cur.id];
  const recs = activeRecs(cur.id);
  const r = currentRec();
  const shown = cur.stage !== 'guess' && cur.stage !== 'compare';

  const label = $('cardLabel');
  label.className = 'card-label' + (cur.intro || cur.stage === 'compare' ? ' new' : '');
  label.textContent = cur.intro ? 'New bird: listen and learn'
    : cur.stage === 'compare' ? 'You mix these two up: compare'
    : shown ? 'Answer'
    : cur.pair ? 'Which of the two is this?'
    : "Who's calling?";
  document.querySelector('.player').hidden = cur.stage === 'compare';

  $('recInfo').dataset.tip = TIPS.recInfo;
  $('recInfo').textContent = `Recording ${Math.min(cur.recIdx, recs.length - 1) + 1} of ${recs.length} · ${r ? r.type : ''}`;
  $('otherRecBtn').disabled = recs.length < 2;
  $('recError').hidden = true;
  $('bar').hidden = false;

  // Hints
  const ha = $('hintArea');
  if (cur.stage === 'compare') {
    ha.innerHTML = '<p class="small muted" style="margin:0 0 6px">Listen to both, then test yourself on which is which.</p>'
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
    ha.innerHTML = `<div class="hint-text">${cur.pair ? 'Which of these two?' : 'Which one is it?'}</div>
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
    $('revealMeta').innerHTML = `<span class="chip" data-tip="${esc(TIPS.family)}">${esc(sp.family)}</span><span class="chip" data-tip="${esc(tierTip(sp))}">${esc(sp.tier)}</span>${chip(L.status(S.learn, sp.id))}`;
    $('revealCredit').innerHTML = (r ? `Sound: ${credit(r)}<br>` : '') + (sp.photo ? `Photo: ${esc(sp.photo.attr)}` : '');
  }

  // Buttons
  const a = $('actions');
  if (cur.stage === 'intro') {
    a.innerHTML = '<button class="btn wide" data-act="introDone">Got it, next bird</button>';
  } else if (cur.stage === 'compare') {
    a.innerHTML = '<button class="btn wide" data-act="pairTest">Test me on these two</button>';
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
  $('skipBtn').hidden = cur.stage !== 'guess';
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
  const confused = L.confusedWith(S.learn, sp.id).map((c) => byId[c.id]).filter(Boolean);
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
  const event = L.answer(S.learn, species, cur.id, { correct, hinted, pair: cur.pair || null });
  const record = bumpStreak(correct);
  save();
  if (record && !(S.streak.best % 5)) toast(`🔥 New record: ${S.streak.best} right in a row!`);
  renderTop();
  if (event === 'mastered' || event === 'remembered') await celebrate(event, byId[cur.id]);
  else if (event === 'lost') toast(`${nm(byId[cur.id])} is back in learning`);
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
  } else if (act === 'pairTest') {
    stopAudio();
    cur.stage = 'guess';
    cur.hint = 1;
    cur.choices = shuffle([cur.id, cur.pair]);
    renderCard();
    playRec(currentRec(), $('playBtn'));
  } else if (act === 'next') {
    newCard();
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

$('otherRecBtn').addEventListener('click', () => {
  const n = activeRecs(cur.id).length;
  if (n < 2) return;
  stopAudio();
  cur.recIdx = (cur.recIdx + 1) % n;
  renderCard();
  playRec(currentRec(), $('playBtn'));
});

$('skipBtn').addEventListener('click', () => {
  L.skip(S.learn, cur.id);
  save();
  newCard();
});

// ---------- rate / flag ----------

let rateTarget = null; // { rec, after }

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

function setStars(xc, stars) {
  const p = (S.recs[xc] ||= {});
  p.stars = p.stars === stars ? undefined : stars; // tap the same star again to clear
  save();
}

function setFlag(xc, flag) {
  const p = (S.recs[xc] ||= {});
  p.flag = flag;
  save();
}

$('stars').addEventListener('click', (e) => {
  const b = e.target.closest('[data-star]');
  if (!b || !rateTarget) return;
  const stars = +b.dataset.star;
  setStars(recKey(rateTarget.rec), stars);
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
    toast('Flagged: using another recording');
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
    cur.recIdx = Math.min(cur.recIdx, activeRecs(cur.id).length - 1);
    renderCard();
  });
});

// ---------- celebration ----------

function celebrate(kind, sp) {
  return new Promise((resolve) => {
    const box = $('celebrate');
    const total = species.length;
    const mastered = L.summary(S.learn, species).mastered;
    box.className = 'celebrate ' + kind;
    $('celebrateBurst').textContent = kind === 'mastered' ? '🏆' : '🧠';
    $('celebrateTitle').textContent = kind === 'mastered' ? 'Mastered!' : 'Remembered!';
    $('celebrateName').textContent = nm(sp);
    $('celebrateSub').textContent = kind === 'mastered'
      ? `${mastered} of ${total} birds mastered`
      : 'Still know it by ear. It will come back later.';
    const inner = box.querySelector('.celebrate-box');
    inner.querySelectorAll('.confetti').forEach((c) => c.remove());
    const colours = ['#1f6b4a', '#5cc08d', '#f0b84a', '#c98a12', '#ef7a6c', '#7fb6e0'];
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
  renderAvatar();
  const s = L.summary(S.learn, species);
  const st = currentStreak();
  $('topSub').innerHTML = `<span data-tip="${esc(TIPS.area)}">${esc(area)}</span> · `
    + `<span data-tip="${esc(birdListTip('inPlay'))}">${s.inPlay} birds in play</span> · `
    + `<span data-tip="${esc(birdListTip('met'))}">${s.met} met</span> · `
    + `<span data-tip="${esc(birdListTip('mastered'))}">${s.mastered} mastered</span>`
    + (st ? ` · <span data-tip="${esc(`${TIPS.streak} Your record is ${streakState().best}.`)}">🔥 ${st}</span>` : '');
}

// ---------- birds view ----------

function renderBirds() {
  const q = $('search').value.trim().toLowerCase();
  const match = (sp) => !q || [...Object.values(sp.names), sp.sci, sp.listName, sp.family].some((v) => v.toLowerCase().includes(q));
  let html = '';
  for (const tier of TIER_ORDER) {
    const list = species.filter((sp) => sp.tier === tier && match(sp));
    if (!list.length) continue;
    html += `<div class="tier-head">${tier}<span>${list.length} birds</span></div>`;
    for (const sp of list) {
      html += `<div class="bird-row" data-bird="${sp.id}" role="button" tabindex="0">
        <img src="${esc(sp.photo?.url || '')}" alt="" loading="lazy">
        <div class="nm"><div>${esc(nm(sp))}</div><div class="small muted">${chip(L.status(S.learn, sp.id))} ${esc(sp.family)}</div></div>
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

function confusedHtml(id) {
  const list = L.confusedWith(S.learn, id).filter((c) => byId[c.id]).slice(0, 5);
  if (!list.length) return '';
  return `<h2 style="margin-top:14px"><span data-tip="${esc(TIPS.confused)}">Often confused with</span></h2>`
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
    <div class="reveal-meta"><span class="chip" data-tip="${esc(TIPS.family)}">${esc(sp.family)}</span><span class="chip" data-tip="${esc(tierTip(sp))}">${esc(sp.tier)}</span>${chip(L.status(S.learn, id))}</div>
    ${b && (b.right || b.wrong) ? `<p class="small muted" style="text-align:center">Right ${b.right} · Missed ${b.wrong}</p>` : ''}
    ${confusedHtml(id)}
    <h2 style="margin-top:14px">Recordings</h2>
    <p class="small muted">The two marked "In use" are the ones you study. Rate or flag to change them.</p>`;
  for (const r of calls[id] || []) {
    const pref = recPref(r);
    html += `<div class="rec-card ${isOff(r) ? 'off' : ''}">
      <div class="rc-top">
        <button class="mini-play" id="dp-${esc(recKey(r))}" data-dplay="${esc(recKey(r))}" aria-label="Play">${PLAY_SVG}</button>
        <div class="nm">${esc(r.type)} · ${r.secs ? `${r.secs}s ` : ''}${active.has(recKey(r)) ? `<span class="chip learning" data-tip="${esc(TIPS.inUse)}">In use</span>` : ''}
          ${pref.flag ? `<span class="chip">Flagged</span> <button class="link" data-unflag="${esc(recKey(r))}">Restore</button>` : ''}</div>
      </div>
      <div class="stars small" data-rate="${esc(recKey(r))}"></div>
      <div class="credit">${credit(r)}${r.loc ? '<br>' + esc(r.loc) : ''}</div>
      ${pref.flag ? '' : `<button class="link" data-flagrec="${esc(recKey(r))}">⚑ Not distinctive</button>`}
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
  if (f) { setFlag(f.dataset.flagrec, 'indistinct'); return openBird(id); }
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

function renderProgress() {
  const s = L.summary(S.learn, species);
  const days = Math.ceil((BIG_DAY - new Date()) / 864e5);
  const st = currentStreak();
  let html = days >= 0 ? `<div class="countdown">${days === 0 ? 'Big Bird Day is today!' : `${days} day${days === 1 ? '' : 's'} to Big Bird Day`}</div>` : '';
  html += `<div class="big-stats">
    <div class="stat" data-tip="${esc(birdListTip('mastered'))}"><b>${s.mastered}</b><span>mastered</span></div>
    <div class="stat" data-tip="${esc(birdListTip('met'))}"><b>${s.met}</b><span>met</span></div>
    <div class="stat" data-tip="${esc(birdListTip('inPlay'))}"><b>${s.inPlay}</b><span>in play</span></div>
    <div class="stat" data-tip="${esc(TIPS.accuracy)}"><b>${s.recentAccuracy == null ? '–' : Math.round(s.recentAccuracy * 100) + '%'}</b><span>last 20 right</span></div>
  </div>
  <div class="streak-line" data-tip="${esc(TIPS.streak)}">🔥 ${st} right in a row · record ${streakState().best}</div>`;
  for (const tier of TIER_ORDER) {
    const t = s.tiers[tier];
    if (!t) continue;
    const pct = (n) => (n / t.total) * 100;
    html += `<div class="panel">
      <div class="tier-head" style="margin:0"><span class="tier-name" data-tip="${esc(`${tier}: how common these birds are around ${area}. Beginner = the 40 most recorded birds, Easy = 41-100, Medium = 101-180, Hard = rarer.`)}">${tier}</span><span>${t.mastered} of ${t.total} mastered</span></div>
      <div class="tier-bar"><div class="m" style="width:${pct(t.mastered)}%"></div><div class="l" style="width:${pct(t.learning + t.new)}%"></div></div>
      <div class="legend"><span data-tip="${esc(TIPS.status.mastered)}">Mastered ${t.mastered}</span><span data-tip="${esc(TIPS.status.learning)}">Learning ${t.learning + t.new}</span><span data-tip="${esc(TIPS.status.locked)}">Not yet ${t.locked}</span></div>
    </div>`;
  }
  html += `<div class="panel">
    <h2>How birds are added</h2>
    <p class="muted small">You start with the 20 most common birds around ${esc(area)}. Each right answer moves a bird toward mastered (3 clean answers, or 6 with hints).
    When fewer than 8 birds are still being learned, the next 5 most common are added. Missed birds come back after a few cards; mastered birds come back less and less often.</p>
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

// ---------- settings ----------

function renderSettings() {
  $('nameSet').innerHTML = Object.entries(nameSets).map(([k, v]) =>
    `<option value="${k}" ${k === S.prefs.nameSet ? 'selected' : ''}>${esc(v)}</option>`).join('');
  $('autoplay').checked = S.prefs.autoplay;
  $('intros').checked = S.prefs.intros;
  $('levelSel').innerHTML = Object.entries(LEVELS).map(([k, v]) =>
    `<option value="${k}" ${k === (S.prefs.level || 'some') ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
  $('areaSel').innerHTML = areaTree().map(({ a, depth }) =>
    `<option value="${a.id}" ${a.id === currentAreaId() ? 'selected' : ''}>${'\u00a0\u00a0\u00a0'.repeat(depth)}${esc(a.name)}${a.near && !birdCount(a) ? '' : ` (${birdCount(a)} birds)`}</option>`).join('');
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

$('areaSel').addEventListener('change', async (e) => {
  if (await chooseArea(e.target.value)) {
    cur = null;
    toast(`Region: ${area}`);
  }
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
  const { latitude: lat, longitude: lng } = pos.coords;
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

function tierFor(rank) {
  return rank <= 40 ? 'Beginner' : rank <= 100 ? 'Easy' : rank <= 180 ? 'Medium' : 'Hard';
}

// Rebuild the study list for the chosen area: its birds, ranked and tiered for that area.
function applyArea() {
  let a = areaById(currentAreaId());
  if (!a || !birdCount(a)) a = areaById(DEFAULT_AREA); // e.g. Near me before the location is known
  area = a.name;
  areaTotal = a.totalSpecies;
  species = allSpecies
    .filter((b) => a.ranks[b.id] != null)
    .map((b) => ({ ...b, rank: a.ranks[b.id], tier: tierFor(a.ranks[b.id]) }))
    .sort((x, y) => x.rank - y.rank);
  byId = { ...Object.fromEntries(allSpecies.map((b) => [b.id, b])), ...Object.fromEntries(species.map((b) => [b.id, b])) };
}

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

// Keyboard (on a computer): space play, h hint, r reveal, 1 missed, 2 got, n next.
document.addEventListener('keydown', (e) => {
  if (!$('view-study').classList.contains('active') || e.target.matches('input, textarea, select')) return;
  if (!$('rateSheet').hidden || !$('birdSheet').hidden) return;
  const k = e.key.toLowerCase();
  const act = { h: 'hint', r: 'reveal', 1: 'missed', 2: 'got', n: 'next' }[k];
  if (k === ' ') { e.preventDefault(); $('playBtn').click(); }
  else if (k === 'o') $('otherRecBtn').click();
  else if (act) {
    const b = $('actions').querySelector(`[data-act="${act}"]`) ||
      (k === 'n' || k === '2' ? $('actions').querySelector('[data-act="introDone"], [data-act="next"]') : null);
    if (b && !b.disabled) b.click();
  }
});

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

// ---------- survey (experience + area) ----------

const LEVELS = {
  new: { label: 'New to bird calls', desc: 'Start with the 10 commonest birds. Each new bird is introduced before you are tested on it.', pool: 10, intros: true },
  some: { label: 'I know a few calls', desc: 'Start with the 20 commonest birds, with an introduction for each new one.', pool: 20, intros: true },
  good: { label: 'I know most common calls', desc: 'Start with the 40 commonest birds, with introductions.', pool: 40, intros: true },
  expert: { label: 'Experienced', desc: 'All birds in play from the start, no introductions: straight to testing.', pool: 0, intros: false },
};

const overlayOpen = () => !$('welcome').hidden || !$('survey').hidden;
const needsSurvey = () => !S.prefs.surveyDone;
let surveyPick = { level: 'some', area: DEFAULT_AREA };

function openSurvey() {
  surveyPick = { level: S.prefs.level || 'some', area: currentAreaId() };
  renderSurvey();
  $('survey').hidden = false;
}

function renderSurvey() {
  for (let a = areaById(surveyPick.area); a; a = areaById(a.parent)) if (a.parent) openAreas.add(a.parent);
  $('levelOpts').innerHTML = Object.entries(LEVELS).map(([k, v]) =>
    `<button class="opt ${k === surveyPick.level ? 'on' : ''}" data-level="${k}"><b>${esc(v.label)}</b><span>${esc(v.desc)}</span></button>`).join('');
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
  return `<div class="area-row" style="margin-left:${depth * 16}px">
    ${kids && !showPath ? `<button class="area-toggle" data-toggle="${a.id}" aria-label="${openAreas.has(a.id) ? 'Close' : 'Open'} ${esc(a.name)}">${openAreas.has(a.id) ? '▾' : '▸'}</button>` : '<span class="area-toggle-space"></span>'}
    <button class="opt area-opt ${a.id === surveyPick.area ? 'on' : ''}" data-area="${a.id}">
      <b>${esc(showPath ? areaPath(a) : a.name)}</b><span>${esc(sub)}</span></button>
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
  L.ensurePool(S.learn, species, { all: !L0.pool });
}

$('survey').addEventListener('click', (e) => {
  const lv = e.target.closest('[data-level]');
  const ar = e.target.closest('[data-area]');
  const tg = e.target.closest('[data-toggle]');
  if (tg) {
    if (openAreas.has(tg.dataset.toggle)) openAreas.delete(tg.dataset.toggle);
    else openAreas.add(tg.dataset.toggle);
    return renderAreaPicker();
  }
  if (lv) surveyPick.level = lv.dataset.level;
  if (ar) surveyPick.area = ar.dataset.area;
  if (lv) renderSurvey();
  if (ar) renderAreaPicker();
  if (e.target.id === 'surveyDone') finishSurvey();
});

async function finishSurvey() {
  {
    $('surveyDone').disabled = true;
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
  try {
    const [sp, cl, ar] = await Promise.all([
      fetch('data/species.json').then((r) => r.json()),
      fetch('data/calls.json').then((r) => r.json()),
      fetch('data/areas.json').then((r) => r.json()),
    ]);
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
    syncNow({ firstSignIn: !!back });
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
