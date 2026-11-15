-- Retention and delete on request (docs/02 Compliance): the per-org media and
-- results retention settings, private.purge_candidate, the admin-only
-- delete_candidate_data, and the service-only functions the daily cron calls
-- for each clock.
begin;
\ir fixtures/setup.psql

select plan(102);

update public.invites set candidate_name = 'Ada Candidate' where id = pg_temp.fx('inv_a');
insert into storage.objects (bucket_id, name)
values ('proctoring', pg_temp.fx('org_a')::text || '/' || pg_temp.fx('att_a')::text || '/screen/1.jpg');

-- ---------------------------------------------------------------------------
-- Functions exist, are security definer, and are granted to the right roles
-- ---------------------------------------------------------------------------

select has_function('private', 'purge_candidate', array['uuid'], 'private.purge_candidate(uuid) exists');
select has_function('public', 'delete_candidate_data', array['uuid'], 'public.delete_candidate_data(uuid) exists');
select has_function('public', 'set_retention', array['uuid', 'integer', 'integer'], 'public.set_retention(uuid, int, int) exists');
select hasnt_function('public', 'set_retention_days', array['uuid', 'integer'], 'the single-clock setter is gone');
select hasnt_function('private', 'retention_days', array['uuid'], 'the single-clock reader is gone');
select has_function('public', 'list_candidates_past_retention', array['timestamp with time zone', 'integer'], 'cron listing exists');
select has_function('public', 'purge_candidate_for_retention', array['uuid', 'timestamp with time zone'], 'cron purge exists');
select has_function('public', 'list_media_past_retention', array['timestamp with time zone', 'integer'], 'cron media listing exists');
select has_function('public', 'purge_media_for_retention', array['uuid', 'timestamp with time zone'], 'cron media purge exists');
select has_function('private', 'media_retention_days', array['uuid'], 'private.media_retention_days(uuid) exists');
select has_function('private', 'results_retention_days', array['uuid'], 'private.results_retention_days(uuid) exists');

select is_definer('private', 'purge_candidate', array['uuid'], 'purge_candidate is security definer');
select is_definer('public', 'delete_candidate_data', array['uuid'], 'delete_candidate_data is security definer');
select is_definer('public', 'set_retention', array['uuid', 'integer', 'integer'], 'set_retention is security definer');
select is_definer('public', 'list_media_past_retention', array['timestamp with time zone', 'integer'], 'media listing is security definer');
select is_definer('public', 'purge_media_for_retention', array['uuid', 'timestamp with time zone'], 'media purge is security definer');
select is_definer('public', 'list_candidates_past_retention', array['timestamp with time zone', 'integer'], 'listing is security definer');
select is_definer('public', 'purge_candidate_for_retention', array['uuid', 'timestamp with time zone'], 'cron purge is security definer');

select ok(not has_function_privilege('anon', 'public.delete_candidate_data(uuid)', 'execute'), 'anon cannot execute delete_candidate_data');
select ok(has_function_privilege('authenticated', 'public.delete_candidate_data(uuid)', 'execute'), 'authenticated can execute delete_candidate_data');
select ok(not has_function_privilege('anon', 'public.set_retention(uuid, integer, integer)', 'execute'), 'anon cannot execute set_retention');
select ok(not has_function_privilege('anon', 'private.purge_candidate(uuid)', 'execute'), 'anon cannot execute purge_candidate');
select ok(not has_function_privilege('authenticated', 'private.purge_candidate(uuid)', 'execute'), 'authenticated cannot call purge_candidate directly');
select ok(not has_function_privilege('authenticated', 'public.list_candidates_past_retention(timestamptz, integer)', 'execute'), 'authenticated cannot list for the cron');
select ok(not has_function_privilege('anon', 'public.list_candidates_past_retention(timestamptz, integer)', 'execute'), 'anon cannot list for the cron');
select ok(not has_function_privilege('authenticated', 'public.purge_candidate_for_retention(uuid, timestamptz)', 'execute'), 'authenticated cannot run the cron purge');
select ok(not has_function_privilege('anon', 'public.purge_candidate_for_retention(uuid, timestamptz)', 'execute'), 'anon cannot run the cron purge');
select ok(has_function_privilege('service_role', 'public.list_candidates_past_retention(timestamptz, integer)', 'execute'), 'service role can list');
select ok(has_function_privilege('service_role', 'public.purge_candidate_for_retention(uuid, timestamptz)', 'execute'), 'service role can purge');
select ok(not has_function_privilege('authenticated', 'public.list_media_past_retention(timestamptz, integer)', 'execute'), 'authenticated cannot list media for the cron');
select ok(not has_function_privilege('anon', 'public.list_media_past_retention(timestamptz, integer)', 'execute'), 'anon cannot list media for the cron');
select ok(not has_function_privilege('authenticated', 'public.purge_media_for_retention(uuid, timestamptz)', 'execute'), 'authenticated cannot run the media purge');
select ok(not has_function_privilege('anon', 'public.purge_media_for_retention(uuid, timestamptz)', 'execute'), 'anon cannot run the media purge');
select ok(has_function_privilege('service_role', 'public.list_media_past_retention(timestamptz, integer)', 'execute'), 'service role can list media');
select ok(has_function_privilege('service_role', 'public.purge_media_for_retention(uuid, timestamptz)', 'execute'), 'service role can purge media');

