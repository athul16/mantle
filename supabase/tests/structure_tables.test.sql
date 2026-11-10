-- Structure: every public table, its columns (type, nullability, default,
-- identity) and primary key, as written in supabase/migrations/.
-- A failure here means a migration changed the shape of a table: update the
-- expectation in the same change, on purpose.
begin;
create extension if not exists pgtap with schema extensions;

select plan(36);

-- (column, type, not null, default expression or '', identity 'a'/'d'/'')
create function pg_temp.columns_of(tbl text)
returns table (col text, type text, not_null boolean, dflt text, ident text)
language sql stable as $$
  select a.attname::text,
         format_type(a.atttypid, a.atttypmod),
         a.attnotnull,
         coalesce(pg_get_expr(d.adbin, d.adrelid), ''),
         a.attidentity::text
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = ('public.' || tbl)::regclass
     and a.attnum > 0 and not a.attisdropped
$$;

select tables_are(
  'public',
  array['organizations', 'memberships', 'scenarios', 'assessments', 'jobs', 'invites', 'attempts', 'invite_secrets', 'attempt_secrets', 'step_responses', 'action_events', 'integrity_events', 'media', 'flags', 'notes', 'audit_log'],
  'public has exactly the expected tables'
);

select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('v', 'm', 'f', 'p') $$,
  'public has no views, materialized views, foreign or partitioned tables'
);

