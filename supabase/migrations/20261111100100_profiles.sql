-- public.profiles: the few auth.users fields the app shows about teammates
-- (decision D13 / Q5). Before this, the team page and the candidate report
-- looked teammates' emails up one by one with the service key
-- (auth.admin.getUserById). Now they read profiles with the user's own client
-- and RLS decides.
--
-- One row per auth user, kept in sync by a trigger on auth.users. Not
-- tenant-owned (a person can belong to several companies), so no org_id: a
-- company user reads their own profile and the profiles of people who share a
-- company with them, nothing else. Nobody writes it except the trigger.
--
-- The trigger must never block sign-up, invites or sign-in: any error inside it
-- is caught and logged as a warning, and the auth.users write goes ahead. A
-- missing profile only shows as "(unknown)" in the app.

create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text,
  -- Set when the user was invited by email (auth.users.invited_at).
  invited_at        timestamptz,
  -- The first time they signed in; null while an invite is still pending.
  first_sign_in_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Read only, through RLS. Writes come from the trigger (security definer) or the service role.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- True if the signed-in user and target_user are members of at least one same org.
-- SECURITY DEFINER so it reads memberships without recursing into its RLS.
create function private.shares_org_with(target_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.org_id = mine.org_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = target_user
  );
$$;

revoke execute on function private.shares_org_with(uuid) from public, anon;
grant execute on function private.shares_org_with(uuid) to authenticated;

create policy "read own and teammates' profiles" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_org_with(id));

-- Sync from auth.users. Runs as the owner, so the auth service's role needs no
-- rights on public.profiles. Skips the write when nothing it copies changed, so
-- routine updates to auth.users (token refreshes) cost nothing.
create function private.sync_profile()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  begin
    insert into public.profiles (id, email, invited_at, first_sign_in_at)
    values (new.id, new.email, new.invited_at, new.last_sign_in_at)
    on conflict (id) do update
      set email            = excluded.email,
          invited_at       = excluded.invited_at,
          first_sign_in_at = coalesce(public.profiles.first_sign_in_at, excluded.first_sign_in_at),
          updated_at       = now()
      where public.profiles.email is distinct from excluded.email
         or public.profiles.invited_at is distinct from excluded.invited_at
         or (public.profiles.first_sign_in_at is null and excluded.first_sign_in_at is not null);
  exception when others then
    -- Never block sign-up or sign-in over a profile row.
    raise warning 'sync_profile failed for user %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return null;
end;
$$;

revoke execute on function private.sync_profile() from public, anon, authenticated;

create trigger sync_profile
  after insert or update of email, invited_at, last_sign_in_at on auth.users
  for each row execute function private.sync_profile();

-- Existing users.
insert into public.profiles (id, email, invited_at, first_sign_in_at)
select id, email, invited_at, last_sign_in_at from auth.users
on conflict (id) do nothing;
