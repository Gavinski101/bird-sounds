-- Read-only usage reports for the project owner. Run each one in the Supabase SQL editor
-- and save it as a snippet under the name in its heading.
-- They only count signed-in users (people without an account never send anything) and show
-- no emails or names. Bird names come from public.bird_names (run bird_names.sql first).
-- The per-day log (learn.days) and cards-to-master (firstM) exist from v1.3.2, so older
-- activity isn't in the weekly reports.

-- 5 - Report: active users per week
select date_trunc('week', d.key::date)::date as week_starting,
       count(distinct p.user_id) as active_users,
       sum((d.value->>'a')::int) as answers
from public.progress p
cross join lateral jsonb_each(case when jsonb_typeof(p.data->'learn'->'days') = 'object' then p.data->'learn'->'days' else '{}'::jsonb end) d
group by 1
order by 1 desc;

-- 6 - Report: birds mastered over time
-- For each week: the average and highest number of birds mastered by the users active that week.
select week_starting,
       count(*) as active_users,
       round(avg(mastered), 1) as avg_mastered,
       max(mastered) as most_mastered
from (
  select p.user_id, date_trunc('week', d.key::date)::date as week_starting, max((d.value->>'m')::int) as mastered
  from public.progress p
  cross join lateral jsonb_each(case when jsonb_typeof(p.data->'learn'->'days') = 'object' then p.data->'learn'->'days' else '{}'::jsonb end) d
  group by 1, 2
) w
group by 1
order by 1 desc;

-- 7 - Report: where people stall
-- Birds missed most across all users (5+ answers in total), and how many cards they took to master.
select coalesce(n.name, b.key) as bird,
       count(*) as users,
       sum((b.value->>'right')::int) as right_answers,
       sum((b.value->>'wrong')::int) as missed,
       round(100.0 * sum((b.value->>'wrong')::int) / sum((b.value->>'right')::int + (b.value->>'wrong')::int)) as missed_pct,
       round(avg((b.value->>'firstM')::int), 1) as avg_cards_to_master
from public.progress p
cross join lateral jsonb_each(case when jsonb_typeof(p.data->'learn'->'birds') = 'object' then p.data->'learn'->'birds' else '{}'::jsonb end) b
left join public.bird_names n on n.id = b.key
group by 1
having sum((b.value->>'right')::int + (b.value->>'wrong')::int) >= 5
order by missed_pct desc, missed desc
limit 40;

-- 8 - Report: mix-ups across everyone
-- "heard" = the bird that was playing, "thought_it_was" = the wrong pick.
select coalesce(h.name, m.key) as heard,
       coalesce(t.name, x.key) as thought_it_was,
       sum(x.value::int) as times,
       count(*) as users
from public.progress p
cross join lateral jsonb_each(case when jsonb_typeof(p.data->'learn'->'mix') = 'object' then p.data->'learn'->'mix' else '{}'::jsonb end) m
cross join lateral jsonb_each_text(case when jsonb_typeof(m.value) = 'object' then m.value else '{}'::jsonb end) x
left join public.bird_names h on h.id = m.key
left join public.bird_names t on t.id = x.key
group by 1, 2
order by times desc
limit 40;
