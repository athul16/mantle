-- Retention and delete on request (docs/02-security-and-integrity.md, Compliance).
--
-- Additive only: one check constraint, one index and new functions. Nothing is
-- dropped or rewritten.
--
-- 1. organizations.settings->'retention_days': how long candidate data is kept,
--    a whole number of days from 30 to 730. Missing means the default, 180.
--    private.retention_days(org) reads it; public.set_retention_days(org, days)
--    lets an org admin change it (merged into settings, audited).
-- 2. private.purge_candidate(invite_id): deletes everything about one candidate:
--    the invite (email and name), its secrets, the attempt and its secrets,
--    step responses, action and integrity events, media rows, flags and notes.
--    It writes one audit_log row that names only the invite id, and returns the
--    proctoring storage paths for the server to delete (SQL cannot delete
--    storage objects; the Storage API does).
--    The invite row is deleted rather than anonymised: it holds the email and
--    name, and keeping an empty shell would leave a blank row in the pipeline
--    and on the report. The audit row keeps the fact that it existed.
-- 3. public.delete_candidate_data(invite_id): delete on request, org admins only.
-- 4. public.list_candidates_past_retention(now, limit) and
--    public.purge_candidate_for_retention(invite_id, now): what the daily cron
--    calls with the service role. The clock runs from the candidate's last
--    activity: the latest of invite expiry, attempt deadline and submission.

-- ---------------------------------------------------------------------------
-- 1. Retention setting
-- ---------------------------------------------------------------------------

alter table public.organizations
  add constraint organizations_retention_days_range check (
    not (settings ? 'retention_days')
    or (
      jsonb_typeof(settings -> 'retention_days') = 'number'
      and case when jsonb_typeof(settings -> 'retention_days') = 'number'
               then (settings ->> 'retention_days')::numeric between 30 and 730
                and (settings ->> 'retention_days')::numeric = trunc((settings ->> 'retention_days')::numeric)
               else false end
    )
  );

create function private.retention_days(target_org uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce((o.settings ->> 'retention_days')::int, 180)
  from public.organizations o
  where o.id = target_org;
$$;
revoke all on function private.retention_days(uuid) from public, anon;
grant execute on function private.retention_days(uuid) to authenticated, service_role;

create function public.set_retention_days(p_org_id uuid, p_days int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or not private.has_org_role(p_org_id, array['admin']) then
    raise exception 'only an admin can change retention' using errcode = '42501';
  end if;
  if p_days is null or p_days < 30 or p_days > 730 then
    raise exception 'retention must be 30 to 730 days' using errcode = '22023';
  end if;

  update public.organizations
  set settings = settings || jsonb_build_object('retention_days', p_days)
  where id = p_org_id;

  insert into public.audit_log (org_id, actor_id, action, target)
  values (p_org_id, (select auth.uid()), 'changed_retention', p_days::text || ' days');

  return p_days;
end;
$$;
revoke all on function public.set_retention_days(uuid, int) from public, anon;
grant execute on function public.set_retention_days(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Purge one candidate
-- ---------------------------------------------------------------------------

create function private.purge_candidate(p_invite_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_attempt uuid;
  v_actor   uuid := (select auth.uid());
  v_paths   text[];
begin
  select i.org_id into v_org from public.invites i where i.id = p_invite_id for update;
  if v_org is null then
    raise exception 'no such invite' using errcode = 'P0002';
  end if;
  select a.id into v_attempt from public.attempts a where a.invite_id = p_invite_id and a.org_id = v_org;

  if v_attempt is not null then
    -- Media rows plus anything stored under the attempt's folder (a snapshot
    -- whose row was never written still gets removed).
    select coalesce(array_agg(distinct p), '{}') into v_paths
    from (
      select m.storage_path as p from public.media m where m.attempt_id = v_attempt and m.org_id = v_org
      union
      select o.name from storage.objects o
      where o.bucket_id = 'proctoring' and o.name like v_org::text || '/' || v_attempt::text || '/%'
    ) s;

    delete from public.flags            where attempt_id = v_attempt and org_id = v_org;
    delete from public.notes            where attempt_id = v_attempt and org_id = v_org;
    delete from public.media            where attempt_id = v_attempt and org_id = v_org;
    delete from public.integrity_events where attempt_id = v_attempt and org_id = v_org;
    delete from public.action_events    where attempt_id = v_attempt and org_id = v_org;
    delete from public.step_responses   where attempt_id = v_attempt and org_id = v_org;
    delete from public.attempt_secrets  where attempt_id = v_attempt and org_id = v_org;
    delete from public.attempts         where id = v_attempt and org_id = v_org;
  end if;

  delete from public.invite_secrets where invite_id = p_invite_id and org_id = v_org;
  delete from public.invites        where id = p_invite_id and org_id = v_org;

  -- No email or name: only the invite id, and who did it (null for the cron).
  insert into public.audit_log (org_id, actor_id, action, target)
  values (
    v_org,
    v_actor,
    case when v_actor is null then 'retention_purge' else 'deleted_candidate_data' end,
    'invite:' || p_invite_id::text
  );

  return coalesce(v_paths, '{}');
end;
$$;
revoke all on function private.purge_candidate(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Delete on request (org admins)
-- ---------------------------------------------------------------------------

create function public.delete_candidate_data(p_invite_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select i.org_id into v_org from public.invites i where i.id = p_invite_id;
  -- Same error for a missing invite and another org's, so nothing leaks.
  if v_org is null or not private.has_org_role(v_org, array['admin']) then
    raise exception 'not allowed to delete this candidate' using errcode = '42501';
  end if;
  return private.purge_candidate(p_invite_id);
end;
$$;
revoke all on function public.delete_candidate_data(uuid) from public, anon;
grant execute on function public.delete_candidate_data(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Daily purge (service role only)
-- ---------------------------------------------------------------------------

create index invites_expires_at_idx on public.invites(expires_at);

create function public.list_candidates_past_retention(p_now timestamptz default now(), p_limit int default 200)
returns table (invite_id uuid, org_id uuid, retained_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.org_id,
         greatest(i.created_at, i.expires_at, a.deadline_at, a.submitted_at)
           + make_interval(days => private.retention_days(i.org_id)) as retained_until
  from public.invites i
  left join public.attempts a on a.invite_id = i.id and a.org_id = i.org_id
  where greatest(i.created_at, i.expires_at, a.deadline_at, a.submitted_at)
          + make_interval(days => private.retention_days(i.org_id)) < p_now
  order by retained_until
  limit greatest(coalesce(p_limit, 200), 0);
$$;
revoke all on function public.list_candidates_past_retention(timestamptz, int) from public, anon, authenticated;
grant execute on function public.list_candidates_past_retention(timestamptz, int) to service_role;

create function public.purge_candidate_for_retention(p_invite_id uuid, p_now timestamptz default now())
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Re-checked here so the service role can't purge a candidate early by mistake.
  if not exists (
    select 1 from public.list_candidates_past_retention(p_now, null) l where l.invite_id = p_invite_id
  ) then
    raise exception 'candidate is still inside the retention period' using errcode = '22023';
  end if;
  return private.purge_candidate(p_invite_id);
end;
$$;
revoke all on function public.purge_candidate_for_retention(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.purge_candidate_for_retention(uuid, timestamptz) to service_role;
