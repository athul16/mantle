-- Smoke test for the schema layer: run with `pnpm test:db` (supabase test db).
-- Each file runs in its own transaction and is rolled back, so tests can
-- insert freely. See docs/11-testing.md for the patterns (acting as a user).
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

select isnt_empty(
  $$ select 1 from pg_tables where schemaname = 'public' $$,
  'the public schema has tables'
);

select is_empty(
  $$ select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
        and not c.relrowsecurity $$,
  'RLS is enabled on every public table'
);

-- Pattern: arrange data as the owner (bypasses RLS), then act as a role.
insert into public.organizations (id, name, slug)
values ('00000000-0000-0000-0000-00000000a001', 'pgTAP smoke org', 'pgtap-smoke-org');

set local role anon;
select is_empty(
  $$ select id from public.organizations $$,
  'anonymous visitors see no organizations'
);

-- Act as a signed-in user with no memberships.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-00000000b001', 'role', 'authenticated')::text,
  true
);
select is_empty(
  $$ select id from public.organizations $$,
  'a signed-in user outside the org sees no organizations'
);

reset role;
select * from finish();
rollback;
