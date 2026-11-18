-- Saved in the Supabase SQL editor as "9 - Shared bird difficulty". Safe to run more than once.

-- Shared difficulty (app v1.4.1; Other-recording presses count from v1.4.4). Totals across every account, read from the saved progress
-- rows; only totals come out, never who answered, so signed-out visitors may read them too.
-- The app moves a bird later for new learners when many people struggle with it, and keeps
-- pairs many people mix up apart. The thresholds live in the app (js/app.js, SHARED_*).

-- Per bird: how many people answered it 3+ times, and how many of those struggle with it:
-- missed it more often than they got it right, or pressed "Other recording" before answering
-- at least 3 times and at least once per 2 answers (app v1.4.4, learn.birds[id].oth).
create or replace function public.bird_stats()
returns table (bird text, users int, strugglers int)
language sql
stable
security definer
set search_path = ''
as $$
  with b as (
    select b.key as bird,
           case when b.value->>'right' ~ '^[0-9]+$' then (b.value->>'right')::int else 0 end as r,
           case when b.value->>'wrong' ~ '^[0-9]+$' then (b.value->>'wrong')::int else 0 end as w,
           case when b.value->>'oth' ~ '^[0-9]+$' then (b.value->>'oth')::int else 0 end as o
    from public.progress p
    cross join lateral jsonb_each(case when jsonb_typeof(p.data->'learn'->'birds') = 'object' then p.data->'learn'->'birds' else '{}'::jsonb end) b
    where jsonb_typeof(b.value) = 'object'
  )
  select bird, count(*)::int, (count(*) filter (where w > r or (o >= 3 and o * 2 >= r + w)))::int
  from b
  where r + w >= 3
  group by bird;
$$;

-- Per pair of birds (either way round): how many people mixed them up 2+ times, and how
-- often in total.
create or replace function public.mix_stats()
returns table (a text, b text, users int, times int)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select p.user_id,
           least(h.key, t.key) as a,
           greatest(h.key, t.key) as b,
           sum(case when t.value ~ '^[0-9]+$' then t.value::int else 0 end) as n
    from public.progress p
    cross join lateral jsonb_each(case when jsonb_typeof(p.data->'learn'->'mix') = 'object' then p.data->'learn'->'mix' else '{}'::jsonb end) h
    cross join lateral jsonb_each_text(case when jsonb_typeof(h.value) = 'object' then h.value else '{}'::jsonb end) t
    where h.key <> t.key
    group by 1, 2, 3
  )
  select a, b, (count(*) filter (where n >= 2))::int, sum(n)::int
  from m
  group by a, b
  having count(*) filter (where n >= 2) > 0;
$$;

revoke all on function public.bird_stats() from public;
revoke all on function public.mix_stats() from public;
grant execute on function public.bird_stats() to anon, authenticated;
grant execute on function public.mix_stats() to anon, authenticated;
