-- Structure: foreign keys (and what happens on delete), unique and check
-- constraints, and the indexes the app relies on. The second half checks the
-- behaviour: cascades, blocked deletes, and composite keys that stop a child
-- row from pointing at another org's parent.
begin;
\ir fixtures/setup.psql

select plan(42);

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

create function pg_temp.cols(rel oid, keys smallint[]) returns text
language sql stable as $$
  select string_agg(a.attname, ',' order by k.i)
    from unnest(keys) with ordinality k(n, i)
    join pg_attribute a on a.attrelid = rel and a.attnum = k.n
$$;

select set_eq(
  $$ select c.conrelid::regclass::text as tbl,
            pg_temp.cols(c.conrelid, c.conkey) as cols,
            c.confrelid::regclass::text as ref_tbl,
            pg_temp.cols(c.confrelid, c.confkey) as ref_cols,
            c.confdeltype::text as on_delete
       from pg_constraint c
      where c.connamespace = 'public'::regnamespace and c.contype = 'f' $$,
  $$ values
       -- (table, columns, references, referenced columns, on delete: c=cascade a=no action)
       ('memberships',      'org_id',            'organizations',   'id',        'c'),
       ('memberships',      'user_id',           'auth.users',      'id',        'c'),
       ('scenarios',        'org_id',            'organizations',   'id',        'c'),
       ('assessments',      'org_id',            'organizations',   'id',        'c'),
       ('assessments',      'scenario_id',       'scenarios',       'id',        'a'),
       ('jobs',             'org_id',            'organizations',   'id',        'c'),
       ('jobs',             'assessment_id,org_id', 'assessments',  'id,org_id', 'a'),
       ('invites',          'org_id',            'organizations',   'id',        'c'),
       ('invites',          'job_id,org_id',     'jobs',            'id,org_id', 'c'),
       ('invites',          'created_by',        'auth.users',      'id',        'a'),
       ('attempts',         'org_id',            'organizations',   'id',        'c'),
       ('attempts',         'invite_id,org_id',  'invites',         'id,org_id', 'c'),
       ('attempts',         'scenario_id',       'scenarios',       'id',        'a'),
       ('invite_secrets',   'invite_id,org_id',  'invites',         'id,org_id', 'c'),
       ('attempt_secrets',  'attempt_id,org_id', 'attempts',        'id,org_id', 'c'),
       ('step_responses',   'attempt_id,org_id', 'attempts',        'id,org_id', 'c'),
       ('action_events',    'attempt_id,org_id', 'attempts',        'id,org_id', 'c'),
       ('integrity_events', 'attempt_id,org_id', 'attempts',        'id,org_id', 'c'),
       ('media',            'attempt_id,org_id', 'attempts',        'id,org_id', 'c'),
       ('flags',            'attempt_id,org_id', 'attempts',        'id,org_id', 'c'),
       ('flags',            'reviewed_by',       'auth.users',      'id',        'a'),
       ('notes',            'attempt_id,org_id', 'attempts',        'id,org_id', 'c'),
       ('notes',            'author_id',         'auth.users',      'id',        'a'),
       ('audit_log',        'org_id',            'organizations',   'id',        'c'),
       ('audit_log',        'actor_id',          'auth.users',      'id',        'a') $$,
  'foreign keys: columns, targets and on-delete behaviour'
);

select set_eq(
  $$ select c.conrelid::regclass::text as tbl, pg_temp.cols(c.conrelid, c.conkey) as cols,
            coalesce(i.indnullsnotdistinct, false) as nulls_not_distinct
       from pg_constraint c join pg_index i on i.indexrelid = c.conindid
      where c.connamespace = 'public'::regnamespace and c.contype = 'u' $$,
  $$ values
       ('organizations',   'slug',                 false),
       ('scenarios',       'org_id,slug,version',  true),
       ('assessments',     'id,org_id',            false),
       ('jobs',            'id,org_id',            false),
       ('invites',         'id,org_id',            false),
       ('attempts',        'id,org_id',            false),
       ('attempts',        'invite_id',            false),
       ('invite_secrets',  'token_hash',           false),
       ('attempt_secrets', 'session_token_hash',   false),
       ('flags',           'attempt_id,rule',      false) $$,
  'unique constraints (scenarios treats null org_id as one library namespace)'
);

