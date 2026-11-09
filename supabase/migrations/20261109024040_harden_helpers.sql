-- Fixes from the Supabase security advisor after the initial schema.
--
-- 1. Role-check helpers move to a `private` schema that the public API does not
--    expose, so they can't be called as /rest/v1/rpc/... endpoints. Policies
--    still use them.
-- 2. Trigger functions get a fixed search_path.
--
-- create_organization stays public on purpose: the app calls it to sign up.
-- invite_secrets / attempt_secrets having RLS with no policies is intentional
-- (server-only tables).

create schema if not exists private;
grant usage on schema private to authenticated;

alter function public.has_org_role(uuid, text[]) set schema private;
alter function public.is_org_member(uuid)        set schema private;
alter function public.can_manage_org(uuid)       set schema private;

-- Bodies reference public.has_org_role; repoint them at private.
create or replace function private.is_org_member(target_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.has_org_role(target_org, array['admin', 'recruiter', 'viewer']);
$$;

create or replace function private.can_manage_org(target_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.has_org_role(target_org, array['admin', 'recruiter']);
$$;

alter function public.prevent_published_scenario_edits() set search_path = '';
alter function public.prevent_locked_assessment_edits()  set search_path = '';
