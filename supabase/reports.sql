-- Read-only usage reports for the project owner. Run in the Supabase SQL editor.
-- They only count signed-in users (people without an account are never sent anywhere),
-- and show no emails or names.

-- 4 - Usage summary
select
  (select count(*) from auth.users) as accounts,
  count(*) as accounts_with_progress,
  count(*) filter (where updated_at > now() - interval '7 days') as active_last_7_days,
  count(*) filter (where updated_at > now() - interval '30 days') as active_last_30_days,
  coalesce(sum((data->'learn'->>'answered')::int), 0) as total_answers,
  round(avg((data->'learn'->>'answered')::int)) as avg_answers_per_user
from public.progress;

-- 5 - Usage per user (anonymous)
select
  row_number() over (order by updated_at desc) as user_no,
  coalesce((data->'learn'->>'answered')::int, 0) as answers,
  jsonb_array_length(coalesce(data->'learn'->'pool', '[]'::jsonb)) as birds_in_play,
  coalesce((data->'streak'->>'best')::int, 0) as best_streak,
  data->'prefs'->>'area' as region,
  updated_at::date as last_used
from public.progress
order by updated_at desc;