select set_eq(
  $$ select conrelid::regclass::text, conname::text
       from pg_constraint
      where connamespace = 'public'::regnamespace and contype = 'c' $$,
  $$ values
       ('organizations', 'organizations_name_check'),
       ('organizations', 'organizations_slug_format'),
       ('organizations', 'organizations_retention_range'),
       ('memberships',   'memberships_role_check'),
       ('assessments',   'assessments_time_limit_minutes_check'),
       ('invites',       'invites_status_check'),
       ('attempts',      'attempts_status_check'),
       ('attempts',      'attempts_submit_reason_check'),
       ('attempts',      'attempts_integrity_label_check'),
       ('media',         'media_source_check'),
       ('flags',         'flags_status_check'),
       ('flags',         'flags_review_note_length'),
       ('notes',         'notes_vote_check') $$,
  'check constraints present (their values are exercised in enums_check_values)'
);

-- Secondary indexes (not backing a primary key or unique constraint).
select set_eq(
  $$ select i.indexrelid::regclass::text, pg_get_indexdef(i.indexrelid)
       from pg_index i join pg_class c on c.oid = i.indrelid
      where c.relnamespace = 'public'::regnamespace and not i.indisprimary
        and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid) $$,
  $$ values
       ('memberships_user_idx',         'CREATE INDEX memberships_user_idx ON public.memberships USING btree (user_id)'),
       ('assessments_org_idx',          'CREATE INDEX assessments_org_idx ON public.assessments USING btree (org_id)'),
       ('jobs_org_idx',                 'CREATE INDEX jobs_org_idx ON public.jobs USING btree (org_id)'),
       ('invites_org_job_idx',          'CREATE INDEX invites_org_job_idx ON public.invites USING btree (org_id, job_id)'),
       ('invites_expires_at_idx',       'CREATE INDEX invites_expires_at_idx ON public.invites USING btree (expires_at)'),
       ('attempts_org_idx',             'CREATE INDEX attempts_org_idx ON public.attempts USING btree (org_id)'),
       ('attempts_open_deadline_idx',   'CREATE INDEX attempts_open_deadline_idx ON public.attempts USING btree (deadline_at) WHERE (status = ''in_progress''::text)'),
       ('action_events_attempt_idx',    'CREATE INDEX action_events_attempt_idx ON public.action_events USING btree (attempt_id, at)'),
       ('integrity_events_attempt_idx', 'CREATE INDEX integrity_events_attempt_idx ON public.integrity_events USING btree (attempt_id, at)'),
       ('media_attempt_idx',            'CREATE INDEX media_attempt_idx ON public.media USING btree (attempt_id, at)'),
       ('flags_attempt_idx',            'CREATE INDEX flags_attempt_idx ON public.flags USING btree (attempt_id)'),
       ('notes_attempt_idx',            'CREATE INDEX notes_attempt_idx ON public.notes USING btree (attempt_id)'),
       ('audit_log_org_idx',            'CREATE INDEX audit_log_org_idx ON public.audit_log USING btree (org_id, at DESC)') $$,
  'secondary indexes (org lookups, per-attempt timelines, open-deadline sweep)'
);

-- Foreign keys whose first column doesn't lead any index. These four are
-- known and covered well enough (invites by (org_id, job_id); the rest are
-- rare parent deletes). A new foreign key without an index shows up here.
select set_eq(
  $$ select c.conname::text
       from pg_constraint c
      where c.connamespace = 'public'::regnamespace and c.contype = 'f'
        and c.confrelid <> 'auth.users'::regclass
        and not exists (select 1 from pg_index i
                         where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]) $$,
  $$ values ('assessments_scenario_id_fkey'), ('attempts_scenario_id_fkey'),
            ('jobs_assessment_id_org_id_fkey'), ('invites_job_id_org_id_fkey') $$,
  'no new foreign key without a leading index'
);

-- ---------------------------------------------------------------------------
-- Behaviour: composite keys keep children in their parent's org
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.jobs (org_id, title, assessment_id)
     values (pg_temp.fx('org_b'), 'cross', pg_temp.fx('asm_a')) $$,
  '23503', null, 'a job cannot use another org''s assessment'
);
select throws_ok(
  $$ insert into public.invites (org_id, job_id, email, expires_at)
     values (pg_temp.fx('org_b'), pg_temp.fx('job_a'), 'x@example.test', now() + interval '1 day') $$,
  '23503', null, 'an invite cannot point at another org''s job'
);
select throws_ok(
  $$ insert into public.attempts (org_id, invite_id, scenario_id)
     values (pg_temp.fx('org_b'), pg_temp.fx('inv_a2'), pg_temp.fx('lib_pub')) $$,
  '23503', null, 'an attempt cannot point at another org''s invite'
);
select throws_ok(
  $$ insert into public.invite_secrets (invite_id, org_id, token_hash)
     values (pg_temp.fx('inv_a2'), pg_temp.fx('org_b'), 'cross') $$,
  '23503', null, 'invite_secrets org_id must match the invite'
);
insert into public.attempts (id, org_id, invite_id, scenario_id)
values (pg_temp.fx('att_a2'), pg_temp.fx('org_a'), pg_temp.fx('inv_a2'), pg_temp.fx('lib_pub'));
select throws_ok(
  $$ insert into public.attempt_secrets (attempt_id, org_id, seed)
     values (pg_temp.fx('att_a2'), pg_temp.fx('org_b'), 'cross') $$,
  '23503', null, 'attempt_secrets org_id must match the attempt'
);

