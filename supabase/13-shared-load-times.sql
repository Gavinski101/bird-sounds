-- Saved in the Supabase SQL editor as "13 - Shared load times". Safe to run more than once.

-- App v1.7.9: the shared recording scores also total how long recordings took to start
-- (recs[key].pw = started straight away, .lw = had to wait, .sz = file size in bytes), so the
-- app can play a quicker recording first when several people waited for one. Only accounts
-- that share. The result columns changed, so the function is dropped and made again.
-- (Snippets 3 and 10 hold the same definition now, so running them again keeps it.)

drop function if exists public.rec_scores();
create function public.rec_scores()
returns table (rec text, flags int, raters int, avg_stars numeric, right_answers int, wrong_answers int,
               plays int, waits int, wait_people int, size_kb int)
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
         (max(case when r.value->>'sz' ~ '^[0-9]+$' then (r.value->>'sz')::bigint end) / 1024)::int
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
