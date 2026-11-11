-- Two retention clocks (docs/02-security-and-integrity.md, Compliance).
--
-- 20261110200000_retention.sql kept everything about a candidate for one
-- per-company period. This splits it in two:
--
-- * media: webcam snapshots and screen screenshots (media rows and their
--   storage objects). Default 90 days, 30 to 365.
-- * results: everything else about the candidate (the invite with email and
--   name, the attempt, answers, scores, integrity events, flags, notes and
--   votes, secrets). Default 365 days, 30 to 730. Deleted the same way as
--   before: the rows go, no anonymised shell is kept.
--
-- Media is never kept longer than results. Both clocks start at the same
-- moment as before: the latest of invite creation, invite expiry, attempt
-- deadline and submission.
--
-- 1. organizations.settings keys media_retention_days and results_retention_days
--    replace retention_days. An org that had set retention_days keeps that
--    number for results, and min(that, 90) for media. The check constraint
--    enforces both ranges and media <= results.
-- 2. private.media_retention_days(org) / private.results_retention_days(org)
--    replace private.retention_days(org). public.set_retention(org, media,
--    results) replaces public.set_retention_days(org, days).
-- 3. public.list_media_past_retention(now, limit) and
--    public.purge_media_for_retention(attempt_id, now): the daily cron's media
--    clock. The purge deletes the attempt's media rows and returns the storage
--    paths for the server to delete.
-- 4. public.list_candidates_past_retention now uses the results clock.

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------

alter table public.organizations drop constraint organizations_retention_days_range;

update public.organizations
set settings = (settings - 'retention_days') || jsonb_build_object(
  'results_retention_days', (settings ->> 'retention_days')::int,
  'media_retention_days', least((settings ->> 'retention_days')::int, 90)
)
where settings ? 'retention_days';

