-- D9 (docs/decisions/2026-11-10-pilot-decisions.md, option B): per-invite
-- accommodations set by recruiters and admins, and a company contact email
-- shown to candidates.
--
-- 1. public.invite_accommodations: one row per invite that has (or had)
--    accommodations: extra time (+0, +25, +50 or +100 percent of the
--    assessment's time limit) and a waiver of the camera and/or the screen
--    share. Org members read it (the report shows it). Nobody writes it
--    directly: public.set_invite_accommodations() checks the caller is an admin
--    or recruiter of the invite's company, refuses once the candidate has
--    started (the deadline and the monitoring are fixed at start), and writes
--    an audit_log row, because a waiver is an exception to the assessment's
--    locked proctoring settings. No reason text is stored: why a candidate
--    needs an accommodation can be health information.
--    The extra time is applied on the server when the attempt starts
--    (attempts.deadline_at = started_at + limit * (100 + percent) / 100); the
--    browser timer only displays that deadline.
-- 2. organizations.settings->'contact_email': whom candidates should ask about
--    accommodations. Shown in the monitoring notice and on the verify page.
--    public.set_contact_email(org, email) lets an org admin set or clear it
--    (audited), like set_retention_days.

-- ---------------------------------------------------------------------------
-- 1. Accommodations
-- ---------------------------------------------------------------------------

create table public.invite_accommodations (
  invite_id           uuid primary key,
  org_id              uuid not null references public.organizations(id) on delete cascade,
  extra_time_percent  int not null default 0 check (extra_time_percent in (0, 25, 50, 100)),
  waive_camera        boolean not null default false,
  waive_screen        boolean not null default false,
  set_by              uuid references auth.users(id) on delete set null,
  set_at              timestamptz not null default now(),
  foreign key (invite_id, org_id) references public.invites(id, org_id) on delete cascade
);
create index invite_accommodations_org_idx on public.invite_accommodations(org_id);

alter table public.invite_accommodations enable row level security;

create policy "members read accommodations" on public.invite_accommodations
  for select to authenticated using (private.is_org_member(org_id));

-- Writes only through set_invite_accommodations().
revoke insert, update, delete, truncate on public.invite_accommodations from anon, authenticated;

create function public.set_invite_accommodations(
  p_invite_id uuid,
  p_extra_time_percent int,
  p_waive_camera boolean,
  p_waive_screen boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org    uuid;
  v_status text;
begin
  select i.org_id, i.status into v_org, v_status
  from public.invites i
  where i.id = p_invite_id
  for update;
  -- Same error for a missing invite and another org's, so nothing leaks.
  if v_org is null or not private.can_manage_org(v_org) then
    raise exception 'not allowed to change accommodations for this invite' using errcode = '42501';
  end if;
  if p_extra_time_percent is null or p_extra_time_percent not in (0, 25, 50, 100)
     or p_waive_camera is null or p_waive_screen is null then
    raise exception 'extra time must be 0, 25, 50 or 100 percent' using errcode = '22023';
  end if;
  if v_status not in ('invited', 'expired') or exists (
    select 1 from public.attempts a
    where a.invite_id = p_invite_id and a.org_id = v_org and a.started_at is not null
  ) then
    raise exception 'accommodations are fixed once the candidate has started' using errcode = '55000';
  end if;

  insert into public.invite_accommodations as ia
    (invite_id, org_id, extra_time_percent, waive_camera, waive_screen, set_by, set_at)
  values
    (p_invite_id, v_org, p_extra_time_percent, p_waive_camera, p_waive_screen, (select auth.uid()), now())
  on conflict (invite_id) do update
    set extra_time_percent = excluded.extra_time_percent,
        waive_camera       = excluded.waive_camera,
        waive_screen       = excluded.waive_screen,
        set_by             = excluded.set_by,
        set_at             = excluded.set_at;

  insert into public.audit_log (org_id, actor_id, action, target)
  values (
    v_org,
    (select auth.uid()),
    'set_accommodations',
    format('invite:%s extra_time=+%s%% waive_camera=%s waive_screen=%s',
           p_invite_id, p_extra_time_percent, p_waive_camera::text, p_waive_screen::text)
  );
end;
$$;
revoke all on function public.set_invite_accommodations(uuid, int, boolean, boolean) from public, anon;
grant execute on function public.set_invite_accommodations(uuid, int, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Company contact email
-- ---------------------------------------------------------------------------

alter table public.organizations
  add constraint organizations_contact_email_format check (
    not (settings ? 'contact_email')
    or (
      jsonb_typeof(settings -> 'contact_email') = 'string'
      and case when jsonb_typeof(settings -> 'contact_email') = 'string'
               then length(settings ->> 'contact_email') between 3 and 254
                and (settings ->> 'contact_email') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
               else false end
    )
  );

-- Null or blank clears it. Returns the stored value (trimmed, lower-cased).
create function public.set_contact_email(p_org_id uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if p_org_id is null or not private.has_org_role(p_org_id, array['admin']) then
    raise exception 'only an admin can change the contact email' using errcode = '42501';
  end if;
  if v_email is not null and (
    length(v_email) not between 3 and 254
    or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ) then
    raise exception 'enter a valid email address' using errcode = '22023';
  end if;

  update public.organizations
  set settings = case when v_email is null then settings - 'contact_email'
                      else settings || jsonb_build_object('contact_email', v_email) end
  where id = p_org_id;

  insert into public.audit_log (org_id, actor_id, action, target)
  values (p_org_id, (select auth.uid()), 'changed_contact_email', coalesce(v_email, '(cleared)'));

  return v_email;
end;
$$;
revoke all on function public.set_contact_email(uuid, text) from public, anon;
grant execute on function public.set_contact_email(uuid, text) to authenticated;
