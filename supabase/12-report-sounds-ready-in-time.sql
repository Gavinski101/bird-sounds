-- Saved in the Supabase SQL editor as "12 - Report: sounds ready in time". Read-only.
-- App v1.7.3. Across everyone who shares: how often a card's sound started straight away
-- (downloaded ahead) versus how often people waited, and the average wait. What to do with it:
-- if under about 90% start straight away, the app should download more ahead (in parallel, or
-- more likely next birds).
with t as (
  select sum(coalesce((r.value->>'pw')::int, 0)) as ready,
         sum(coalesce((r.value->>'lw')::int, 0)) as waited,
         sum(coalesce((r.value->>'lt')::numeric, 0)) as wait_ms,
         count(distinct p.user_id) as people
  from (select * from public.progress where data->'prefs'->'privacy'->>'share' = 'true') p -- only accounts that chose to share
  cross join lateral jsonb_each(case when jsonb_typeof(p.data->'recs') = 'object' then p.data->'recs' else '{}'::jsonb end) r
  where jsonb_typeof(r.value) = 'object'
)
select people,
       ready as started_straight_away,
       waited as had_to_wait,
       round(100.0 * ready / nullif(ready + waited, 0), 1) as percent_straight_away,
       round(wait_ms / nullif(waited, 0) / 1000, 1) as avg_wait_seconds
from t;