select is(
  (select count(*)::int from (values ('step_responses'), ('action_events'), ('integrity_events'), ('media'), ('flags'), ('notes')) t(tbl)
    where pg_temp.try_as('owner', case tbl
      when 'step_responses'   then $$insert into public.step_responses (attempt_id, org_id, step_id, answer) values (pg_temp.fx('att_a'), pg_temp.fx('org_b'), 'x', '{}')$$
      when 'action_events'    then $$insert into public.action_events (attempt_id, org_id, kind) values (pg_temp.fx('att_a'), pg_temp.fx('org_b'), 'x')$$
      when 'integrity_events' then $$insert into public.integrity_events (attempt_id, org_id, kind) values (pg_temp.fx('att_a'), pg_temp.fx('org_b'), 'x')$$
      when 'media'            then $$insert into public.media (attempt_id, org_id, source, storage_path) values (pg_temp.fx('att_a'), pg_temp.fx('org_b'), 'camera', 'x')$$
      when 'flags'            then $$insert into public.flags (attempt_id, org_id, reason) values (pg_temp.fx('att_a'), pg_temp.fx('org_b'), 'x')$$
      when 'notes'            then $$insert into public.notes (attempt_id, org_id, author_id) values (pg_temp.fx('att_a'), pg_temp.fx('org_b'), pg_temp.fx('b_admin'))$$
    end) = '23503'),
  6,
  'attempt children (responses, events, media, flags, notes) must repeat the attempt''s org_id'
);

select throws_ok(
  $$ update public.step_responses set org_id = pg_temp.fx('org_b') where attempt_id = pg_temp.fx('att_a') $$,
  '23503', null, 'moving a child row to another org breaks its composite key'
);

-- One attempt per invite.
select throws_ok(
  $$ insert into public.attempts (org_id, invite_id, scenario_id)
     values (pg_temp.fx('org_a'), pg_temp.fx('inv_a'), pg_temp.fx('lib_pub')) $$,
  '23505', null, 'an invite has at most one attempt'
);
select throws_ok(
  $$ insert into public.step_responses (attempt_id, org_id, step_id, answer)
     values (pg_temp.fx('att_a'), pg_temp.fx('org_a'), 'step-1', '{}') $$,
  '23505', null, 'one response per (attempt, step)'
);
select throws_ok(
  $$ insert into public.invite_secrets (invite_id, org_id, token_hash)
     values (pg_temp.fx('inv_a2'), pg_temp.fx('org_a'), 'pgtap-token-b') $$,
  '23505', null, 'invite token hashes are unique'
);
select throws_ok(
  $$ insert into public.attempt_secrets (attempt_id, org_id, seed, session_token_hash)
     values (pg_temp.fx('att_a2'), pg_temp.fx('org_a'), 'x', 'pgtap-session-b') $$,
  '23505', null, 'candidate session hashes are unique'
);
select throws_ok(
  $$ insert into public.organizations (name, slug) values ('dup', 'pgtap-org-a') $$,
  '23505', null, 'org slugs are unique'
);
select throws_ok(
  $$ insert into public.memberships (org_id, user_id, role) values (pg_temp.fx('org_a'), pg_temp.fx('a_viewer'), 'admin') $$,
  '23505', null, 'one membership per (org, user)'
);
select throws_ok(
  $$ insert into public.scenarios (org_id, slug, title, role_family, version, definition)
     values (null, 'pgtap-lib', 'dup', 'accounting', 1, '{}') $$,
  '23505', null, 'library scenario (slug, version) is unique even though org_id is null'
);
select lives_ok(
  $$ insert into public.scenarios (org_id, slug, title, role_family, version, definition)
     values (pg_temp.fx('org_b'), 'pgtap-own', 'same slug other org', 'accounting', 2, '{}') $$,
  'two orgs can use the same scenario slug and version'
);
select lives_ok(
  $$ insert into public.scenarios (org_id, slug, title, role_family, version, definition)
     values (null, 'pgtap-lib', 'v2', 'accounting', 2, '{}') $$,
  'a new version of a library scenario can be added'
);

-- ---------------------------------------------------------------------------
-- Behaviour: what deletes do
-- ---------------------------------------------------------------------------