-- ---------------------------------------------------------------------------
-- Retention settings: defaults and bounds
-- ---------------------------------------------------------------------------

select is(private.media_retention_days(pg_temp.fx('org_a')), 90, 'default media retention is 90 days');
select is(private.results_retention_days(pg_temp.fx('org_a')), 365, 'default results retention is 365 days');

select throws_ok(
  $$ update public.organizations set settings = settings || '{"media_retention_days": 29}' where id = pg_temp.fx('org_a') $$,
  '23514', null, 'media retention below 30 days is rejected by the table');
select throws_ok(
  $$ update public.organizations set settings = settings || '{"media_retention_days": 366, "results_retention_days": 730}' where id = pg_temp.fx('org_a') $$,
  '23514', null, 'media retention above 365 days is rejected by the table');
select throws_ok(
  $$ update public.organizations set settings = settings || '{"media_retention_days": 30, "results_retention_days": 29}' where id = pg_temp.fx('org_a') $$,
  '23514', null, 'results retention below 30 days is rejected by the table');
select throws_ok(
  $$ update public.organizations set settings = settings || '{"results_retention_days": 731}' where id = pg_temp.fx('org_a') $$,
  '23514', null, 'results retention above 730 days is rejected by the table');
select throws_ok(
  $$ update public.organizations set settings = settings || '{"media_retention_days": 200, "results_retention_days": 100}' where id = pg_temp.fx('org_a') $$,
  '23514', null, 'media kept longer than results is rejected by the table');
select throws_ok(
  $$ update public.organizations set settings = settings || '{"results_retention_days": 60}' where id = pg_temp.fx('org_a') $$,
  '23514', null, 'results shorter than the default media period is rejected');
select throws_ok(
  $$ update public.organizations set settings = settings || '{"media_retention_days": "ninety"}' where id = pg_temp.fx('org_a') $$,
  '23514', null, 'a non-number media retention is rejected');
select throws_ok(
  $$ update public.organizations set settings = settings || '{"results_retention_days": 400.5}' where id = pg_temp.fx('org_a') $$,
  '23514', null, 'a fractional results retention is rejected');
select throws_ok(
  $$ update public.organizations set settings = settings || '{"retention_days": 180}' where id = pg_temp.fx('org_a') $$,
  '23514', null, 'the old single retention key is rejected');
select lives_ok(
  $$ update public.organizations set settings = settings || '{"media_retention_days": 30, "results_retention_days": 30}' where id = pg_temp.fx('org_b') $$,
  '30 days for both is allowed');
select lives_ok(
  $$ update public.organizations set settings = settings || '{"media_retention_days": 365, "results_retention_days": 730}' where id = pg_temp.fx('org_b') $$,
  'the maximums are allowed');
select lives_ok(
  $$ update public.organizations set settings = settings || '{"media_retention_days": 120, "results_retention_days": 120}' where id = pg_temp.fx('org_b') $$,
  'media equal to results is allowed');
update public.organizations set settings = '{"viewers_see_media": true}' where id = pg_temp.fx('org_b');

select is(pg_temp.try_as('a_recruiter', $$ select public.set_retention(pg_temp.fx('org_a'), 60, 200) $$), '42501', 'a recruiter cannot change retention');
select is(pg_temp.try_as('a_viewer',    $$ select public.set_retention(pg_temp.fx('org_a'), 60, 200) $$), '42501', 'a viewer cannot change retention');
select is(pg_temp.try_as('b_admin',     $$ select public.set_retention(pg_temp.fx('org_a'), 60, 200) $$), '42501', 'another org''s admin cannot change retention');
select is(pg_temp.try_as('anon',        $$ select public.set_retention(pg_temp.fx('org_a'), 60, 200) $$), '42501', 'anon cannot change retention');
select is(pg_temp.try_as('a_admin',     $$ select public.set_retention(pg_temp.fx('org_a'), 10, 200) $$), '22023', 'set_retention rejects out-of-range media days');
select is(pg_temp.try_as('a_admin',     $$ select public.set_retention(pg_temp.fx('org_a'), 60, 800) $$), '22023', 'set_retention rejects out-of-range results days');
select is(pg_temp.try_as('a_admin',     $$ select public.set_retention(pg_temp.fx('org_a'), 200, 100) $$), '22023', 'set_retention rejects media longer than results');

