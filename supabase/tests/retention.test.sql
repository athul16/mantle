-- Retention and delete on request (docs/02 Compliance): the per-org retention
-- setting, private.purge_candidate, the admin-only delete_candidate_data, and
-- the service-only functions the daily cron calls.
begin;
\ir fixtures/setup.psql

select plan(68);

update public.invites set candidate_name = 'Ada Candidate' where id = pg_temp.fx('inv_a');
insert into storage.objects (bucket_id, name)
values ('proctoring', pg_temp.fx('org_a')::text || '/' || pg_temp.fx('att_a')::text || '/screen/1.jpg');

-- ---------------------------------------------------------------------------
-- Functions exist, are security definer, and are granted to the right roles
-- ---------------------------------------------------------------------------

select has_function('private', 'purge_candidate', array['uuid'], 'private.purge_candidate(uuid) exists');
select has_function('public', 'delete_candidate_data', array['uuid'], 'public.delete_candidate_data(uuid) exists');
select has_function('public', 'set_retention_days', array['uuid', 'integer'], 'public.set_retention_days(uuid, int) exists');
select has_function('public', 'list_candidates_past_retention', array['timestamp with time zone', 'integer'], 'cron listing exists');
select has_function('public', 'purge_candidate_for_retention', array['uuid', 'timestamp with time zone'], 'cron purge exists');
select has_function('private', 'retention_days', array['uuid'], 'private.retention_days(uuid) exists');

select is_definer('private', 'purge_candidate', array['uuid'], 'purge_candidate is security definer');
select is_definer('public', 'delete_candidate_data', array['uuid'], 'delete_candidate_data is security definer');
select is_definer('public', 'set_retention_days', array['uuid', 'integer'], 'set_retention_days is security definer');
select is_definer('public', 'list_candidates_past_retention', array['timestamp with time zone', 'integer'], 'listing is security definer');
select is_definer('public', 'purge_candidate_for_retention', array['uuid', 'timestamp with time zone'], 'cron purge is security definer');

select ok(not has_function_privilege('anon', 'public.delete_candidate_data(uuid)', 'execute'), 'anon cannot execute delete_candidate_data');
select ok(has_function_privilege('authenticated', 'public.delete_candidate_data(uuid)', 'execute'), 'authenticated can execute delete_candidate_data');
select ok(not has_function_privilege('anon', 'public.set_retention_days(uuid, integer)', 'execute'), 'anon cannot execute set_retention_days');
select ok(not has_function_privilege('anon', 'private.purge_candidate(uuid)', 'execute'), 'anon cannot execute purge_candidate');
select ok(not has_function_privilege('authenticated', 'private.purge_candidate(uuid)', 'execute'), 'authenticated cannot call purge_candidate directly');
select ok(not has_function_privilege('authenticated', 'public.list_candidates_past_retention(timestamptz, integer)', 'execute'), 'authenticated cannot list for the cron');
select ok(not has_function_privilege('anon', 'public.list_candidates_past_retention(timestamptz, integer)', 'execute'), 'anon cannot list for the cron');
select ok(not has_function_privilege('authenticated', 'public.purge_candidate_for_retention(uuid, timestamptz)', 'execute'), 'authenticated cannot run the cron purge');
select ok(not has_function_privilege('anon', 'public.purge_candidate_for_retention(uuid, timestamptz)', 'execute'), 'anon cannot run the cron purge');
select ok(has_function_privilege('service_role', 'public.list_candidates_past_retention(timestamptz, integer)', 'execute'), 'service role can list');
select ok(has_function_privilege('service_role', 'public.purge_candidate_for_retention(uuid, timestamptz)', 'execute'), 'service role can purge');

-- ---------------------------------------------------------------------------
-- Retention setting: default and bounds
-- ---------------------------------------------------------------------------

select is(private.retention_days(pg_temp.fx('org_a')), 180, 'default retention is 180 days');

select throws_ok(
  $$ update public.organizations set settings = settings || '{"retention_days": 29}' where id = pg_temp.fx('org_a') $$,
  '23514', null, 'retention below 30 days is rejected by the table');
select throws_ok(
  $$ update public.organizations set settings = settings || '{"retention_days": 731}' where id = pg_temp.fx('org_a') $$,
  '23514', null, 'retention above 730 days is rejected by the table');
select throws_ok(
  $$ update public.organizations set settings = settings || '{"retention_days": "ninety"}' where id = pg_temp.fx('org_a') $$,
  '23514', null, 'a non-number retention is rejected');
select throws_ok(
  $$ update public.organizations set settings = settings || '{"retention_days": 90.5}' where id = pg_temp.fx('org_a') $$,
  '23514', null, 'a fractional retention is rejected');
select lives_ok(
  $$ update public.organizations set settings = settings || '{"retention_days": 30}' where id = pg_temp.fx('org_b') $$,
  '30 days is allowed');
select lives_ok(
  $$ update public.organizations set settings = settings || '{"retention_days": 730}' where id = pg_temp.fx('org_b') $$,
  '730 days is allowed');
update public.organizations set settings = '{"viewers_see_media": true}' where id = pg_temp.fx('org_b');

