-- Saved in the Supabase SQL editor as "5 - Report: active users per week". Read-only.
-- Signed-in users only, no emails or names. Bird names from public.bird_names (4-bird-names.sql).
-- The per-day log starts with app v1.3.2 (2026-11-16); earlier activity is not included.
select date_trunc('week', d.key::date)::date as week_starting,
       count(distinct p.user_id) as active_users,
       sum((d.value->>'a')::int) as answers
from (select * from public.progress where data->'prefs'->'privacy'->>'share' = 'true') p -- only accounts that chose to share (app v1.6.5)
cross join lateral jsonb_each(case when jsonb_typeof(p.data->'learn'->'days') = 'object' then p.data->'learn'->'days' else '{}'::jsonb end) d
group by 1
order by 1 desc;
