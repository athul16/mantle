-- Status values and other check constraints: every allowed value is accepted
-- and anything else is rejected (23514). Run as the owner so only the
-- constraint, not RLS, decides.
begin;
\ir fixtures/setup.psql

select plan(93);

create function pg_temp.set_col(tbl text, col text, val text, key_sql text) returns text
language sql as $$
  select pg_temp.try_as('owner', format('update public.%I set %I = %L where %s', tbl, col, val, key_sql))
$$;

-- (table, column, row filter, allowed values, rejected values)
create temp table enum_cases (tbl text, col text, key_sql text, ok text[], bad text[]);
insert into enum_cases values
  ('memberships', 'role',            format('user_id = %L', pg_temp.fx('a_viewer')),
     array['admin', 'recruiter', 'viewer'],                              array['owner', 'Admin', '', 'superuser']),
  ('invites',     'status',          format('id = %L', pg_temp.fx('inv_a2')),
     array['invited', 'started', 'completed', 'expired', 'revoked'],      array['pending', 'INVITED', 'deleted', '']),
  ('attempts',    'status',          format('id = %L', pg_temp.fx('att_a')),
     array['not_started', 'in_progress', 'submitted', 'scored'],          array['rejected', 'failed', 'done', '']),
  ('attempts',    'submit_reason',   format('id = %L', pg_temp.fx('att_a')),
     array['candidate', 'timeout'],                                       array['proctor', 'auto_reject', '']),
  ('attempts',    'integrity_label', format('id = %L', pg_temp.fx('att_a')),
     array['clear', 'review', 'suspicious'],                              array['rejected', 'cheater', 'fail', '']),
  ('media',       'source',          format('attempt_id = %L', pg_temp.fx('att_a')),
     array['camera', 'screen', 'phone'],                                  array['microphone', 'webcam', '']),
  ('flags',       'status',          format('id = %L', pg_temp.fx('flag_a')),
     array['open', 'confirmed', 'cleared'],                               array['rejected', 'closed', '']),
  ('notes',       'vote',            format('id = %L', pg_temp.fx('note_a_admin')),
     array['hire', 'no_hire', 'unsure'],                                  array['reject', 'maybe', 'yes', '']);

select is(pg_temp.set_col(tbl, col, v, key_sql), '1', tbl || '.' || col || ' accepts ' || quote_literal(v))
from enum_cases, unnest(ok) v;

select is(pg_temp.set_col(tbl, col, v, key_sql), '23514', tbl || '.' || col || ' rejects ' || quote_literal(v))
from enum_cases, unnest(bad) v;

-- Nullable status-like columns accept null; required ones don't.
select is(pg_temp.try_as('owner', format('update public.%I set %I = null where %s', tbl, col, key_sql)), want,
          tbl || '.' || col || case when want = '1' then ' may be null' else ' may not be null' end)
from (values
  ('attempts',    'submit_reason',   format('id = %L', pg_temp.fx('att_a')),          '1'),
  ('attempts',    'integrity_label', format('id = %L', pg_temp.fx('att_a')),          '1'),
  ('notes',       'vote',            format('id = %L', pg_temp.fx('note_a_admin')),   '1'),
  ('attempts',    'status',          format('id = %L', pg_temp.fx('att_a')),          '23502'),
  ('invites',     'status',          format('id = %L', pg_temp.fx('inv_a2')),         '23502'),
  ('flags',       'status',          format('id = %L', pg_temp.fx('flag_a')),         '23502'),
  ('memberships', 'role',            format('user_id = %L', pg_temp.fx('a_viewer')),  '23502'),
  ('media',       'source',          format('attempt_id = %L', pg_temp.fx('att_a')),  '23502')
) t(tbl, col, key_sql, want);

-- Defaults
select is(pg_temp.try_as('owner', $$insert into public.invites (org_id, job_id, email, expires_at) values (pg_temp.fx('org_a'), pg_temp.fx('job_a'), 'd@example.test', now())$$), '1',
          'invites: insert without status succeeds');
select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'status')::text, d,
          t || '.status defaults to ' || d)
from (values ('invites', '''invited''::text'), ('attempts', '''not_started''::text'), ('flags', '''open''::text')) x(t, d);

-- assessments.time_limit_minutes: 1 to 240
select is(pg_temp.set_col('assessments', 'time_limit_minutes', v, format('id = %L', pg_temp.fx('asm_a'))), want,
          'assessments.time_limit_minutes = ' || v || ' -> ' || want)
from (values ('1', '1'), ('240', '1'), ('0', '23514'), ('241', '23514'), ('-5', '23514')) t(v, want);

-- organizations.name: not blank
select is(pg_temp.set_col('organizations', 'name', v, format('id = %L', pg_temp.fx('org_a'))), want,
          'organizations.name = ' || quote_literal(v) || ' -> ' || want)
from (values ('A', '1'), ('', '23514'), ('   ', '23514')) t(v, want);

-- organizations.slug: lowercase words joined by single hyphens, 3 to 48, not reserved
select is(pg_temp.set_col('organizations', 'slug', v, format('id = %L', pg_temp.fx('org_a'))), want,
          'organizations.slug = ' || quote_literal(v) || ' -> ' || want)
from (values
  ('abc', '1'), ('acme-2', '1'), ('a1-b2-c3', '1'), (repeat('a', 48), '1'),
  ('ab', '23514'), (repeat('a', 49), '23514'), ('Acme', '23514'), ('acme--co', '23514'),
  ('-acme', '23514'), ('acme-', '23514'), ('acme co', '23514'), ('acmé', '23514'), ('acme_co', '23514'),
  ('admin', '23514'), ('app', '23514'), ('new', '23514'), ('settings', '23514'), ('login', '23514')
) t(v, want);

select * from finish();
rollback;
