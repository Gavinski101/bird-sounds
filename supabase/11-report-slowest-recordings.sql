-- Saved in the Supabase SQL editor as "11 - Report: slowest recordings". Read-only.
-- App v1.7.3. For each recording: how often people had to wait for it to start after its card
-- came up (or after pressing play), how long on average, and how big the file is. Only
-- accounts that share. What to do with it: replace recordings that are slow for several people
-- (often long, big files) with a shorter one of the same bird (scripts/build_calls.py picks).
select r.key as recording,
       case when r.key ~ '^[0-9]+$' then 'https://xeno-canto.org/' || r.key else r.key end as link,
       sum(coalesce((r.value->>'pw')::int, 0)) as played_straight_away,
       sum(coalesce((r.value->>'lw')::int, 0)) as had_to_wait,
       round(sum(coalesce((r.value->>'lt')::numeric, 0)) / nullif(sum(coalesce((r.value->>'lw')::int, 0)), 0) / 1000, 1) as avg_wait_seconds,
       round(max((r.value->>'sz')::numeric) / 1048576, 1) as size_mb,
       count(*) filter (where coalesce((r.value->>'lw')::int, 0) > 0) as people_who_waited
from (select * from public.progress where data->'prefs'->'privacy'->>'share' = 'true') p -- only accounts that chose to share
cross join lateral jsonb_each(case when jsonb_typeof(p.data->'recs') = 'object' then p.data->'recs' else '{}'::jsonb end) r
where jsonb_typeof(r.value) = 'object' and (r.value ? 'pw' or r.value ? 'lw')
group by r.key
having sum(coalesce((r.value->>'lw')::int, 0)) > 0
order by people_who_waited desc, avg_wait_seconds desc nulls last
limit 50;
