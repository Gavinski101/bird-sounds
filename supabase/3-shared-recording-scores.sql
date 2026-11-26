-- Saved in the Supabase SQL editor as "3 - Shared recording scores". Safe to run more than once.

-- Shared recording verdicts (v1.2.9). Totals of everyone's flags and star ratings per
-- recording, read from the "recs" part of each saved progress row. Only totals come out,
-- never who voted, so signed-out visitors may read them too. One row per account means
-- one vote per account.
-- v1.4.6: also how often each recording led to a right or wrong answer (recs[xc].ok / .no:
-- the recording playing when the person answered). The result columns changed, so the old
-- function is dropped first.
-- v1.7.9: also load times (plays, waits, people who waited, file size; snippet 13).
drop function if exists public.rec_scores();
create function public.rec_scores()
returns table (rec text, flags int, raters int, avg_stars numeric, right_answers int, wrong_answers int,
               plays int, waits int, wait_people int, size_kb int, play_people int, listen_secs int, listens int)
language sql
stable
security definer
set search_path = ''
as $$
  -- fb = flags and star ratings count: everyone who saved privacy version 5+ (app v2.0.5: they
  -- are given on purpose) or who shares. sh = everything else: only accounts that share.
  with p as (
    select data,
           coalesce(data->'prefs'->'privacy'->>'share' = 'true', false) as sh,
           coalesce(data->'prefs'->'privacy'->>'share' = 'true', false)
             or coalesce(data->'prefs'->'privacy'->>'v', '') ~ '^([5-9]|[1-9][0-9]+)$' as fb
    from public.progress
  )
  select r.key,
         (count(*) filter (where p.fb and coalesce(r.value->>'flag', '') <> ''))::int,
         (count(*) filter (where p.fb and r.value->>'stars' ~ '^[1-5]$'))::int,
         round(avg(case when p.fb and r.value->>'stars' ~ '^[1-5]$' then (r.value->>'stars')::numeric end), 2),
         coalesce(sum(case when p.sh and r.value->>'ok' ~ '^[0-9]+$' then (r.value->>'ok')::int end), 0)::int,
         coalesce(sum(case when p.sh and r.value->>'no' ~ '^[0-9]+$' then (r.value->>'no')::int end), 0)::int,
         (coalesce(sum(case when p.sh and r.value->>'pw' ~ '^[0-9]+$' then (r.value->>'pw')::int end), 0)
          + coalesce(sum(case when p.sh and r.value->>'lw' ~ '^[0-9]+$' then (r.value->>'lw')::int end), 0))::int,
         coalesce(sum(case when p.sh and r.value->>'lw' ~ '^[0-9]+$' then (r.value->>'lw')::int end), 0)::int,
         (count(*) filter (where p.sh and r.value->>'lw' ~ '^[1-9][0-9]*$'))::int,
         (max(case when p.sh and r.value->>'sz' ~ '^[0-9]+$' then (r.value->>'sz')::bigint end) / 1024)::int,
         (count(*) filter (where p.sh and (r.value->>'pw' ~ '^[1-9][0-9]*$' or r.value->>'lw' ~ '^[1-9][0-9]*$')))::int,
         coalesce(sum(case when p.sh and r.value->>'ls' ~ '^[0-9]+$' then (r.value->>'ls')::int end), 0)::int,
         coalesce(sum(case when p.sh and r.value->>'lc' ~ '^[0-9]+$' then (r.value->>'lc')::int end), 0)::int
  from p
  cross join lateral jsonb_each(case when jsonb_typeof(p.data->'recs') = 'object' then p.data->'recs' else '{}'::jsonb end) r
  where (p.sh or p.fb) and jsonb_typeof(r.value) = 'object'
  group by r.key
  having count(*) filter (where (p.fb and (coalesce(r.value->>'flag', '') <> '' or r.value->>'stars' ~ '^[1-5]$'))
                             or (p.sh and (r.value->>'ok' ~ '^[0-9]+$' or r.value->>'no' ~ '^[0-9]+$'
                                           or r.value->>'pw' ~ '^[0-9]+$' or r.value->>'lw' ~ '^[0-9]+$'
                                           or r.value->>'lc' ~ '^[0-9]+$'))) > 0;
$$;

revoke all on function public.rec_scores() from public;
grant execute on function public.rec_scores() to anon, authenticated;
