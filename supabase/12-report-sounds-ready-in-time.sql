-- Saved in the Supabase SQL editor as "12 - Report: sounds ready in time". Read-only.
-- How often a card's sound started straight away (downloaded or loaded ahead) versus how often
-- people waited, and the average wait, on phones and on computers. Counted from app v1.9.5 on
-- (earlier totals mixed both and included a timing flaw fixed in v1.8.6). Only accounts that
-- share. What to do with it: under about 90% straight away means more loading ahead is needed.
with r as (
  select p.user_id, x.value as v
  from (select * from public.progress where data->'prefs'->'privacy'->>'share' = 'true') p -- only accounts that chose to share
  cross join lateral jsonb_each(case when jsonb_typeof(p.data->'recs') = 'object' then p.data->'recs' else '{}'::jsonb end) x
  where jsonb_typeof(x.value) = 'object'
), d as (
  select 'phone' as device, user_id, coalesce((v->>'mp')::int, 0) as ready, coalesce((v->>'mw')::int, 0) as waited, coalesce((v->>'mt')::numeric, 0) as ms from r
  union all
  select 'computer', user_id, coalesce((v->>'dp')::int, 0), coalesce((v->>'dw')::int, 0), coalesce((v->>'dt')::numeric, 0) from r
)
select device,
       count(distinct user_id) filter (where ready + waited > 0) as people,
       sum(ready) as started_straight_away,
       sum(waited) as had_to_wait,
       round(100.0 * sum(ready) / nullif(sum(ready + waited), 0), 1) as percent_straight_away,
       round(sum(ms) / nullif(sum(waited), 0) / 1000, 1) as avg_wait_seconds
from d
group by device
order by device desc;
