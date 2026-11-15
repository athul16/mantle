-- Candidate secrets (invite token hashes, email codes, variant seeds, session
-- hashes) live in invite_secrets and attempt_secrets. Only the service role
-- can touch them: no grants and no policies for anon or authenticated, and no
-- secret-looking column on any table company users can read.
begin;
\ir fixtures/setup.psql

select plan(65);

select table_privs_are('public', t, r, array[]::text[], t || ': ' || r || ' has no table privileges')
from unnest(array['invite_secrets', 'attempt_secrets']) t
cross join unnest(array['anon', 'authenticated']) r;

select table_privs_are('public', t, 'service_role',
                       array['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'],
                       t || ': service_role has full privileges')
from unnest(array['invite_secrets', 'attempt_secrets']) t;

select is_empty(
  $$ select table_name || '.' || column_name || ':' || grantee
       from information_schema.column_privileges
      where table_schema = 'public' and table_name in ('invite_secrets', 'attempt_secrets')
        and grantee in ('anon', 'authenticated', 'PUBLIC') $$,
  'no column-level grants on the secret tables either'
);

select is_empty(
  $$ select policyname from pg_policies where schemaname = 'public'
      and tablename in ('invite_secrets', 'attempt_secrets') $$,
  'the secret tables have no policies'
);

-- Every actor short of the service role is refused outright, for every operation.
create temp table secret_ops (tbl text, op text, q text);
insert into secret_ops values
  ('invite_secrets',  'select', $$select * from public.invite_secrets$$),
  ('invite_secrets',  'insert', $$insert into public.invite_secrets (invite_id, org_id, token_hash) values (pg_temp.fx('inv_a2'), pg_temp.fx('org_a'), 'forged')$$),
  ('invite_secrets',  'update', $$update public.invite_secrets set code_attempts = 0$$),
  ('invite_secrets',  'delete', $$delete from public.invite_secrets$$),
  ('attempt_secrets', 'select', $$select * from public.attempt_secrets$$),
  ('attempt_secrets', 'insert', $$insert into public.attempt_secrets (attempt_id, org_id, seed) values (pg_temp.fx('att_a'), pg_temp.fx('org_a'), 'forged')$$),
  ('attempt_secrets', 'update', $$update public.attempt_secrets set seed = 'forged'$$),
  ('attempt_secrets', 'delete', $$delete from public.attempt_secrets$$);

select is(pg_temp.try_as(who, q), '42501', tbl || ': ' || who || ' ' || op || ' is refused')
from secret_ops
cross join unnest(array['a_admin', 'a_recruiter', 'a_viewer', 'b_admin', 'outsider', 'anon']) who;

select is(pg_temp.count_as('service', $$select 1 from public.invite_secrets where token_hash like 'pgtap-%'$$), 2,
          'invite_secrets: service role reads');
select is(pg_temp.count_as('service', $$select 1 from public.attempt_secrets where seed like 'pgtap-%'$$), 2,
          'attempt_secrets: service role reads');
select is(pg_temp.try_as('service', $$update public.invite_secrets set code_attempts = code_attempts + 1 where invite_id = pg_temp.fx('inv_a')$$), '1',
          'invite_secrets: service role updates');
select is(pg_temp.try_as('service', $$update public.attempt_secrets set session_token_hash = 'rotated' where attempt_id = pg_temp.fx('att_a')$$), '1',
          'attempt_secrets: service role updates');

-- No secret leaks onto a table company users can read.
select is_empty(
  $$ select c.relname || '.' || a.attname
       from pg_attribute a join pg_class c on c.oid = a.attrelid
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
        and c.relname not in ('invite_secrets', 'attempt_secrets')
        and a.attnum > 0 and not a.attisdropped
        and a.attname ~ '(hash|token|seed|secret|code)' $$,
  'no hash, token, seed, secret or code column outside the secret tables'
);

-- And nothing in public that runs as its owner reads them on a caller's behalf.
select set_eq(
  $$ select p.proname::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prosecdef $$,
  $$ values ('create_organization'), ('review_rubric_step'), ('set_retention'), ('delete_candidate_data'),
            ('list_candidates_past_retention'), ('purge_candidate_for_retention'),
            ('list_media_past_retention'), ('purge_media_for_retention'),
            ('set_invite_accommodations'), ('set_contact_email') $$,
  'only the known security definer functions are in public (signup, rubric review, retention, accommodations, contact email)'
);
-- private.purge_candidate deletes a candidate's secret rows (retention); it
-- never reads or returns them.
select set_eq(
  $$ select p.oid::regprocedure::text from pg_proc p
      where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
        and p.prosrc ~ '(invite_secrets|attempt_secrets)' $$,
  $$ values ('private.purge_candidate(uuid)') $$,
  'only the retention purge touches the secret tables'
);
select is_empty(
  $$ select 1 from pg_proc p
      where p.oid = 'private.purge_candidate(uuid)'::regprocedure
        and p.prosrc ~ '(select|returning)[^;]*(invite_secrets|attempt_secrets)' $$,
  'the purge only deletes from the secret tables, never selects or returns them'
);
select is_empty(
  $$ select c.relname from pg_depend d
       join pg_rewrite r on r.oid = d.objid
       join pg_class c on c.oid = r.ev_class
      where d.refobjid in ('public.invite_secrets'::regclass, 'public.attempt_secrets'::regclass)
        and c.oid not in ('public.invite_secrets'::regclass, 'public.attempt_secrets'::regclass) $$,
  'no view selects from the secret tables'
);

select * from finish();
rollback;
