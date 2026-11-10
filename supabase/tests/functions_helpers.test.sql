-- Functions: the role helpers policies use (private.has_org_role,
-- is_org_member, can_manage_org), create_organization and the slug helpers.
-- Checks who can call them, that definer functions have a fixed search_path,
-- that they answer correctly for each actor, and that they can't be pointed at
-- another org or user.
begin;
\ir fixtures/setup.psql

select plan(71);

-- First value of query q run as `who` (as text), or the SQLSTATE it fails with.
create function pg_temp.val_as(who text, q text) returns text
language plpgsql as $$
declare
  v text;
begin
  begin
    perform pg_temp.act_as(who);
    execute q into v;
    raise sqlstate 'TSTRB';
  exception
    when sqlstate 'TSTRB' then return coalesce(v, '<null>');
    when others then return sqlstate;
  end;
end;
$$;

-- Creates an org as the current role and returns its slug (two statements,
-- so the new row is visible to the second).
create function pg_temp.new_org_slug(org_name text) returns text
language plpgsql as $$
declare
  new_id uuid := public.create_organization(org_name);
begin
  return (select slug from public.organizations where id = new_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

select functions_are('private',
  array['has_org_role', 'is_org_member', 'can_manage_org', 'slugify', 'unique_org_slug', 'reserved_org_slugs'],
  'private has exactly the expected functions');
select functions_are('public',
  array['create_organization', 'prevent_locked_assessment_edits', 'prevent_published_scenario_edits', 'review_rubric_step'],
  'public has exactly the expected functions (role helpers are not in the API schema)');

select is(
  (select prosecdef from pg_proc where oid = f::regprocedure), d,
  f || case when d then ' is security definer' else ' runs as the caller' end
)
from (values
  ('private.has_org_role(uuid, text[])', true),
  ('private.is_org_member(uuid)',        true),
  ('private.can_manage_org(uuid)',       true),
  ('public.create_organization(text)',   true),
  ('private.slugify(text)',              false),
  ('private.unique_org_slug(text)',      false),
  ('private.reserved_org_slugs()',       false)
) t(f, d);

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
      where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
        and (p.proconfig is null or not ('search_path=""' = any(p.proconfig))) $$,
  'every public and private function has search_path fixed to empty'
);

select is(
  (select provolatile::text from pg_proc where oid = f::regprocedure), 's',
  f || ' is stable (safe to use in policies)'
)
from unnest(array['private.has_org_role(uuid, text[])', 'private.is_org_member(uuid)', 'private.can_manage_org(uuid)']) f;

-- The helpers take an org, never a user: they always check the caller.
select is(
  (select pg_get_function_identity_arguments(oid) from pg_proc where oid = f::regprocedure), args,
  f || ' takes no user argument'
)
from (values
  ('private.has_org_role(uuid, text[])', 'target_org uuid, roles text[]'),
  ('private.is_org_member(uuid)',        'target_org uuid'),
  ('private.can_manage_org(uuid)',       'target_org uuid')
) t(f, args);

-- ---------------------------------------------------------------------------
-- Who may call them
-- ---------------------------------------------------------------------------

select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon has no usage on schema private');
select ok(has_schema_privilege('authenticated', 'private', 'usage'), 'authenticated has usage on schema private (policies need it)');

select is(has_function_privilege(r, f, 'execute'), allowed,
          f || ': ' || r || case when allowed then ' may' else ' may not' end || ' execute')
from (values
  ('anon',          'private.has_org_role(uuid, text[])', false),
  ('anon',          'private.is_org_member(uuid)',        false),
  ('anon',          'private.can_manage_org(uuid)',       false),
  ('anon',          'public.create_organization(text)',   false),
  ('authenticated', 'private.has_org_role(uuid, text[])', true),
  ('authenticated', 'private.is_org_member(uuid)',        true),
  ('authenticated', 'private.can_manage_org(uuid)',       true),
  ('authenticated', 'public.create_organization(text)',   true)
) t(r, f, allowed);

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p, aclexplode(p.proacl) a
      where p.oid in ('private.has_org_role(uuid, text[])'::regprocedure, 'private.is_org_member(uuid)'::regprocedure,
                      'private.can_manage_org(uuid)'::regprocedure, 'public.create_organization(text)'::regprocedure)
        and a.grantee = 0 $$,
  'PUBLIC has no execute on the role helpers or create_organization'
);

select is(pg_temp.val_as('anon', $$select public.create_organization('anon org')::text$$), '42501',
          'create_organization: anonymous visitors are refused');
select is(pg_temp.val_as('anon', $$select private.is_org_member(pg_temp.fx('org_a'))::text$$), '42501',
          'is_org_member: anonymous visitors are refused');

-- ---------------------------------------------------------------------------
-- Answers per actor
-- ---------------------------------------------------------------------------

select is(pg_temp.val_as(who, format('select private.is_org_member(%L)::text', pg_temp.fx(org))), want,
          'is_org_member(' || org || ') as ' || who || ' = ' || want)