select is(
  pg_temp.try_as('owner', $$delete from public.assessments where id = pg_temp.fx('asm_a')$$),
  '23503',
  'an assessment used by a job cannot be deleted'
);
select is(
  pg_temp.try_as('owner', $$delete from public.scenarios where id = pg_temp.fx('lib_pub')$$),
  '23503',
  'a scenario used by assessments or attempts cannot be deleted'
);
-- Provisional: deleting a user who created invites, wrote notes, reviewed flags
-- or appears in the audit log is blocked (no action), keeping attribution.
select is(
  pg_temp.try_as('owner', $$delete from auth.users where id = pg_temp.fx('a_recruiter')$$),
  '23503',
  'a user who created invites cannot be deleted while those rows exist'
);
select is(
  pg_temp.try_as('owner', $$delete from auth.users where id = pg_temp.fx('a_viewer')$$),
  '23503',
  'a user who wrote notes cannot be deleted while those notes exist'
);
select is(
  pg_temp.try_as('owner', $$delete from auth.users where id = pg_temp.fx('outsider')$$),
  '1',
  'a user with nothing attributed to them can be deleted'
);
select is(
  pg_temp.try_as('owner', $$delete from auth.users where id = pg_temp.fx('b_viewer')$$),
  '1',
  'deleting a user with only a membership succeeds'
);

-- Deleting an invite removes its attempt and everything under it.
delete from public.invites where id = pg_temp.fx('inv_a');
select is((select count(*)::int from public.attempts         where id = pg_temp.fx('att_a')),         0, 'invite delete cascades to the attempt');
select is((select count(*)::int from public.invite_secrets   where invite_id = pg_temp.fx('inv_a')),  0, 'invite delete cascades to invite_secrets');
select is((select count(*)::int from public.attempt_secrets  where attempt_id = pg_temp.fx('att_a')), 0, 'attempt delete cascades to attempt_secrets');
select is((select count(*)::int from public.step_responses   where attempt_id = pg_temp.fx('att_a')), 0, 'attempt delete cascades to step_responses');
select is((select count(*)::int from public.action_events    where attempt_id = pg_temp.fx('att_a')), 0, 'attempt delete cascades to action_events');
select is((select count(*)::int from public.integrity_events where attempt_id = pg_temp.fx('att_a')), 0, 'attempt delete cascades to integrity_events');
select is((select count(*)::int from public.media            where attempt_id = pg_temp.fx('att_a')), 0, 'attempt delete cascades to media');
select is((select count(*)::int from public.flags            where attempt_id = pg_temp.fx('att_a')), 0, 'attempt delete cascades to flags');
select is((select count(*)::int from public.notes            where attempt_id = pg_temp.fx('att_a')), 0, 'attempt delete cascades to notes');

-- Deleting a job removes its invites.
delete from public.jobs where id = pg_temp.fx('job_a');
select is((select count(*)::int from public.invites where job_id = pg_temp.fx('job_a')), 0, 'job delete cascades to invites');

-- Deleting an org removes every row it owns and nothing of the other org's.
delete from public.organizations where id = pg_temp.fx('org_b');
select is(
  (select count(*)::int from (
     select org_id from public.memberships union all
     select org_id from public.scenarios union all
     select org_id from public.assessments union all
     select org_id from public.jobs union all
     select org_id from public.invites union all
     select org_id from public.attempts union all
     select org_id from public.invite_secrets union all
     select org_id from public.attempt_secrets union all
     select org_id from public.step_responses union all
     select org_id from public.action_events union all
     select org_id from public.integrity_events union all
     select org_id from public.media union all
     select org_id from public.flags union all
     select org_id from public.notes union all
     select org_id from public.audit_log) t
   where org_id = pg_temp.fx('org_b')),
  0,
  'org delete cascades to every tenant table'
);
select is(
  (select count(*)::int from public.memberships where org_id = pg_temp.fx('org_a')),
  3,
  'org delete leaves other orgs untouched'
);
select is(
  (select count(*)::int from public.scenarios where id = pg_temp.fx('lib_pub')),
  1,
  'org delete leaves the platform library untouched'
);
select is(
  (select count(*)::int from auth.users where id = pg_temp.fx('b_admin')),
  1,
  'org delete does not delete user accounts'
);

-- Deleting a user removes their memberships.
delete from auth.users where id = pg_temp.fx('outsider');
insert into auth.users (id, email) values (pg_temp.fx('tmp_user'), 'pgtap-tmp@example.test');
insert into public.memberships (org_id, user_id, role) values (pg_temp.fx('org_a'), pg_temp.fx('tmp_user'), 'viewer');
delete from auth.users where id = pg_temp.fx('tmp_user');
select is(
  (select count(*)::int from public.memberships where user_id = pg_temp.fx('tmp_user')),
  0,
  'user delete cascades to memberships'
);

select * from finish();
rollback;
