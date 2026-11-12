// Email sign-in (6-digit code) and progress sync with Supabase, using its REST API directly.
// A code is used instead of a magic link because on iPhone a link opens in Safari,
// which does not share storage with the home-screen app.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const AUTH_KEY = 'bird-sounds-auth';

export const configured = !!(SUPABASE_URL && SUPABASE_KEY);

function loadAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch { return null; }
}

let auth = loadAuth();

function saveAuth(a) {
  auth = a;
  try {
    if (a) localStorage.setItem(AUTH_KEY, JSON.stringify(a));
    else localStorage.removeItem(AUTH_KEY);
  } catch { /* storage blocked */ }
}

export const signedIn = () => !!auth;
export const email = () => auth?.email || '';

async function call(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data?.msg || data?.message || data?.error_description || data?.error || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

function keepSession(d) {
  saveAuth({
    access: d.access_token,
    refresh: d.refresh_token,
    exp: Date.now() + (d.expires_in || 3600) * 1000,
    email: d.user?.email || auth?.email || '',
    uid: d.user?.id || auth?.uid,
  });
}

export async function sendCode(address) {
  await call('/auth/v1/otp', { method: 'POST', body: { email: address, create_user: true } });
}

export async function verifyCode(address, code) {
  const d = await call('/auth/v1/verify', { method: 'POST', body: { type: 'email', email: address, token: code } });
  keepSession(d);
}

async function token() {
  if (!auth) throw new Error('Not signed in');
  if (Date.now() < auth.exp - 60_000) return auth.access;
  try {
    const d = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: auth.refresh } });
    keepSession(d);
    return auth.access;
  } catch (e) {
    if (e.status === 400 || e.status === 401) saveAuth(null); // session revoked or expired
    throw e;
  }
}

export async function signOut() {
  try { await call('/auth/v1/logout', { method: 'POST', token: await token() }); } catch { /* sign out locally anyway */ }
  saveAuth(null);
}

// Returns { data, updated_at } or null if nothing saved yet.
export async function pull() {
  const rows = await call('/rest/v1/progress?select=data,updated_at', { token: await token() });
  return rows && rows.length ? rows[0] : null;
}

export async function push(data) {
  const updated_at = new Date().toISOString();
  await call('/rest/v1/progress?on_conflict=user_id', {
    method: 'POST',
    token: await token(),
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: { user_id: auth.uid, data, updated_at },
  });
  return updated_at;
}
