-- Q8 (docs/decisions/2026-11-08-skeleton-open-questions.md): the active company
-- lives in the URL, /app/<slug>/... . Each organization gets a short, unique,
-- URL-safe name.

-- Turns "Mason & Reed CPAs" into "mason-reed-cpas".
create function private.slugify(input text)
returns text
language sql immutable set search_path = ''
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g'));
$$;

-- Picks a free slug: "mason-reed-cpas", then "mason-reed-cpas-2", "-3", ...
create function private.unique_org_slug(org_name text)
returns text
language plpgsql set search_path = ''
as $$
declare
  base text := trim(both '-' from left(private.slugify(org_name), 40));
  candidate text;
  n int := 1;
begin
  if length(base) < 3 or base = any(private.reserved_org_slugs()) then
    base := 'org-' || coalesce(nullif(base, ''), substr(md5(random()::text), 1, 6));
  end if;
  candidate := base;
  while exists (select 1 from public.organizations where slug = candidate) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  return candidate;
end;
$$;

-- Words that can't be company slugs because they are (or may become) pages.
create function private.reserved_org_slugs()
returns text[]
language sql immutable set search_path = ''
as $$
  select array['new', 'settings', 'account', 'onboarding', 'api', 'admin', 'login',
               'logout', 'signup', 'auth', 'app', 'dev', 'help', 'support', 'billing'];
$$;

alter table public.organizations add column slug text;

-- Backfill any existing rows (the table is empty today; this keeps the
-- migration safe if it isn't).
update public.organizations set slug = private.unique_org_slug(name) where slug is null;

alter table public.organizations
  alter column slug set not null,
  add constraint organizations_slug_key unique (slug),
  add constraint organizations_slug_format check (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and length(slug) between 3 and 48
    and not (slug = any(private.reserved_org_slugs()))
  );

-- create_organization now also picks the slug. Same name, same argument, same
-- return value, so existing app code keeps working.
create or replace function public.create_organization(org_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  new_org uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;
  insert into public.organizations (name, slug)
    values (org_name, private.unique_org_slug(org_name))
    returning id into new_org;
  insert into public.memberships (org_id, user_id, role)
    values (new_org, (select auth.uid()), 'admin');
  return new_org;
end;
$$;
