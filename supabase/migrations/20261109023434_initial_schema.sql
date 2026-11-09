-- Initial schema. See docs/06-assessment-engine.md (data model) and
-- docs/03-roles-and-permissions.md (who can do what).
--
-- Rules enforced here:
--   * Every tenant-owned table has org_id and RLS.
--   * Child rows of an attempt repeat org_id, and a composite FK guarantees it
--     matches the attempt's org_id, so policies never depend on joins.
--   * Candidates have no Supabase auth user. Their routes run on the server with
--     the service role and always filter by their attempt. Policies below cover
--     company users only.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Organizations and memberships
-- ---------------------------------------------------------------------------

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  logo_path   text,
  -- e.g. {"viewers_see_media": false, "retention_days": 180}
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table public.memberships (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('admin', 'recruiter', 'viewer')),
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id);

-- Role helpers. SECURITY DEFINER so policies on memberships can call them
-- without recursing into memberships' own RLS.
create function public.has_org_role(target_org uuid, roles text[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org
      and m.user_id = (select auth.uid())
      and m.role = any(roles)
  );
$$;

create function public.is_org_member(target_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_org_role(target_org, array['admin', 'recruiter', 'viewer']);
$$;

create function public.can_manage_org(target_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_org_role(target_org, array['admin', 'recruiter']);
$$;

revoke execute on function public.has_org_role(uuid, text[]) from public, anon;
revoke execute on function public.is_org_member(uuid) from public, anon;
revoke execute on function public.can_manage_org(uuid) from public, anon;
grant execute on function public.has_org_role(uuid, text[]) to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.can_manage_org(uuid) to authenticated;

-- Creates an org and makes the caller its admin in one transaction.
create function public.create_organization(org_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  new_org uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;
  insert into public.organizations (name) values (org_name) returning id into new_org;
  insert into public.memberships (org_id, user_id, role)
    values (new_org, (select auth.uid()), 'admin');
  return new_org;
end;
$$;
revoke execute on function public.create_organization(text) from public, anon;
grant execute on function public.create_organization(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Content: scenarios, assessments, jobs
-- ---------------------------------------------------------------------------

create table public.scenarios (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references public.organizations(id) on delete cascade, -- null = platform library
  slug          text not null,
  title         text not null,
  role_family   text not null,             -- 'accounting', 'pharma', ...
  version       int  not null default 1,
  definition    jsonb not null,            -- steps + public config; generator lives in server code
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique nulls not distinct (org_id, slug, version)
);

-- Published scenario versions are immutable.
create function public.prevent_published_scenario_edits()
returns trigger language plpgsql as $$
begin
  if old.published_at is not null then
    raise exception 'scenario % v% is published and cannot be changed; create a new version', old.slug, old.version;
  end if;
  return new;
end;
$$;
create trigger scenarios_immutable_when_published
  before update on public.scenarios
  for each row execute function public.prevent_published_scenario_edits();

create table public.assessments (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  scenario_id         uuid not null references public.scenarios(id),
  title               text not null,
  time_limit_minutes  int  not null check (time_limit_minutes between 1 and 240),
  pass_score          numeric,
  -- {"camera": true, "screen": true, "phone": false}
  proctoring          jsonb not null default '{}'::jsonb,
  locked_at           timestamptz,         -- set when the first candidate starts
  created_at          timestamptz not null default now(),
  unique (id, org_id)
);
create index assessments_org_idx on public.assessments(org_id);

-- Proctoring settings and time limit are frozen once a candidate has started.
create function public.prevent_locked_assessment_edits()
returns trigger language plpgsql as $$
begin
  if old.locked_at is not null and (
       new.proctoring is distinct from old.proctoring
    or new.time_limit_minutes is distinct from old.time_limit_minutes
    or new.scenario_id is distinct from old.scenario_id
  ) then
    raise exception 'assessment is locked because a candidate has started; clone it to change settings';
  end if;
  return new;
end;
$$;
create trigger assessments_locked
  before update on public.assessments
  for each row execute function public.prevent_locked_assessment_edits();

create table public.jobs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  title          text not null,
  assessment_id  uuid not null,
  deadline       timestamptz,
  created_at     timestamptz not null default now(),
  unique (id, org_id),
  foreign key (assessment_id, org_id) references public.assessments(id, org_id)
);
create index jobs_org_idx on public.jobs(org_id);

-- ---------------------------------------------------------------------------
-- Candidates: invites and attempts
-- ---------------------------------------------------------------------------

create table public.invites (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  job_id            uuid not null,
  email             text not null,
  candidate_name    text,
  expires_at        timestamptz not null,
  status            text not null default 'invited'
                      check (status in ('invited', 'started', 'completed', 'expired', 'revoked')),
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  unique (id, org_id),
  foreign key (job_id, org_id) references public.jobs(id, org_id) on delete cascade
);
create index invites_org_job_idx on public.invites(org_id, job_id);

create table public.attempts (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  invite_id            uuid not null unique,
  scenario_id          uuid not null references public.scenarios(id),
  started_at           timestamptz,
  deadline_at          timestamptz,            -- started_at + time limit; enforced server-side
  submitted_at         timestamptz,
  submit_reason        text check (submit_reason in ('candidate', 'timeout')),
  status               text not null default 'not_started'
                         check (status in ('not_started', 'in_progress', 'submitted', 'scored')),
  score                jsonb,
  integrity_label      text check (integrity_label in ('clear', 'review', 'suspicious')),
  created_at           timestamptz not null default now(),
  unique (id, org_id),
  foreign key (invite_id, org_id) references public.invites(id, org_id) on delete cascade
);
create index attempts_org_idx on public.attempts(org_id);
create index attempts_open_deadline_idx on public.attempts(deadline_at) where status = 'in_progress';

-- Candidate secrets live in their own tables with RLS on and no policies, so
-- only the server (service role) can read them. Company users never see them.
create table public.invite_secrets (
  invite_id        uuid primary key,
  org_id           uuid not null,
  token_hash       text not null unique,      -- sha256 of the link token; raw token is never stored
  code_hash        text,                      -- sha256 of the 6-digit email code
  code_expires_at  timestamptz,
  code_attempts    int not null default 0,
  foreign key (invite_id, org_id) references public.invites(id, org_id) on delete cascade
);

create table public.attempt_secrets (
  attempt_id          uuid primary key,
  org_id              uuid not null,
  seed                text not null,          -- variant seed; deterministic per attempt
  session_token_hash  text unique,            -- sha256 of the candidate's session cookie
  foreign key (attempt_id, org_id) references public.attempts(id, org_id) on delete cascade
);

create table public.step_responses (
  attempt_id   uuid not null,
  org_id       uuid not null,
  step_id      text not null,
  answer       jsonb not null,
  score        jsonb,
  updated_at   timestamptz not null default now(),
  primary key (attempt_id, step_id),
  foreign key (attempt_id, org_id) references public.attempts(id, org_id) on delete cascade
);

create table public.action_events (
  id          bigint generated always as identity primary key,
  attempt_id  uuid not null,
  org_id      uuid not null,
  at          timestamptz not null default now(),
  kind        text not null,                 -- opened_message, started_step, submitted_step, ...
  payload     jsonb not null default '{}'::jsonb,
  foreign key (attempt_id, org_id) references public.attempts(id, org_id) on delete cascade
);
create index action_events_attempt_idx on public.action_events(attempt_id, at);

create table public.integrity_events (
  id          bigint generated always as identity primary key,
  attempt_id  uuid not null,
  org_id      uuid not null,
  at          timestamptz not null default now(),
  kind        text not null,                 -- tab_switch, paste, face_missing, screen_share_stopped, ...
  payload     jsonb not null default '{}'::jsonb,
  foreign key (attempt_id, org_id) references public.attempts(id, org_id) on delete cascade
);
create index integrity_events_attempt_idx on public.integrity_events(attempt_id, at);

create table public.media (
  id            bigint generated always as identity primary key,
  attempt_id    uuid not null,
  org_id        uuid not null,
  at            timestamptz not null default now(),
  source        text not null check (source in ('camera', 'screen', 'phone')),
  storage_path  text not null,
  foreign key (attempt_id, org_id) references public.attempts(id, org_id) on delete cascade
);
create index media_attempt_idx on public.media(attempt_id, at);

-- Flags are suspicious labels with evidence. They never reject anyone; a
-- recruiter confirms or clears them.
create table public.flags (
  id           uuid primary key default gen_random_uuid(),
  attempt_id   uuid not null,
  org_id       uuid not null,
  reason       text not null,
  evidence     jsonb not null default '{}'::jsonb,   -- timestamps, media ids, event ids
  status       text not null default 'open' check (status in ('open', 'confirmed', 'cleared')),
  reviewed_by  uuid references auth.users(id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  foreign key (attempt_id, org_id) references public.attempts(id, org_id) on delete cascade
);
create index flags_attempt_idx on public.flags(attempt_id);

create table public.notes (
  id          uuid primary key default gen_random_uuid(),
  attempt_id  uuid not null,
  org_id      uuid not null,
  author_id   uuid not null references auth.users(id),
  body        text not null default '',
  vote        text check (vote in ('hire', 'no_hire', 'unsure')),
  created_at  timestamptz not null default now(),
  foreign key (attempt_id, org_id) references public.attempts(id, org_id) on delete cascade
);
create index notes_attempt_idx on public.notes(attempt_id);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  actor_id   uuid references auth.users(id),
  action     text not null,                  -- viewed_report, exported_csv, cleared_flag, ...
  target     text,
  at         timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log(org_id, at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.organizations    enable row level security;
alter table public.memberships      enable row level security;
alter table public.scenarios        enable row level security;
alter table public.assessments      enable row level security;
alter table public.jobs             enable row level security;
alter table public.invites          enable row level security;
alter table public.attempts         enable row level security;
alter table public.step_responses   enable row level security;
alter table public.action_events    enable row level security;
alter table public.integrity_events enable row level security;
alter table public.media            enable row level security;
alter table public.flags            enable row level security;
alter table public.notes            enable row level security;
alter table public.audit_log        enable row level security;

-- organizations: members read; admins update. Creation goes through create_organization().
create policy "members read org" on public.organizations
  for select to authenticated using (public.is_org_member(id));
create policy "admins update org" on public.organizations
  for update to authenticated
  using (public.has_org_role(id, array['admin'])) with check (public.has_org_role(id, array['admin']));

-- memberships: members see teammates; only admins add, change, or remove.
create policy "members read memberships" on public.memberships
  for select to authenticated using (public.is_org_member(org_id));
create policy "admins insert memberships" on public.memberships
  for insert to authenticated with check (public.has_org_role(org_id, array['admin']));
create policy "admins update memberships" on public.memberships
  for update to authenticated
  using (public.has_org_role(org_id, array['admin'])) with check (public.has_org_role(org_id, array['admin']));
create policy "admins delete memberships" on public.memberships
  for delete to authenticated using (public.has_org_role(org_id, array['admin']));

-- scenarios: everyone signed in reads the published platform library; members read their org's own.
create policy "read library and own scenarios" on public.scenarios
  for select to authenticated
  using ((org_id is null and published_at is not null) or (org_id is not null and public.is_org_member(org_id)));
create policy "managers write own scenarios" on public.scenarios
  for all to authenticated
  using (org_id is not null and public.can_manage_org(org_id))
  with check (org_id is not null and public.can_manage_org(org_id));

-- assessments, jobs, invites: members read; admins and recruiters write.
create policy "members read assessments" on public.assessments
  for select to authenticated using (public.is_org_member(org_id));
create policy "managers write assessments" on public.assessments
  for all to authenticated using (public.can_manage_org(org_id)) with check (public.can_manage_org(org_id));

create policy "members read jobs" on public.jobs
  for select to authenticated using (public.is_org_member(org_id));
create policy "managers write jobs" on public.jobs
  for all to authenticated using (public.can_manage_org(org_id)) with check (public.can_manage_org(org_id));

create policy "members read invites" on public.invites
  for select to authenticated using (public.is_org_member(org_id));
create policy "managers write invites" on public.invites
  for all to authenticated using (public.can_manage_org(org_id)) with check (public.can_manage_org(org_id));

-- invite_secrets and attempt_secrets: RLS on, no policies = server only.
alter table public.invite_secrets  enable row level security;
alter table public.attempt_secrets enable row level security;
revoke all on public.invite_secrets, public.attempt_secrets from anon, authenticated;

-- attempts and candidate activity: read-only for members. Writes come from
-- server routes using the service role.
create policy "members read attempts" on public.attempts
  for select to authenticated using (public.is_org_member(org_id));
create policy "members read step_responses" on public.step_responses
  for select to authenticated using (public.is_org_member(org_id));
create policy "members read action_events" on public.action_events
  for select to authenticated using (public.is_org_member(org_id));
create policy "members read integrity_events" on public.integrity_events
  for select to authenticated using (public.is_org_member(org_id));

-- media: admins and recruiters; viewers only if the org allows it.
create policy "media visible per role" on public.media
  for select to authenticated
  using (
    public.can_manage_org(org_id)
    or (
      public.has_org_role(org_id, array['viewer'])
      and exists (
        select 1 from public.organizations o
        where o.id = media.org_id and coalesce((o.settings->>'viewers_see_media')::boolean, false)
      )
    )
  );

-- flags: members read; admins and recruiters confirm or clear.
create policy "members read flags" on public.flags
  for select to authenticated using (public.is_org_member(org_id));
create policy "managers review flags" on public.flags
  for update to authenticated
  using (public.can_manage_org(org_id))
  with check (public.can_manage_org(org_id) and reviewed_by = (select auth.uid()));

-- notes: members read; anyone in the org writes their own.
create policy "members read notes" on public.notes
  for select to authenticated using (public.is_org_member(org_id));
create policy "members add own notes" on public.notes
  for insert to authenticated
  with check (public.is_org_member(org_id) and author_id = (select auth.uid()));
create policy "authors edit own notes" on public.notes
  for update to authenticated
  using (author_id = (select auth.uid()) and public.is_org_member(org_id))
  with check (author_id = (select auth.uid()) and public.is_org_member(org_id));
create policy "authors delete own notes" on public.notes
  for delete to authenticated using (author_id = (select auth.uid()) and public.is_org_member(org_id));

-- audit_log: admins read; members append their own actions.
create policy "admins read audit log" on public.audit_log
  for select to authenticated using (public.has_org_role(org_id, array['admin']));
create policy "members append audit log" on public.audit_log
  for insert to authenticated
  with check (public.is_org_member(org_id) and actor_id = (select auth.uid()));
