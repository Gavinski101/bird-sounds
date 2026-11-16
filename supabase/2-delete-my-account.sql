-- Saved in the Supabase SQL editor as "2 - Delete my account function". Safe to run more than once.

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
