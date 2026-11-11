-- RLS is on for every public table, each table has exactly the policies the
-- migrations define, every policy is for signed-in users only and checks org
-- membership, and nobody outside an org reads its rows. Per-actor behaviour
-- lives in the policies_* files.
begin;
\ir fixtures/setup.psql

select plan(57);

-- ---------------------------------------------------------------------------
-- RLS enabled, table by table (so a failure names the table)
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass),
  t || ': row level security is enabled'
)
from unnest(array['organizations', 'memberships', 'scenarios', 'assessments', 'jobs', 'invites',
                  'attempts', 'invite_secrets', 'attempt_secrets', 'step_responses', 'action_events',
                  'integrity_events', 'media', 'flags', 'notes', 'audit_log', 'profiles']) t;

-- ---------------------------------------------------------------------------
-- Exactly these policies
-- ---------------------------------------------------------------------------

select set_eq(
  $$ select tablename::text, policyname::text, cmd::text, permissive::text
       from pg_policies where schemaname = 'public' $$,
  $$ values
       ('organizations',    'members read org',                  'SELECT', 'PERMISSIVE'),
       ('organizations',    'admins update org',                 'UPDATE', 'PERMISSIVE'),
       ('memberships',      'members read memberships',          'SELECT', 'PERMISSIVE'),
       ('memberships',      'admins insert memberships',         'INSERT', 'PERMISSIVE'),
       ('memberships',      'admins update memberships',         'UPDATE', 'PERMISSIVE'),
       ('memberships',      'admins delete memberships',         'DELETE', 'PERMISSIVE'),
       ('scenarios',        'read library and own scenarios',    'SELECT', 'PERMISSIVE'),
       ('scenarios',        'managers write own scenarios',      'ALL',    'PERMISSIVE'),
       ('assessments',      'members read assessments',          'SELECT', 'PERMISSIVE'),
       ('assessments',      'managers write assessments',        'ALL',    'PERMISSIVE'),
       ('jobs',             'members read jobs',                 'SELECT', 'PERMISSIVE'),
       ('jobs',             'managers write jobs',               'ALL',    'PERMISSIVE'),
       ('invites',          'members read invites',              'SELECT', 'PERMISSIVE'),
       ('invites',          'managers write invites',            'ALL',    'PERMISSIVE'),
       ('attempts',         'members read attempts',             'SELECT', 'PERMISSIVE'),
       ('step_responses',   'members read step_responses',       'SELECT', 'PERMISSIVE'),
       ('action_events',    'members read action_events',        'SELECT', 'PERMISSIVE'),
       ('integrity_events', 'members read integrity_events',     'SELECT', 'PERMISSIVE'),
       ('media',            'media visible per role',            'SELECT', 'PERMISSIVE'),
       ('flags',            'members read flags',                'SELECT', 'PERMISSIVE'),
       ('flags',            'managers review flags',             'UPDATE', 'PERMISSIVE'),
       ('notes',            'members read notes',                'SELECT', 'PERMISSIVE'),
       ('notes',            'members add own notes',             'INSERT', 'PERMISSIVE'),
       ('notes',            'authors edit own notes',            'UPDATE', 'PERMISSIVE'),
       ('notes',            'authors delete own notes',          'DELETE', 'PERMISSIVE'),
       ('audit_log',        'admins read audit log',             'SELECT', 'PERMISSIVE'),
       ('audit_log',        'members append audit log',          'INSERT', 'PERMISSIVE'),
       ('profiles',         'read own and teammates'' profiles',  'SELECT', 'PERMISSIVE') $$,
  'every public policy, with its command (a new or dropped policy fails here)'
);

select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
      where schemaname = 'public' and roles <> '{authenticated}'::name[] $$,
  'every policy applies to the authenticated role only (none to anon or public)'
);