from (values
  ('a_admin', 'org_a', 'true'), ('a_recruiter', 'org_a', 'true'), ('a_viewer', 'org_a', 'true'),
  ('b_admin', 'org_a', 'false'), ('outsider', 'org_a', 'false'), ('a_admin', 'org_b', 'false'),
  ('a_admin', 'no_such_org', 'false')
) t(who, org, want);

select is(pg_temp.val_as(who, format('select private.can_manage_org(%L)::text', pg_temp.fx('org_a'))), want,
          'can_manage_org(org_a) as ' || who || ' = ' || want)
from (values ('a_admin', 'true'), ('a_recruiter', 'true'), ('a_viewer', 'false'), ('b_admin', 'false'), ('outsider', 'false')) t(who, want);

select is(pg_temp.val_as(who, format($$select private.has_org_role(%L, array['admin'])::text$$, pg_temp.fx('org_a'))), want,
          'has_org_role(org_a, admin) as ' || who || ' = ' || want)
from (values ('a_admin', 'true'), ('a_recruiter', 'false'), ('a_viewer', 'false'), ('b_admin', 'false')) t(who, want);

select is(pg_temp.val_as('a_admin', $$select private.is_org_member(null)::text$$), 'false',
          'is_org_member(null) is false');
select is(pg_temp.val_as('a_admin', $$select private.has_org_role(pg_temp.fx('org_a'), array['owner', 'superuser'])::text$$), 'false',
          'has_org_role with made-up role names is false');
select is(pg_temp.val_as('a_admin', $$select private.has_org_role(pg_temp.fx('org_a'), array[]::text[])::text$$), 'false',
          'has_org_role with no roles is false');

-- A signed-in token with no subject is nobody.
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select is(private.is_org_member(pg_temp.fx('org_a')), false,
          'is_org_member without a user id in the token is false');
select throws_like($$ select public.create_organization('No Subject Org') $$, '%not authenticated%',
          'create_organization without a user id in the token is refused');
select pg_temp.act_as('owner');

-- ---------------------------------------------------------------------------
-- create_organization
-- ---------------------------------------------------------------------------

select pg_temp.act_as('outsider');
select public.create_organization('pgTAP Mason & Reed') as new_org \gset
select pg_temp.act_as('owner');

select is((select slug from public.organizations where id = :'new_org'), 'pgtap-mason-reed',
          'create_organization: slug is generated from the name');
select is((select role from public.memberships where org_id = :'new_org' and user_id = pg_temp.fx('outsider')), 'admin',
          'create_organization: the caller becomes admin');
select is((select count(*)::int from public.memberships where org_id = :'new_org'), 1,
          'create_organization: the caller is the only member');
select is(pg_temp.count_as('outsider', format('select 1 from public.organizations where id = %L', :'new_org')), 1,
          'create_organization: the caller can read the new org');
select is((select count(*)::int from public.memberships where org_id = pg_temp.fx('org_a')), 3,
          'create_organization: no existing org gains a member');

select is(pg_temp.val_as(who, format($$select pg_temp.new_org_slug(%L)$$, name)), slug,
          'create_organization(' || quote_literal(name) || ') as ' || who || ' -> ' || slug)
from (values
  ('outsider', 'pgTAP Mason & Reed', 'pgtap-mason-reed-2'),
  ('b_admin',  'pgTAP Org A',       'pgtap-org-a-2'),
  ('outsider', 'Admin',             'org-admin'),
  ('outsider', 'ab',                'org-ab'),
  ('outsider', '  --Hello  World--  ', 'hello-world')
) t(who, name, slug);

select matches(pg_temp.val_as('outsider', $$select pg_temp.new_org_slug('!!!')$$),
               '^org-[0-9a-f]{6}$', 'create_organization: a name with no letters gets org-<random>');
select ok(
  pg_temp.val_as('outsider', format($$select pg_temp.new_org_slug(%L)$$, repeat('very long company name ', 5)))
    ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  and length(pg_temp.val_as('outsider', format($$select pg_temp.new_org_slug(%L)$$, repeat('very long company name ', 5)))) <= 48,
  'create_organization: a long name gets a valid slug of at most 48 characters'
);
select is(pg_temp.val_as('outsider', $$select public.create_organization('   ')::text$$), '23514',
          'create_organization: a blank name is rejected');

-- unique_org_slug runs as the caller, so it only sees the caller's orgs and
-- can't be used to probe which slugs other companies hold.
select is(pg_temp.val_as('b_admin', $$select private.unique_org_slug('pgTAP Org A')$$), 'pgtap-org-a',
          'unique_org_slug as another org''s user reveals nothing about org A''s slug');

-- ---------------------------------------------------------------------------
-- Slug helpers
-- ---------------------------------------------------------------------------

select is(private.slugify(i), o, 'slugify(' || coalesce(quote_literal(i), 'null') || ') = ' || quote_literal(o))
from (values ('Mason & Reed CPAs', 'mason-reed-cpas'), ('--Hello--', 'hello'), ('ABC 123', 'abc-123'),
             ('Café Ünï', 'caf-n'), (null, ''), ('***', '')) t(i, o);

select ok(private.reserved_org_slugs() @> array['new', 'settings', 'app', 'admin', 'api', 'login', 'signup'],
          'reserved slugs include the app''s own page names');

select * from finish();
rollback;
