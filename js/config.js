// Supabase project for signing in and syncing progress.
// The publishable key is meant to be public: row level security in supabase/setup.sql
// limits every signed-in person to their own progress row. Never put a secret key here.
export const SUPABASE_URL = 'https://qeetmsapqnojsgnkmecx.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_fVymOiNU7iKVNQX_8kIWhQ_Bkbgs4vF';

// Set to true once Google is configured in Supabase (Authentication -> Sign In / Providers -> Google).
export const GOOGLE_ENABLED = true;

// SHA-256 of the (lowercased) sign-in emails that may see private regions such as
// "My practice list". Only the hash is published, never the address.
export const OWNER_HASHES = ['fc9bf8fc95018ad76620f923d10fb4c6397e8cc8a7b995e4c99cbfc916a2099d'];