select pg_temp.act_as('b_admin');
select public.set_retention(pg_temp.fx('org_b'), 30, 90);
select pg_temp.act_as('owner');
select is((select settings from public.organizations where id = pg_temp.fx('org_b')),
  '{"viewers_see_media": true, "media_retention_days": 30, "results_retention_days": 90}'::jsonb, 'an admin sets both periods and other settings are kept');
select is(private.media_retention_days(pg_temp.fx('org_b')), 30, 'media_retention_days reads the setting');
select is(private.results_retention_days(pg_temp.fx('org_b')), 90, 'results_retention_days reads the setting');
select ok(exists (select 1 from public.audit_log where org_id = pg_temp.fx('org_b') and action = 'changed_retention'
                    and actor_id = pg_temp.fx('b_admin') and target = 'media 30 days, results 90 days'),
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
-- The cron listing honours each org's results retention
-- ---------------------------------------------------------------------------

-- org A: 30 days. inv_a2 expired 40 days ago and was never started: past retention.
update public.organizations set settings = '{"media_retention_days": 30, "results_retention_days": 30}' where id = pg_temp.fx('org_a');
update public.invites set created_at = now() - interval '50 days', expires_at = now() - interval '40 days' where id = pg_temp.fx('inv_a2');
-- org B: results 90 days, media 30 (set above). inv_b expired 40 days ago: results still kept.
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

-- ---------------------------------------------------------------------------
-- The media clock: snapshots go first, the results stay
-- ---------------------------------------------------------------------------

-- att_b_recent has a snapshot from 10 days ago: inside org B's 30 media days.
insert into public.media (attempt_id, org_id, source, storage_path)
values (pg_temp.fx('att_b_recent'), pg_temp.fx('org_b'), 'screen', 'org-b/att-b-recent/1.jpg');

select pg_temp.act_as('service');
select set_config('pgtap.media', (select coalesce(string_agg(attempt_id::text, ',' order by attempt_id), '') from public.list_media_past_retention(now(), 100)), true);
select pg_temp.act_as('owner');

select ok(pg_temp.fx('att_b')::text = any(string_to_array(current_setting('pgtap.media'), ',')),
  'lists an attempt past its org''s 30 media days although its results are kept');
select ok(not pg_temp.fx('att_b_recent')::text = any(string_to_array(current_setting('pgtap.media'), ',')),
  'keeps an attempt''s media inside the media period');
select is((select count(*)::int from public.list_media_past_retention(now() - interval '1000 days', 100)), 0, 'no media is past retention in the past');

select is(pg_temp.try_as('service', $$ select public.purge_media_for_retention(pg_temp.fx('att_b_recent'), now()) $$), '22023',
  'the media purge refuses an attempt inside the media period');
select is(pg_temp.try_as('service', $$ select public.purge_media_for_retention(gen_random_uuid(), now()) $$), '22023',
  'the media purge refuses an unknown attempt');

select pg_temp.act_as('service');
select set_config('pgtap.media_paths', array_to_string(public.purge_media_for_retention(pg_temp.fx('att_b'), now()), ','), true);
select pg_temp.act_as('owner');

select is(current_setting('pgtap.media_paths'), 'org-b/att-b/1.jpg', 'the media purge returns the snapshot paths to remove');
select is((select count(*)::int from public.media where attempt_id = pg_temp.fx('att_b')), 0, 'media rows deleted');
select is((select count(*)::int from public.media where attempt_id = pg_temp.fx('att_b_recent')), 1, 'other attempts'' media kept');
select is(
  (select count(*)::int from public.invites where id = pg_temp.fx('inv_b'))
  + (select count(*)::int from public.attempts where id = pg_temp.fx('att_b'))
  + (select count(*)::int from public.step_responses where attempt_id = pg_temp.fx('att_b'))
  + (select count(*)::int from public.integrity_events where attempt_id = pg_temp.fx('att_b'))
  + (select count(*)::int from public.flags where attempt_id = pg_temp.fx('att_b'))
  + (select count(*)::int from public.notes where attempt_id = pg_temp.fx('att_b')),
  6, 'the media purge keeps the invite, attempt, answers, events, flags and notes');
select is(
  (select count(*)::int from public.audit_log
   where org_id = pg_temp.fx('org_b') and action = 'media_retention_purge' and actor_id is null and target = 'attempt:' || pg_temp.fx('att_b')::text),
  1, 'the media purge is audited with no actor');

select pg_temp.act_as('service');
select ok(not exists (select 1 from public.list_media_past_retention(now(), 100) where attempt_id = pg_temp.fx('att_b')),
  'a purged attempt is no longer listed');
select pg_temp.act_as('owner');

select * from finish();
rollback;
