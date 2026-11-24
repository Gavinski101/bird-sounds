-- Saved in the Supabase SQL editor as "6 - Report: birds mastered over time". Read-only.
-- Signed-in users only, no emails or names. Bird names from public.bird_names (4-bird-names.sql).
-- The per-day log starts with app v1.3.2 (2026-11-16); earlier activity is not included.
-- For each week: the average and highest number of birds mastered by the users active that week.
select week_starting,
       count(*) as active_users,
       round(avg(mastered), 1) as avg_mastered,
       max(mastered) as most_mastered
from (
  select p.user_id, date_trunc('week', d.key::date)::date as week_starting, max((d.value->>'m')::int) as mastered
  from (select * from public.progress where data->'prefs'->'privacy'->>'share' = 'true') p -- only accounts that chose to share (app v1.6.5)
  cross join lateral jsonb_each(case when jsonb_typeof(p.data->'learn'->'days') = 'object' then p.data->'learn'->'days' else '{}'::jsonb end) d
  group by 1, 2
) w
group by 1
order by 1 desc;
