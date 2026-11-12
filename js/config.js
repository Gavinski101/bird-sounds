// Supabase project for signing in and syncing progress.
// The publishable key is meant to be public: row level security in supabase/setup.sql
// limits every signed-in person to their own progress row. Never put a secret key here.
export const SUPABASE_URL = 'https://qeetmsapqnojsgnkmecx.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_fVymOiNU7iKVNQX_8kIWhQ_Bkbgs4vF';

// Set to true once Google is configured in Supabase (Authentication -> Sign In / Providers -> Google).
export const GOOGLE_ENABLED = false;
