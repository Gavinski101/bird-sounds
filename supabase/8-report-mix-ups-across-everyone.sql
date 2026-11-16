-- Saved in the Supabase SQL editor as "8 - Report: mix-ups across everyone". Read-only.
-- Signed-in users only, no emails or names. Bird names from public.bird_names (4-bird-names.sql).
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
