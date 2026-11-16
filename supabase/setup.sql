-- Bird Sounds: progress sync table.
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run more than once.

create table if not exists public.progress (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Each signed-in person can only read and write their own row.
alter table public.progress enable row level security;

drop policy if exists "read own progress" on public.progress;
drop policy if exists "insert own progress" on public.progress;
drop policy if exists "update own progress" on public.progress;

create policy "read own progress" on public.progress
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "insert own progress" on public.progress
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "update own progress" on public.progress
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- New tables are not exposed automatically in this project, so grant access explicitly.
-- Signed-out visitors (anon) get nothing.
revoke all on public.progress from anon;
grant select, insert, update on public.progress to authenticated;

-- Let a signed-in person delete their own account. Their progress row goes with it
-- (on delete cascade above). Runs with elevated rights, but only ever on auth.uid().
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.users where id = (select auth.uid());
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;


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
