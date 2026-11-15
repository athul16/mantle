-- D12: invites.last_sent_at / sent_count (S1) and one live invite per email
-- per job (S2, partial unique index invites_job_email_live_key).
begin;
\ir fixtures/setup.psql

select plan(13);

-- S1 ------------------------------------------------------------------------

select col_not_null('public', 'invites', 'last_sent_at', 'last_sent_at is not null');
select col_default_is('public', 'invites', 'sent_count', '1', 'sent_count starts at 1');
select is(
  (select sent_count from public.invites where id = pg_temp.fx('inv_a2')),
  1,
  'a new invite has sent_count 1'
);
select ok(
  (select last_sent_at is not null from public.invites where id = pg_temp.fx('inv_a2')),
  'a new invite gets last_sent_at'
);
select is(
  pg_temp.try_as('a_recruiter', $$ update public.invites set sent_count = 0 where id = '$$ || pg_temp.fx('inv_a2') || $$' $$),
  '23514',
  'sent_count can''t drop below 1'
);
select is(
  pg_temp.try_as('a_recruiter', $$ update public.invites set sent_count = 2, last_sent_at = now() where id = '$$ || pg_temp.fx('inv_a2') || $$' $$),
  '1',
  'a recruiter records a resend'
);
select is(
  pg_temp.try_as('b_admin', $$ update public.invites set sent_count = 9 where id = '$$ || pg_temp.fx('inv_a2') || $$' $$),
  '0',
  'another company can''t touch the send count'
);

-- S2 ------------------------------------------------------------------------

select has_index('public', 'invites', 'invites_job_email_live_key', 'unique index on live invites exists');

-- Same job, same email in another case, while the first is still invited.
select is(
  pg_temp.try_as('a_recruiter', $$
    insert into public.invites (org_id, job_id, email, expires_at)
    values ('$$ || pg_temp.fx('org_a') || $$', '$$ || pg_temp.fx('job_a') || $$', 'CAND-A2@example.test', now() + interval '1 day') $$),
  '23505',
  'a second live invite for the same email and job is refused (case-insensitive)'
);

-- inv_a is started-equivalent (has an in-progress attempt) but its status is
-- still invited in the fixture; mark it started and try again.
update public.invites set status = 'started' where id = pg_temp.fx('inv_a');
select is(
  pg_temp.try_as('a_recruiter', $$
    insert into public.invites (org_id, job_id, email, expires_at)
    values ('$$ || pg_temp.fx('org_a') || $$', '$$ || pg_temp.fx('job_a') || $$', 'cand-a@example.test', now() + interval '1 day') $$),
  '23505',
  'a started invite also blocks a new one'
);

-- After revoke or expiry the email can be invited again.
update public.invites set status = 'revoked' where id = pg_temp.fx('inv_a2');
select is(
  pg_temp.try_as('a_recruiter', $$
    insert into public.invites (org_id, job_id, email, expires_at)
    values ('$$ || pg_temp.fx('org_a') || $$', '$$ || pg_temp.fx('job_a') || $$', 'cand-a2@example.test', now() + interval '1 day') $$),
  '1',
  're-inviting after a revoke works'
);
update public.invites set status = 'expired' where id = pg_temp.fx('inv_a2');
select is(
  pg_temp.try_as('a_recruiter', $$
    insert into public.invites (org_id, job_id, email, expires_at)
    values ('$$ || pg_temp.fx('org_a') || $$', '$$ || pg_temp.fx('job_a') || $$', 'cand-a2@example.test', now() + interval '1 day') $$),
  '1',
  're-inviting after an expiry works'
);

-- The index is per job: the same email in another company's job is fine.
select is(
  pg_temp.try_as('b_admin', $$
    insert into public.invites (org_id, job_id, email, expires_at)
    values ('$$ || pg_temp.fx('org_b') || $$', '$$ || pg_temp.fx('job_b') || $$', 'cand-a2@example.test', now() + interval '1 day') $$),
  '1',
  'the same email can be invited to another job'
);

select * from finish();
rollback;