select is(pg_temp.try_as('a_recruiter', $$ select public.set_retention_days(pg_temp.fx('org_a'), 90) $$), '42501', 'a recruiter cannot change retention');
select is(pg_temp.try_as('a_viewer',    $$ select public.set_retention_days(pg_temp.fx('org_a'), 90) $$), '42501', 'a viewer cannot change retention');
select is(pg_temp.try_as('b_admin',     $$ select public.set_retention_days(pg_temp.fx('org_a'), 90) $$), '42501', 'another org''s admin cannot change retention');
select is(pg_temp.try_as('anon',        $$ select public.set_retention_days(pg_temp.fx('org_a'), 90) $$), '42501', 'anon cannot change retention');
select is(pg_temp.try_as('a_admin',     $$ select public.set_retention_days(pg_temp.fx('org_a'), 10) $$), '22023', 'set_retention_days rejects out-of-range days');

select pg_temp.act_as('b_admin');
select public.set_retention_days(pg_temp.fx('org_b'), 90);
select pg_temp.act_as('owner');
select is((select settings from public.organizations where id = pg_temp.fx('org_b')),
  '{"viewers_see_media": true, "retention_days": 90}'::jsonb, 'an admin sets retention and other settings are kept');
select is(private.retention_days(pg_temp.fx('org_b')), 90, 'retention_days reads the setting');
select ok(exists (select 1 from public.audit_log where org_id = pg_temp.fx('org_b') and action = 'changed_retention' and actor_id = pg_temp.fx('b_admin')),
  'changing retention is audited');

-- ---------------------------------------------------------------------------
-- delete_candidate_data refuses everyone but the org's admins
-- ---------------------------------------------------------------------------

select is(pg_temp.try_as('anon',        $$ select public.delete_candidate_data(pg_temp.fx('inv_a')) $$), '42501', 'anon is refused');
select is(pg_temp.try_as('a_recruiter', $$ select public.delete_candidate_data(pg_temp.fx('inv_a')) $$), '42501', 'a recruiter is refused');
select is(pg_temp.try_as('a_viewer',    $$ select public.delete_candidate_data(pg_temp.fx('inv_a')) $$), '42501', 'a viewer is refused');
select is(pg_temp.try_as('b_admin',     $$ select public.delete_candidate_data(pg_temp.fx('inv_a')) $$), '42501', 'another org''s admin is refused');
select is(pg_temp.try_as('outsider',    $$ select public.delete_candidate_data(pg_temp.fx('inv_a')) $$), '42501', 'a user with no membership is refused');
select is(pg_temp.try_as('a_admin',     $$ select public.delete_candidate_data(gen_random_uuid()) $$), '42501', 'an unknown invite gives the same refusal');
select is((select count(*)::int from public.attempts where invite_id = pg_temp.fx('inv_a')), 1, 'refused calls deleted nothing');

-- ---------------------------------------------------------------------------
-- An admin deletes candidate A's data
-- ---------------------------------------------------------------------------

select pg_temp.act_as('a_admin');
select set_config('pgtap.paths', array_to_string(public.delete_candidate_data(pg_temp.fx('inv_a')), ','), true);
select pg_temp.act_as('owner');

select is((select count(*)::int from public.invites          where id = pg_temp.fx('inv_a')),         0, 'invite deleted');
select is((select count(*)::int from public.invite_secrets   where invite_id = pg_temp.fx('inv_a')),  0, 'invite secrets deleted');
select is((select count(*)::int from public.attempts         where id = pg_temp.fx('att_a')),         0, 'attempt deleted');
select is((select count(*)::int from public.attempt_secrets  where attempt_id = pg_temp.fx('att_a')), 0, 'attempt secrets deleted');
select is((select count(*)::int from public.step_responses   where attempt_id = pg_temp.fx('att_a')), 0, 'step responses deleted');
select is((select count(*)::int from public.action_events    where attempt_id = pg_temp.fx('att_a')), 0, 'action events deleted');
select is((select count(*)::int from public.integrity_events where attempt_id = pg_temp.fx('att_a')), 0, 'integrity events deleted');
select is((select count(*)::int from public.media            where attempt_id = pg_temp.fx('att_a')), 0, 'media rows deleted');
select is((select count(*)::int from public.flags            where attempt_id = pg_temp.fx('att_a')), 0, 'flags deleted');
select is((select count(*)::int from public.notes            where attempt_id = pg_temp.fx('att_a')), 0, 'notes deleted');

select ok(string_to_array(current_setting('pgtap.paths'), ',') @> array[
    'org-a/att-a/1.jpg',
    pg_temp.fx('org_a')::text || '/' || pg_temp.fx('att_a')::text || '/screen/1.jpg'
  ], 'returns media paths and the stored objects under the attempt''s folder');

