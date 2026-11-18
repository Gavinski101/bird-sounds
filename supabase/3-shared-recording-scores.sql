-- Saved in the Supabase SQL editor as "3 - Shared recording scores". Safe to run more than once.

-- Shared recording verdicts (v1.2.9). Totals of everyone's flags and star ratings per
-- recording, read from the "recs" part of each saved progress row. Only totals come out,
-- never who voted, so signed-out visitors may read them too. One row per account means
-- one vote per account.
-- v1.4.6: also how often each recording led to a right or wrong answer (recs[xc].ok / .no:
-- the recording playing when the person answered). The result columns changed, so the old
-- function is dropped first.
drop function if exists public.rec_scores();
create function public.rec_scores()
returns table (rec text, flags int, raters int, avg_stars numeric, right_answers int, wrong_answers int)
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
         coalesce(sum(case when r.value->>'no' ~ '^[0-9]+$' then (r.value->>'no')::int end), 0)::int
  from public.progress p
  cross join lateral jsonb_each(p.data->'recs') r
  where jsonb_typeof(p.data->'recs') = 'object' and jsonb_typeof(r.value) = 'object'
  group by r.key
  having count(*) filter (where coalesce(r.value->>'flag', '') <> '' or r.value->>'stars' ~ '^[1-5]$'
                                or r.value->>'ok' ~ '^[0-9]+$' or r.value->>'no' ~ '^[0-9]+$') > 0;
$$;

revoke all on function public.rec_scores() from public;
grant execute on function public.rec_scores() to anon, authenticated;
