-- public.profiles (decision D13 / Q5): synced from auth.users by a trigger that
-- can never block sign-up, readable only for yourself and people who share a
-- company with you, and written by nobody but the trigger and the server.
begin;
\ir fixtures/setup.psql

select plan(16);

-- ---------------------------------------------------------------------------
-- Sync
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.profiles p join auth.users u on u.id = p.id
    where u.email like 'pgtap-%' and p.email = u.email),
  6,
  'every new auth user gets a profile with their email'
);

update auth.users set email = 'pgtap-renamed@example.test' where id = pg_temp.fx('a_viewer');
select is((select email from public.profiles where id = pg_temp.fx('a_viewer')), 'pgtap-renamed@example.test',
          'an email change is copied to the profile');

update auth.users set invited_at = now() - interval '1 day' where id = pg_temp.fx('a_recruiter');
select ok((select invited_at is not null and first_sign_in_at is null from public.profiles where id = pg_temp.fx('a_recruiter')),
          'an invited user who has not signed in yet shows as pending');

update auth.users set last_sign_in_at = '2026-11-01 10:00+00' where id = pg_temp.fx('a_recruiter');
update auth.users set last_sign_in_at = '2026-11-05 10:00+00' where id = pg_temp.fx('a_recruiter');
select is((select first_sign_in_at from public.profiles where id = pg_temp.fx('a_recruiter')), '2026-11-01 10:00+00'::timestamptz,
          'the first sign-in is kept; later sign-ins do not move it');

-- A broken profile write must not block the auth.users write (sign-up, invite, sign-in).
alter table public.profiles add constraint pgtap_reject_all check (email is null) not valid;
select lives_ok(
  $$ insert into auth.users (id, email) values (pg_temp.fx('blocked'), 'pgtap-blocked@example.test') $$,
  'sign-up still succeeds when the profile write fails'
);
select is((select count(*)::int from public.profiles where id = pg_temp.fx('blocked')), 0,
          '... and simply leaves no profile row');
select lives_ok(
  $$ update auth.users set email = 'pgtap-blocked2@example.test', last_sign_in_at = now() where id = pg_temp.fx('a_admin') $$,
  'sign-in and email changes still succeed when the profile write fails'
);
alter table public.profiles drop constraint pgtap_reject_all;

delete from auth.users where id = pg_temp.fx('blocked');
select is((select count(*)::int from public.profiles where id = pg_temp.fx('outsider')), 1, 'the outsider has a profile');
delete from public.memberships where user_id = pg_temp.fx('outsider');
delete from auth.users where id = pg_temp.fx('outsider');
select is((select count(*)::int from public.profiles where id = pg_temp.fx('outsider')), 0,
          'deleting the auth user deletes the profile');
insert into auth.users (id, email) values (pg_temp.fx('outsider'), 'pgtap-outsider@example.test');

-- ---------------------------------------------------------------------------
-- Who reads which profiles
-- ---------------------------------------------------------------------------

select set_eq(
  $$ select id from public.profiles where id in (select pg_temp.fx(n) from unnest(array['a_admin','a_recruiter','a_viewer','b_admin','b_viewer','outsider']) n) $$,
  $$ values (pg_temp.fx('a_admin')), (pg_temp.fx('a_recruiter')), (pg_temp.fx('a_viewer')), (pg_temp.fx('b_admin')), (pg_temp.fx('b_viewer')), (pg_temp.fx('outsider')) $$,
  'the owner sees every fixture profile (sanity)'
);
select is(pg_temp.count_as('a_viewer', $$select 1 from public.profiles$$), 3,
          'a member reads the profiles of their own company (themselves included)');
select is(pg_temp.count_as('b_admin', $$select 1 from public.profiles where id in (pg_temp.fx('a_admin'), pg_temp.fx('a_recruiter'), pg_temp.fx('a_viewer'))$$), 0,
          'a member of another company reads none of them');
select is(pg_temp.count_as('outsider', $$select 1 from public.profiles$$), 1,
          'someone with no company reads only their own profile');

-- Joining a second company shows those teammates too; leaving hides them again.
insert into public.memberships (org_id, user_id, role) values (pg_temp.fx('org_b'), pg_temp.fx('a_viewer'), 'viewer');
select is(pg_temp.count_as('a_viewer', $$select 1 from public.profiles$$), 5,
          'a member of two companies reads both teams');
delete from public.memberships where org_id = pg_temp.fx('org_b') and user_id = pg_temp.fx('a_viewer');

-- ---------------------------------------------------------------------------
-- Nobody but the trigger and the server writes profiles
-- ---------------------------------------------------------------------------

select is(pg_temp.try_as('a_admin', $$update public.profiles set email = 'x@example.test' where id = pg_temp.fx('a_viewer')$$), '42501',
          'an admin cannot edit a teammate''s profile');
select is(pg_temp.try_as('a_viewer', $$update public.profiles set email = 'x@example.test' where id = pg_temp.fx('a_viewer')$$), '42501',
          'a user cannot edit their own profile directly (it follows auth.users)');

select * from finish();
rollback;
