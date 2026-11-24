-- Saved in the Supabase SQL editor as "14 - Slow recordings by share of people". Safe to run more than once.

-- App v1.8.2: the shared recording scores also count how many people played each recording
-- (play_people), so "slow" is judged by the share of the people who encountered it who had
-- to wait (1 of 1 counts fully, 2 of 5 less, 2 of 10 less again), not by a fixed number of
-- people. The result columns changed, so the function is dropped and made again.
-- (Snippets 3, 10 and 13 hold the same definition now, so running them again keeps it.)

drop function if exists public.rec_scores();
create function public.rec_scores()
returns table (rec text, flags int, raters int, avg_stars numeric, right_answers int, wrong_answers int,
               plays int, waits int, wait_people int, size_kb int, play_people int)
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
         (count(*) filter (where r.value->>'pw' ~ '^[1-9][0-9]*$' or r.value->>'lw' ~ '^[1-9][0-9]*$'))::int
  from (select * from public.progress where data->'prefs'->'privacy'->>'share' = 'true') p -- only accounts that chose to share (app v1.6.5)
  cross join lateral jsonb_each(p.data->'recs') r
  where jsonb_typeof(p.data->'recs') = 'object' and jsonb_typeof(r.value) = 'object'
  group by r.key
  having count(*) filter (where coalesce(r.value->>'flag', '') <> '' or r.value->>'stars' ~ '^[1-5]$'
                                or r.value->>'ok' ~ '^[0-9]+$' or r.value->>'no' ~ '^[0-9]+$'
                                or r.value->>'pw' ~ '^[0-9]+$' or r.value->>'lw' ~ '^[0-9]+$') > 0;
$$;

revoke all on function public.rec_scores() from public;
grant execute on function public.rec_scores() to anon, authenticated;
