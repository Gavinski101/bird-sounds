-- Saved in the Supabase SQL editor as "7 - Report: where people stall". Read-only.
-- Signed-in users only, no emails or names. Bird names from public.bird_names (4-bird-names.sql).
-- Birds missed most across all users (5+ answers in total), and how many cards they took to master.
select coalesce(n.name, b.key) as bird,
       count(*) as users,
       sum((b.value->>'right')::int) as right_answers,
       sum((b.value->>'wrong')::int) as missed,
       round(100.0 * sum((b.value->>'wrong')::int) / sum((b.value->>'right')::int + (b.value->>'wrong')::int)) as missed_pct,
       round(avg((b.value->>'firstM')::int), 1) as avg_cards_to_master
from (select * from public.progress where data->'prefs'->'privacy'->>'share' = 'true') p -- only accounts that chose to share (app v1.6.5)
cross join lateral jsonb_each(case when jsonb_typeof(p.data->'learn'->'birds') = 'object' then p.data->'learn'->'birds' else '{}'::jsonb end) b
left join public.bird_names n on n.id = b.key
group by 1
having sum((b.value->>'right')::int + (b.value->>'wrong')::int) >= 5
order by missed_pct desc, missed desc
limit 40;
