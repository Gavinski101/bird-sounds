-- Saved in the Supabase SQL editor as "10 - Only count people who share". Safe to run more than once.

-- App v1.6.5: signed-in users choose whether their answers count, anonymously, in the shared
-- totals (prefs.privacy.share in their saved progress; off until they turn it on). This
-- recreates the three shared-totals functions so they only read accounts that chose to share.
-- (Snippets 3 and 9 were updated the same way, so running them again keeps the filter.
-- The reports 5-8 were updated too.)

drop function if exists public.rec_scores();
create function public.rec_scores()
returns table (rec text, flags int, raters int, avg_stars numeric, right_answers int, wrong_answers int,
               plays int, waits int, wait_people int, size_kb int, play_people int, listen_secs int, listens int)
language sql
stable
security definer
set search_path = ''
as $$
  select r.key,
         (count(*) filter (where coalesce(r.value->>'flag', '') <> ''))::int,
         (count(*) filter (where r.value->>'stars' ~ '^[1-5]$'))::int,
         round(avg(case when r.value->>'stars' ~ '^[1-5]$' then (r.value->>'stars')::numeric end), 2),
         coalesce(sum(case when r.value->>'ok' ~ '^[0-9]+$' then (r.value->>'ok')::int end), 0)::int,
         coalesce(sum(case when r.value->>'no' ~ '^[0-9]+$' then (r.value->>'no')::int end), 0)::int,
         (coalesce(sum(case when r.value->>'pw' ~ '^[0-9]+$' then (r.value->>'pw')::int end), 0)::int + coalesce(sum(case when r.value->>'lw' ~ '^[0-9]+$' then (r.value->>'lw')::int end), 0)::int)::int,
         coalesce(sum(case when r.value->>'lw' ~ '^[0-9]+$' then (r.value->>'lw')::int end), 0)::int,
         (count(*) filter (where r.value->>'lw' ~ '^[1-9][0-9]*$'))::int,
         (max(case when r.value->>'sz' ~ '^[0-9]+$' then (r.value->>'sz')::bigint end) / 1024)::int,
         (count(*) filter (where r.value->>'pw' ~ '^[1-9][0-9]*$' or r.value->>'lw' ~ '^[1-9][0-9]*$'))::int,
         coalesce(sum(case when r.value->>'ls' ~ '^[0-9]+$' then (r.value->>'ls')::int end), 0)::int,
         coalesce(sum(case when r.value->>'lc' ~ '^[0-9]+$' then (r.value->>'lc')::int end), 0)::int
  from (select * from public.progress where data->'prefs'->'privacy'->>'share' = 'true') p -- only accounts that chose to share (app v1.6.5)
  cross join lateral jsonb_each(p.data->'recs') r
  where jsonb_typeof(p.data->'recs') = 'object' and jsonb_typeof(r.value) = 'object'
  group by r.key
  having count(*) filter (where coalesce(r.value->>'flag', '') <> '' or r.value->>'stars' ~ '^[1-5]$'
                                or r.value->>'ok' ~ '^[0-9]+$' or r.value->>'no' ~ '^[0-9]+$'
                                or r.value->>'pw' ~ '^[0-9]+$' or r.value->>'lw' ~ '^[0-9]+$' or r.value->>'lc' ~ '^[0-9]+$') > 0;
$$;

revoke all on function public.rec_scores() from public;
grant execute on function public.rec_scores() to anon, authenticated;

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
    from (select * from public.progress where data->'prefs'->'privacy'->>'share' = 'true') p -- only accounts that chose to share (app v1.6.5)
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
    from (select * from public.progress where data->'prefs'->'privacy'->>'share' = 'true') p -- only accounts that chose to share (app v1.6.5)
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