-- True when both keys, if present, are whole numbers in range and media is not
-- longer than results (missing keys count as their defaults: 90 and 365).
create function private.retention_settings_valid(s jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- CASE so the numeric casts only run once both values are known to be numbers.
  select
    case
      when s ? 'retention_days' then false
      when (s ? 'media_retention_days' and jsonb_typeof(s -> 'media_retention_days') <> 'number')
        or (s ? 'results_retention_days' and jsonb_typeof(s -> 'results_retention_days') <> 'number')
      then false
      else (
        with v as (
          select coalesce((s ->> 'media_retention_days')::numeric, 90)    as media,
                 coalesce((s ->> 'results_retention_days')::numeric, 365) as results
        )
        select media = trunc(media) and results = trunc(results)
           and media between 30 and 365
           and results between 30 and 730
           and media <= results
        from v
      )
    end;
$$;
revoke all on function private.retention_settings_valid(jsonb) from public, anon;

alter table public.organizations
  add constraint organizations_retention_range check (private.retention_settings_valid(settings));

create function private.media_retention_days(target_org uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce((o.settings ->> 'media_retention_days')::int, 90)
  from public.organizations o
  where o.id = target_org;
$$;
revoke all on function private.media_retention_days(uuid) from public, anon;
grant execute on function private.media_retention_days(uuid) to authenticated, service_role;

create function private.results_retention_days(target_org uuid)
returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce((o.settings ->> 'results_retention_days')::int, 365)
  from public.organizations o
  where o.id = target_org;
$$;
revoke all on function private.results_retention_days(uuid) from public, anon;
grant execute on function private.results_retention_days(uuid) to authenticated, service_role;

drop function public.set_retention_days(uuid, int);

create function public.set_retention(p_org_id uuid, p_media_days int, p_results_days int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or not private.has_org_role(p_org_id, array['admin']) then
    raise exception 'only an admin can change retention' using errcode = '42501';
  end if;
  if p_media_days is null or p_media_days < 30 or p_media_days > 365 then
    raise exception 'media retention must be 30 to 365 days' using errcode = '22023';
  end if;
  if p_results_days is null or p_results_days < 30 or p_results_days > 730 then
    raise exception 'results retention must be 30 to 730 days' using errcode = '22023';
  end if;
  if p_media_days > p_results_days then
    raise exception 'media cannot be kept longer than results' using errcode = '22023';
  end if;

  update public.organizations
  set settings = settings || jsonb_build_object('media_retention_days', p_media_days, 'results_retention_days', p_results_days)
  where id = p_org_id;

  insert into public.audit_log (org_id, actor_id, action, target)
  values (p_org_id, (select auth.uid()), 'changed_retention',
          'media ' || p_media_days::text || ' days, results ' || p_results_days::text || ' days');
end;
$$;
revoke all on function public.set_retention(uuid, int, int) from public, anon;
grant execute on function public.set_retention(uuid, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Results clock (before dropping private.retention_days, which it used)
-- ---------------------------------------------------------------------------

create or replace function public.list_candidates_past_retention(p_now timestamptz default now(), p_limit int default 200)
returns table (invite_id uuid, org_id uuid, retained_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.org_id,
         greatest(i.created_at, i.expires_at, a.deadline_at, a.submitted_at)
           + make_interval(days => private.results_retention_days(i.org_id)) as retained_until
  from public.invites i
  left join public.attempts a on a.invite_id = i.id and a.org_id = i.org_id
  where greatest(i.created_at, i.expires_at, a.deadline_at, a.submitted_at)
          + make_interval(days => private.results_retention_days(i.org_id)) < p_now
  order by retained_until
  limit greatest(coalesce(p_limit, 200), 0);
$$;

drop function private.retention_days(uuid);

-- ---------------------------------------------------------------------------
-- 3. Media clock (service role only)
-- ---------------------------------------------------------------------------

-- Attempts whose media period has passed and that still have media rows or
-- stored objects (a snapshot whose row was never written still counts).
create function public.list_media_past_retention(p_now timestamptz default now(), p_limit int default 200)
returns table (attempt_id uuid, org_id uuid, retained_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.org_id,
         greatest(i.created_at, i.expires_at, a.deadline_at, a.submitted_at)
           + make_interval(days => private.media_retention_days(a.org_id)) as retained_until
  from public.attempts a
  join public.invites i on i.id = a.invite_id and i.org_id = a.org_id
  where greatest(i.created_at, i.expires_at, a.deadline_at, a.submitted_at)
          + make_interval(days => private.media_retention_days(a.org_id)) < p_now
    and (
      exists (select 1 from public.media m where m.attempt_id = a.id and m.org_id = a.org_id)
      or exists (
        select 1 from storage.objects o
        where o.bucket_id = 'proctoring' and o.name like a.org_id::text || '/' || a.id::text || '/%'
      )
    )
  order by retained_until
  limit greatest(coalesce(p_limit, 200), 0);
$$;
revoke all on function public.list_media_past_retention(timestamptz, int) from public, anon, authenticated;
grant execute on function public.list_media_past_retention(timestamptz, int) to service_role;

create function public.purge_media_for_retention(p_attempt_id uuid, p_now timestamptz default now())
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_paths text[];
begin
  -- Re-checked here so the service role can't delete media early by mistake.
  select l.org_id into v_org
  from public.list_media_past_retention(p_now, null) l
  where l.attempt_id = p_attempt_id;
  if v_org is null then
    raise exception 'media is still inside the retention period' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct p), '{}') into v_paths
  from (
    select m.storage_path as p from public.media m where m.attempt_id = p_attempt_id and m.org_id = v_org
    union
    select o.name from storage.objects o
    where o.bucket_id = 'proctoring' and o.name like v_org::text || '/' || p_attempt_id::text || '/%'
  ) s;

  delete from public.media where attempt_id = p_attempt_id and org_id = v_org;

  insert into public.audit_log (org_id, actor_id, action, target)
  values (v_org, null, 'media_retention_purge', 'attempt:' || p_attempt_id::text);

  return v_paths;
end;
$$;
revoke all on function public.purge_media_for_retention(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.purge_media_for_retention(uuid, timestamptz) to service_role;
