-- Saved in the Supabase SQL editor as "3 - Shared recording scores". Safe to run more than once.

-- Shared recording verdicts (v1.2.9). Totals of everyone's flags and star ratings per
-- recording, read from the "recs" part of each saved progress row. Only totals come out,
-- never who voted, so signed-out visitors may read them too. One row per account means
-- one vote per account.
create or replace function public.rec_scores()
returns table (rec text, flags int, raters int, avg_stars numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select r.key,
         (count(*) filter (where coalesce(r.value->>'flag', '') <> ''))::int,
         (count(*) filter (where r.value->>'stars' ~ '^[1-5]$'))::int,
         round(avg(case when r.value->>'stars' ~ '^[1-5]$' then (r.value->>'stars')::numeric end), 2)
  from public.progress p
  cross join lateral jsonb_each(p.data->'recs') r
  where jsonb_typeof(p.data->'recs') = 'object' and jsonb_typeof(r.value) = 'object'
  group by r.key
  having count(*) filter (where coalesce(r.value->>'flag', '') <> '' or r.value->>'stars' ~ '^[1-5]$') > 0;
$$;

revoke all on function public.rec_scores() from public;
grant execute on function public.rec_scores() to anon, authenticated;