-- organizations
select set_eq(
  $$ select * from pg_temp.columns_of('organizations') $$,
  $$ values ('id', 'uuid', true, 'gen_random_uuid()', ''),
       ('name', 'text', true, '', ''),
       ('logo_path', 'text', false, '', ''),
       ('settings', 'jsonb', true, '''{}''::jsonb', ''),
       ('created_at', 'timestamp with time zone', true, 'now()', ''),
       ('slug', 'text', true, '', '') $$,
  'organizations: columns, types, nullability, defaults'
);
select col_is_pk('public', 'organizations', array['id'], 'organizations: primary key (id)');

-- memberships
select set_eq(
  $$ select * from pg_temp.columns_of('memberships') $$,
  $$ values ('org_id', 'uuid', true, '', ''),
       ('user_id', 'uuid', true, '', ''),
       ('role', 'text', true, '', ''),
       ('created_at', 'timestamp with time zone', true, 'now()', '') $$,
  'memberships: columns, types, nullability, defaults'
);
select col_is_pk('public', 'memberships', array['org_id', 'user_id'], 'memberships: primary key (org_id, user_id)');

-- scenarios
select set_eq(
  $$ select * from pg_temp.columns_of('scenarios') $$,
  $$ values ('id', 'uuid', true, 'gen_random_uuid()', ''),
       ('org_id', 'uuid', false, '', ''),
       ('slug', 'text', true, '', ''),
       ('title', 'text', true, '', ''),
       ('role_family', 'text', true, '', ''),
       ('version', 'integer', true, '1', ''),
       ('definition', 'jsonb', true, '', ''),
       ('published_at', 'timestamp with time zone', false, '', ''),
       ('created_at', 'timestamp with time zone', true, 'now()', '') $$,
  'scenarios: columns, types, nullability, defaults'
);
select col_is_pk('public', 'scenarios', array['id'], 'scenarios: primary key (id)');

-- assessments
select set_eq(
  $$ select * from pg_temp.columns_of('assessments') $$,
  $$ values ('id', 'uuid', true, 'gen_random_uuid()', ''),
       ('org_id', 'uuid', true, '', ''),
       ('scenario_id', 'uuid', true, '', ''),
       ('title', 'text', true, '', ''),
       ('time_limit_minutes', 'integer', true, '', ''),
       ('pass_score', 'numeric', false, '', ''),
       ('proctoring', 'jsonb', true, '''{}''::jsonb', ''),
       ('locked_at', 'timestamp with time zone', false, '', ''),
       ('created_at', 'timestamp with time zone', true, 'now()', '') $$,
  'assessments: columns, types, nullability, defaults'
);
select col_is_pk('public', 'assessments', array['id'], 'assessments: primary key (id)');

-- jobs
select set_eq(
  $$ select * from pg_temp.columns_of('jobs') $$,
  $$ values ('id', 'uuid', true, 'gen_random_uuid()', ''),
       ('org_id', 'uuid', true, '', ''),
       ('title', 'text', true, '', ''),
       ('assessment_id', 'uuid', true, '', ''),
       ('deadline', 'timestamp with time zone', false, '', ''),
       ('created_at', 'timestamp with time zone', true, 'now()', '') $$,
  'jobs: columns, types, nullability, defaults'
);
select col_is_pk('public', 'jobs', array['id'], 'jobs: primary key (id)');

-- invites
select set_eq(
  $$ select * from pg_temp.columns_of('invites') $$,
  $$ values ('id', 'uuid', true, 'gen_random_uuid()', ''),
       ('org_id', 'uuid', true, '', ''),
       ('job_id', 'uuid', true, '', ''),
       ('email', 'text', true, '', ''),
       ('candidate_name', 'text', false, '', ''),
       ('expires_at', 'timestamp with time zone', true, '', ''),
       ('status', 'text', true, '''invited''::text', ''),
       ('created_by', 'uuid', false, '', ''),
       ('created_at', 'timestamp with time zone', true, 'now()', '') $$,
  'invites: columns, types, nullability, defaults'
);
select col_is_pk('public', 'invites', array['id'], 'invites: primary key (id)');

-- attempts
select set_eq(
  $$ select * from pg_temp.columns_of('attempts') $$,
  $$ values ('id', 'uuid', true, 'gen_random_uuid()', ''),
       ('org_id', 'uuid', true, '', ''),
       ('invite_id', 'uuid', true, '', ''),
       ('scenario_id', 'uuid', true, '', ''),
       ('started_at', 'timestamp with time zone', false, '', ''),
       ('deadline_at', 'timestamp with time zone', false, '', ''),
       ('submitted_at', 'timestamp with time zone', false, '', ''),
       ('submit_reason', 'text', false, '', ''),
       ('status', 'text', true, '''not_started''::text', ''),
       ('score', 'jsonb', false, '', ''),
       ('integrity_label', 'text', false, '', ''),
       ('created_at', 'timestamp with time zone', true, 'now()', '') $$,
  'attempts: columns, types, nullability, defaults'
);
select col_is_pk('public', 'attempts', array['id'], 'attempts: primary key (id)');

-- invite_secrets
select set_eq(
  $$ select * from pg_temp.columns_of('invite_secrets') $$,
  $$ values ('invite_id', 'uuid', true, '', ''),
       ('org_id', 'uuid', true, '', ''),
       ('token_hash', 'text', true, '', ''),
       ('code_hash', 'text', false, '', ''),
       ('code_expires_at', 'timestamp with time zone', false, '', ''),
       ('code_attempts', 'integer', true, '0', '') $$,
  'invite_secrets: columns, types, nullability, defaults'
);
select col_is_pk('public', 'invite_secrets', array['invite_id'], 'invite_secrets: primary key (invite_id)');

-- attempt_secrets
select set_eq(
  $$ select * from pg_temp.columns_of('attempt_secrets') $$,
  $$ values ('attempt_id', 'uuid', true, '', ''),
       ('org_id', 'uuid', true, '', ''),
       ('seed', 'text', true, '', ''),
       ('session_token_hash', 'text', false, '', '') $$,
  'attempt_secrets: columns, types, nullability, defaults'
);
select col_is_pk('public', 'attempt_secrets', array['attempt_id'], 'attempt_secrets: primary key (attempt_id)');

-- step_responses
select set_eq(
  $$ select * from pg_temp.columns_of('step_responses') $$,
  $$ values ('attempt_id', 'uuid', true, '', ''),
       ('org_id', 'uuid', true, '', ''),
       ('step_id', 'text', true, '', ''),
       ('answer', 'jsonb', true, '', ''),
       ('score', 'jsonb', false, '', ''),
       ('updated_at', 'timestamp with time zone', true, 'now()', '') $$,
  'step_responses: columns, types, nullability, defaults'
);
select col_is_pk('public', 'step_responses', array['attempt_id', 'step_id'], 'step_responses: primary key (attempt_id, step_id)');

-- action_events
select set_eq(
  $$ select * from pg_temp.columns_of('action_events') $$,
  $$ values ('id', 'bigint', true, '', 'a'),
       ('attempt_id', 'uuid', true, '', ''),
       ('org_id', 'uuid', true, '', ''),
       ('at', 'timestamp with time zone', true, 'now()', ''),
       ('kind', 'text', true, '', ''),
       ('payload', 'jsonb', true, '''{}''::jsonb', '') $$,
  'action_events: columns, types, nullability, defaults'
);
select col_is_pk('public', 'action_events', array['id'], 'action_events: primary key (id)');

-- integrity_events
select set_eq(
  $$ select * from pg_temp.columns_of('integrity_events') $$,
  $$ values ('id', 'bigint', true, '', 'a'),
       ('attempt_id', 'uuid', true, '', ''),
       ('org_id', 'uuid', true, '', ''),
       ('at', 'timestamp with time zone', true, 'now()', ''),
       ('kind', 'text', true, '', ''),
       ('payload', 'jsonb', true, '''{}''::jsonb', '') $$,
  'integrity_events: columns, types, nullability, defaults'
);
select col_is_pk('public', 'integrity_events', array['id'], 'integrity_events: primary key (id)');

-- media
select set_eq(
  $$ select * from pg_temp.columns_of('media') $$,
  $$ values ('id', 'bigint', true, '', 'a'),
       ('attempt_id', 'uuid', true, '', ''),
       ('org_id', 'uuid', true, '', ''),
       ('at', 'timestamp with time zone', true, 'now()', ''),
       ('source', 'text', true, '', ''),
       ('storage_path', 'text', true, '', '') $$,
  'media: columns, types, nullability, defaults'
);
select col_is_pk('public', 'media', array['id'], 'media: primary key (id)');

-- flags
select set_eq(
  $$ select * from pg_temp.columns_of('flags') $$,
  $$ values ('id', 'uuid', true, 'gen_random_uuid()', ''),
       ('attempt_id', 'uuid', true, '', ''),
       ('org_id', 'uuid', true, '', ''),
       ('reason', 'text', true, '', ''),
       ('evidence', 'jsonb', true, '''{}''::jsonb', ''),
       ('status', 'text', true, '''open''::text', ''),
       ('reviewed_by', 'uuid', false, '', ''),
       ('reviewed_at', 'timestamp with time zone', false, '', ''),
       ('created_at', 'timestamp with time zone', true, 'now()', ''),
       ('rule', 'text', false, '', ''),
       ('review_note', 'text', false, '', '') $$,
  'flags: columns, types, nullability, defaults'
);
select col_is_pk('public', 'flags', array['id'], 'flags: primary key (id)');

-- notes
select set_eq(
  $$ select * from pg_temp.columns_of('notes') $$,
  $$ values ('id', 'uuid', true, 'gen_random_uuid()', ''),
       ('attempt_id', 'uuid', true, '', ''),
       ('org_id', 'uuid', true, '', ''),
       ('author_id', 'uuid', true, '', ''),
       ('body', 'text', true, '''''::text', ''),
       ('vote', 'text', false, '', ''),
       ('created_at', 'timestamp with time zone', true, 'now()', '') $$,
  'notes: columns, types, nullability, defaults'
);
select col_is_pk('public', 'notes', array['id'], 'notes: primary key (id)');

-- audit_log
select set_eq(
  $$ select * from pg_temp.columns_of('audit_log') $$,
  $$ values ('id', 'bigint', true, '', 'a'),
       ('org_id', 'uuid', true, '', ''),
       ('actor_id', 'uuid', false, '', ''),
       ('action', 'text', true, '', ''),
       ('target', 'text', false, '', ''),
       ('at', 'timestamp with time zone', true, 'now()', '') $$,
  'audit_log: columns, types, nullability, defaults'
);
select col_is_pk('public', 'audit_log', array['id'], 'audit_log: primary key (id)');

-- Every tenant-owned table carries org_id (scenarios: null = platform library).
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'organizations'
        and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped) $$,
  'every public table except organizations has an org_id column'
);
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id'
      where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'scenarios' and not a.attnotnull $$,
  'org_id is not null everywhere except scenarios (where null means library)'
);

select * from finish();
rollback;