select is((select count(*)::int from public.invites where id = pg_temp.fx('inv_a2')), 1, 'the org''s other candidates are untouched');
select is(
  (select count(*)::int from public.attempts where org_id = pg_temp.fx('org_b'))
  + (select count(*)::int from public.step_responses where org_id = pg_temp.fx('org_b'))
  + (select count(*)::int from public.integrity_events where org_id = pg_temp.fx('org_b'))
  + (select count(*)::int from public.media where org_id = pg_temp.fx('org_b'))
  + (select count(*)::int from public.flags where org_id = pg_temp.fx('org_b'))
  + (select count(*)::int from public.notes where org_id = pg_temp.fx('org_b'))
  + (select count(*)::int from public.invite_secrets where org_id = pg_temp.fx('org_b'))
  + (select count(*)::int from public.attempt_secrets where org_id = pg_temp.fx('org_b')),
  8, 'other orgs'' candidate rows are untouched');

select is(
  (select count(*)::int from public.audit_log
   where org_id = pg_temp.fx('org_a') and action = 'deleted_candidate_data'
     and actor_id = pg_temp.fx('a_admin') and target = 'invite:' || pg_temp.fx('inv_a')::text),
  1, 'one audit row records who deleted which invite');
select is(
  (select count(*)::int from public.audit_log
   where target ilike '%cand-a@%' or target ilike '%Ada%' or target ilike '%example.test%'),
  0, 'the audit row holds no candidate PII');

-- ---------------------------------------------------------------------------
-- The cron listing honours each org's retention
-- ---------------------------------------------------------------------------

-- org A: 30 days. inv_a2 expired 40 days ago and was never started: past retention.
update public.organizations set settings = '{"retention_days": 30}' where id = pg_temp.fx('org_a');
update public.invites set created_at = now() - interval '50 days', expires_at = now() - interval '40 days' where id = pg_temp.fx('inv_a2');
-- org B: 90 days (set above). inv_b expired 40 days ago: still kept.
update public.invites set created_at = now() - interval '50 days', expires_at = now() - interval '40 days' where id = pg_temp.fx('inv_b');
update public.attempts set started_at = now() - interval '45 days', deadline_at = now() - interval '45 days' + interval '1 hour', status = 'submitted', submitted_at = now() - interval '45 days' where id = pg_temp.fx('att_b');
-- org B: an old invite whose attempt was submitted recently is kept (the clock runs from the last activity).
insert into public.invites (id, org_id, job_id, email, expires_at, created_at) values
  (pg_temp.fx('inv_b_old'),    pg_temp.fx('org_b'), pg_temp.fx('job_b'), 'old-b@example.test',    now() - interval '200 days', now() - interval '210 days'),
  (pg_temp.fx('inv_b_recent'), pg_temp.fx('org_b'), pg_temp.fx('job_b'), 'recent-b@example.test', now() - interval '200 days', now() - interval '210 days');
insert into public.attempts (id, org_id, invite_id, scenario_id, started_at, deadline_at, submitted_at, status) values
  (pg_temp.fx('att_b_recent'), pg_temp.fx('org_b'), pg_temp.fx('inv_b_recent'), pg_temp.fx('lib_pub'), now() - interval '10 days', now() - interval '10 days' + interval '1 hour', now() - interval '10 days', 'submitted');

select pg_temp.act_as('service');
select set_config('pgtap.listed', (select coalesce(string_agg(invite_id::text, ',' order by invite_id), '') from public.list_candidates_past_retention(now(), 100)), true);
select pg_temp.act_as('owner');

select ok(pg_temp.fx('inv_a2')::text = any(string_to_array(current_setting('pgtap.listed'), ',')), 'lists an invite past its org''s 30 days');
select ok(pg_temp.fx('inv_b_old')::text = any(string_to_array(current_setting('pgtap.listed'), ',')), 'lists an invite past its org''s 90 days');
select ok(not pg_temp.fx('inv_b')::text = any(string_to_array(current_setting('pgtap.listed'), ',')), 'keeps an invite inside its org''s 90 days');
select ok(not pg_temp.fx('inv_b_recent')::text = any(string_to_array(current_setting('pgtap.listed'), ',')), 'keeps an old invite with recent activity');
select is((select count(*)::int from public.list_candidates_past_retention(now(), 1)), 1, 'the limit caps the batch');
select is((select count(*)::int from public.list_candidates_past_retention(now() - interval '1000 days', 100)), 0, 'nothing is past retention in the past');

-- ---------------------------------------------------------------------------
-- The cron purge
-- ---------------------------------------------------------------------------

select is(pg_temp.try_as('service', $$ select public.purge_candidate_for_retention(pg_temp.fx('inv_b'), now()) $$), '22023',
  'the cron purge refuses an invite that is still inside retention');

select pg_temp.act_as('service');
select public.purge_candidate_for_retention(pg_temp.fx('inv_a2'), now());
select pg_temp.act_as('owner');
select is((select count(*)::int from public.invites where id = pg_temp.fx('inv_a2')), 0, 'the cron purge deletes the invite');
select is(
  (select count(*)::int from public.audit_log
   where org_id = pg_temp.fx('org_a') and action = 'retention_purge' and actor_id is null and target = 'invite:' || pg_temp.fx('inv_a2')::text),
  1, 'the cron purge is audited with no actor');

select * from finish();
rollback;