select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
      where schemaname = 'public'
        and tablename <> 'profiles'
        and coalesce(qual, '') !~ 'private\.(is_org_member|can_manage_org|has_org_role)'
        and coalesce(with_check, '') !~ 'private\.(is_org_member|can_manage_org|has_org_role)' $$,
  'every policy checks org membership through the private helpers'
);

select is(
  (select qual from pg_policies where schemaname = 'public' and tablename = 'profiles'),
  '((id = ( SELECT auth.uid() AS uid)) OR private.shares_org_with(id))',
  'profiles: the one policy not scoped to an org reads your own profile or a teammate''s'
);

select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
      where schemaname = 'public' and (trim(qual) = 'true' or trim(with_check) = 'true') $$,
  'no policy is an unconditional true'
);

select set_eq(
  $$ select c.relname::text from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
        and not exists (select 1 from pg_policies p
                         where p.schemaname = 'public' and p.tablename = c.relname
                           and p.cmd in ('SELECT', 'ALL')) $$,
  $$ values ('invite_secrets'), ('attempt_secrets') $$,
  'only the two secret tables have no read policy (so nobody but the server reads them)'
);

select set_eq(
  $$ select c.relname::text from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
        and not exists (select 1 from pg_policies p
                         where p.schemaname = 'public' and p.tablename = c.relname
                           and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')) $$,
  $$ values ('invite_secrets'), ('attempt_secrets'), ('attempts'), ('step_responses'),
            ('action_events'), ('integrity_events'), ('media'), ('profiles') $$,
  'candidate data and profiles have no write policy: only the server and the auth.users trigger write them'
);

-- ---------------------------------------------------------------------------
-- Sweep: who sees rows in each table
-- ---------------------------------------------------------------------------

select is(
  pg_temp.count_as('anon', 'select 1 from public.' || t),
  0,
  t || ': anonymous visitors read nothing'
)
from unnest(array['organizations', 'memberships', 'scenarios', 'assessments', 'jobs', 'invites',
                  'attempts', 'step_responses', 'action_events', 'integrity_events', 'media',
                  'flags', 'notes', 'audit_log']) t;

select is(pg_temp.try_as('anon', 'select 1 from public.profiles'), '42501',
          'profiles: anonymous visitors cannot read profiles at all');

select is(
  pg_temp.count_as('outsider', 'select 1 from public.' || t),
  0,
  t || ': a signed-in user with no membership reads nothing'
)
from unnest(array['organizations', 'memberships', 'assessments', 'jobs', 'invites',
                  'attempts', 'step_responses', 'action_events', 'integrity_events', 'media',
                  'flags', 'notes', 'audit_log']) t;

select is(
  pg_temp.count_as('outsider', $$select id from public.profiles where id <> pg_temp.fx('outsider')$$),
  0,
  'profiles: a signed-in user with no membership reads only their own profile'
);

select is(
  pg_temp.count_as('outsider', $$select 1 from public.scenarios where slug like 'pgtap-%'$$),
  1,
  'scenarios: a signed-in user with no membership reads only the published library'
);

select ok(
  (select rolbypassrls from pg_roles where rolname = 'service_role'),
  'the service role bypasses RLS (server routes and candidate flow)'
);
select ok(
  not (select rolbypassrls from pg_roles where rolname = 'authenticated')
  and not (select rolbypassrls from pg_roles where rolname = 'anon'),
  'anon and authenticated do not bypass RLS'
);

-- RLS does not apply to TRUNCATE. PostgREST never issues it, but the API roles
-- still hold the privilege on every tenant table (Supabase default grants).
select todo('anon/authenticated still hold TRUNCATE on public tables (Supabase default grants)', 1);
select is_empty(
  $$ select table_name || ':' || grantee from information_schema.role_table_grants
      where table_schema = 'public' and privilege_type = 'TRUNCATE'
        and grantee in ('anon', 'authenticated') $$,
  'anon and authenticated cannot TRUNCATE any public table (RLS would not stop it)'
);

select * from finish();
rollback;
