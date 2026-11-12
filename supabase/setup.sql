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
