-- D9: per-invite accommodations (invite_accommodations, written only through
-- set_invite_accommodations) and the company contact email
-- (organizations.settings->'contact_email', set through set_contact_email).
begin;
\ir fixtures/setup.psql

select plan(27);

-- Accommodations ------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.invite_accommodations'::regclass),
  'invite_accommodations: row level security is enabled'
);

-- inv_a2 has no attempt yet; inv_a has one in progress.
select pg_temp.act_as('a_recruiter');
select lives_ok(
  $$ select public.set_invite_accommodations(pg_temp.fx('inv_a2'), 50, true, false) $$,
  'a recruiter sets extra time and a camera waiver'
);
select pg_temp.act_as('owner');

select results_eq(
  $$ select extra_time_percent, waive_camera, waive_screen, set_by from public.invite_accommodations where invite_id = pg_temp.fx('inv_a2') $$,
  $$ values (50, true, false, pg_temp.fx('a_recruiter')) $$,
  'the accommodation is stored with who set it'
);
select is(
  (select count(*)::int from public.audit_log
    where org_id = pg_temp.fx('org_a') and action = 'set_accommodations'
      and actor_id = pg_temp.fx('a_recruiter')
      and target = 'invite:' || pg_temp.fx('inv_a2') || ' extra_time=+50% waive_camera=true waive_screen=false'),
  1,
  'setting an accommodation is written to the audit log'
);

select pg_temp.act_as('a_admin');
select lives_ok(
  $$ select public.set_invite_accommodations(pg_temp.fx('inv_a2'), 100, true, true) $$,
  'an admin changes it before the candidate starts'
);
select pg_temp.act_as('owner');
select results_eq(
  $$ select extra_time_percent, waive_camera, waive_screen from public.invite_accommodations where invite_id = pg_temp.fx('inv_a2') $$,
  $$ values (100, true, true) $$,
  'the change replaces the row'
);
select is(
  (select count(*)::int from public.audit_log where org_id = pg_temp.fx('org_a') and action = 'set_accommodations'),
  2,
  'every change is audited'
);

select is(
  pg_temp.try_as('a_viewer', $$ select public.set_invite_accommodations('$$ || pg_temp.fx('inv_a2') || $$', 25, false, false) $$),
  '42501',
  'a viewer can''t set accommodations'
);
select is(
  pg_temp.try_as('b_admin', $$ select public.set_invite_accommodations('$$ || pg_temp.fx('inv_a2') || $$', 25, false, false) $$),
  '42501',
  'another company''s admin can''t set accommodations'
);
select is(
  pg_temp.try_as('anon', $$ select public.set_invite_accommodations('$$ || pg_temp.fx('inv_a2') || $$', 25, false, false) $$),
  '42501',
  'anonymous callers can''t set accommodations'
);
select is(
  pg_temp.try_as('a_recruiter', $$ select public.set_invite_accommodations('$$ || pg_temp.fx('inv_a2') || $$', 30, false, false) $$),
  '22023',
  'extra time other than 0, 25, 50 or 100 percent is refused'
);
select is(
  pg_temp.try_as('a_recruiter', $$ select public.set_invite_accommodations('$$ || pg_temp.fx('inv_a') || $$', 25, false, false) $$),
  '55000',
  'accommodations are fixed once the candidate has started'
);
select is(
  pg_temp.try_as('a_recruiter', $$
    insert into public.invite_accommodations (invite_id, org_id, extra_time_percent, waive_camera)
    values ('$$ || pg_temp.fx('inv_a') || $$', '$$ || pg_temp.fx('org_a') || $$', 100, true) $$),
  '42501',
  'a recruiter can''t write the table directly (no audit row would be written)'
);
select is(
  pg_temp.try_as('a_admin', $$ update public.invite_accommodations set waive_screen = false $$),
  '42501',
  'an admin can''t update the table directly'
);
select is(
  pg_temp.try_as('a_admin', $$ delete from public.invite_accommodations $$),
  '42501',
  'an admin can''t delete rows directly'
);

select is(pg_temp.count_as('a_viewer', 'select 1 from public.invite_accommodations'), 1, 'a viewer of the company reads its accommodations (report)');
select is(pg_temp.count_as('b_admin', 'select 1 from public.invite_accommodations'), 0, 'another company reads none');
select is(pg_temp.count_as('outsider', 'select 1 from public.invite_accommodations'), 0, 'a user with no membership reads none');
select is(pg_temp.count_as('anon', 'select 1 from public.invite_accommodations'), 0, 'anonymous visitors read none');

delete from public.invites where id = pg_temp.fx('inv_a2');
select is(
  (select count(*)::int from public.invite_accommodations where invite_id = pg_temp.fx('inv_a2')),
  0,
  'deleting the invite deletes its accommodations'
);

-- Contact email -------------------------------------------------------------

select pg_temp.act_as('a_admin');
select is(
  public.set_contact_email(pg_temp.fx('org_a'), '  Hiring@Example.TEST '),
  'hiring@example.test',
  'an admin sets the contact email (trimmed, lower-cased)'
);
select pg_temp.act_as('owner');
select is(
  (select settings ->> 'contact_email' from public.organizations where id = pg_temp.fx('org_a')),
  'hiring@example.test',
  'stored in organizations.settings'
);
select is(
  (select count(*)::int from public.audit_log where org_id = pg_temp.fx('org_a') and action = 'changed_contact_email' and target = 'hiring@example.test'),
  1,
  'the change is audited'
);
select is(
  pg_temp.try_as('a_recruiter', $$ select public.set_contact_email('$$ || pg_temp.fx('org_a') || $$', 'r@example.test') $$),
  '42501',
  'a recruiter can''t change the contact email'
);
select is(
  pg_temp.try_as('a_admin', $$ select public.set_contact_email('$$ || pg_temp.fx('org_a') || $$', 'not an email') $$),
  '22023',
  'an invalid email is refused'
);
select is(
  pg_temp.try_as('a_admin', $$ update public.organizations set settings = settings || '{"contact_email": "nope"}' where id = '$$ || pg_temp.fx('org_a') || $$' $$),
  '23514',
  'a direct settings write with a bad email breaks the check constraint'
);

select pg_temp.act_as('a_admin');
select is(public.set_contact_email(pg_temp.fx('org_a'), ''), null, 'a blank email clears it');
select pg_temp.act_as('owner');

select * from finish();
rollback;
