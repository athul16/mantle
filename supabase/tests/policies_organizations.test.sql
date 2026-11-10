-- Policies on organizations and memberships, per actor and operation.
-- try_as returns rows affected ('0' = silently filtered by RLS) or the
-- SQLSTATE ('42501' = rejected by RLS or privileges); either way it undoes
-- the statement, so each assertion starts from the fixture.
begin;
\ir fixtures/setup.psql

select plan(55);

-- ---------------------------------------------------------------------------
-- organizations: select
-- ---------------------------------------------------------------------------

select is(pg_temp.count_as(who, $$select 1 from public.organizations where slug like 'pgtap-org-%'$$), 1,
          'organizations: ' || who || ' reads exactly one org')
from unnest(array['a_admin', 'a_recruiter', 'a_viewer', 'b_admin']) who;

select is(pg_temp.count_as(who, $$select 1 from public.organizations where id = pg_temp.fx('org_a')$$), 0,
          'organizations: ' || who || ' cannot read org A')
from unnest(array['b_admin', 'b_viewer', 'outsider', 'anon']) who;

select is(pg_temp.count_as('service', $$select 1 from public.organizations where slug like 'pgtap-org-%'$$), 2,
          'organizations: service role reads every org');

-- ---------------------------------------------------------------------------
-- organizations: insert (only through create_organization)
-- ---------------------------------------------------------------------------

select is(pg_temp.try_as(who, $$insert into public.organizations (name, slug) values ('direct', 'pgtap-direct')$$), '42501',
          'organizations: ' || who || ' cannot insert an org directly')
from unnest(array['a_admin', 'outsider', 'anon']) who;

select is(pg_temp.try_as('service', $$insert into public.organizations (name, slug) values ('direct', 'pgtap-direct')$$), '1',
          'organizations: service role can insert');

-- ---------------------------------------------------------------------------
-- organizations: update
-- ---------------------------------------------------------------------------

select is(pg_temp.try_as('a_admin', $$update public.organizations set name = 'Renamed', settings = '{"viewers_see_media":true}' where id = pg_temp.fx('org_a')$$), '1',
          'organizations: admin updates own org name and settings');
select is(pg_temp.try_as('a_admin', $$update public.organizations set slug = 'pgtap-org-a-new' where id = pg_temp.fx('org_a')$$), '1',
          'organizations: admin changes own org slug');

select is(pg_temp.try_as(who, $$update public.organizations set name = 'Hijacked' where id = pg_temp.fx('org_a')$$), '0',
          'organizations: ' || who || ' cannot update org A')
from unnest(array['a_recruiter', 'a_viewer', 'b_admin', 'outsider', 'anon']) who;

select is(pg_temp.try_as('a_admin', $$update public.organizations set name = 'Hijacked' where id = pg_temp.fx('org_b')$$), '0',
          'organizations: admin of A cannot update org B');
select is(pg_temp.try_as('service', $$update public.organizations set name = 'Svc' where id = pg_temp.fx('org_a')$$), '1',
          'organizations: service role can update');

-- ---------------------------------------------------------------------------
-- organizations: delete (no policy: nobody but the server)
-- ---------------------------------------------------------------------------

select is(pg_temp.try_as(who, $$delete from public.organizations where id = pg_temp.fx('org_a')$$), '0',
          'organizations: ' || who || ' cannot delete org A')
from unnest(array['a_admin', 'a_recruiter', 'b_admin', 'anon']) who;

select is(pg_temp.try_as('service', $$delete from public.organizations where id = pg_temp.fx('org_a')$$), '1',
          'organizations: service role can delete');

-- ---------------------------------------------------------------------------
-- memberships: select
-- ---------------------------------------------------------------------------

select is(pg_temp.count_as(who, $$select 1 from public.memberships where org_id in (pg_temp.fx('org_a'), pg_temp.fx('org_b'))$$), 3,
          'memberships: ' || who || ' sees the three org A teammates and no one else')
from unnest(array['a_admin', 'a_recruiter', 'a_viewer']) who;

select is(pg_temp.count_as('b_admin', $$select 1 from public.memberships where org_id in (pg_temp.fx('org_a'), pg_temp.fx('org_b'))$$), 2,
          'memberships: org B admin sees only org B memberships');
select is(pg_temp.count_as('outsider', $$select 1 from public.memberships$$), 0,
          'memberships: a user with no membership sees none');

-- ---------------------------------------------------------------------------
-- memberships: insert
-- ---------------------------------------------------------------------------

select is(pg_temp.try_as('a_admin', $$insert into public.memberships (org_id, user_id, role) values (pg_temp.fx('org_a'), pg_temp.fx('outsider'), 'viewer')$$), '1',
          'memberships: admin adds a teammate to own org');

select is(pg_temp.try_as(who, $$insert into public.memberships (org_id, user_id, role) values (pg_temp.fx('org_a'), pg_temp.fx('outsider'), 'viewer')$$), '42501',
          'memberships: ' || who || ' cannot add a teammate to org A')
from unnest(array['a_recruiter', 'a_viewer', 'b_admin', 'anon']) who;

select is(pg_temp.try_as('outsider', $$insert into public.memberships (org_id, user_id, role) values (pg_temp.fx('org_a'), pg_temp.fx('outsider'), 'admin')$$), '42501',
          'memberships: a stranger cannot make themselves admin of org A');
select is(pg_temp.try_as('a_admin', $$insert into public.memberships (org_id, user_id, role) values (pg_temp.fx('org_b'), pg_temp.fx('a_admin'), 'admin')$$), '42501',
          'memberships: admin of A cannot join org B');
select is(pg_temp.try_as('service', $$insert into public.memberships (org_id, user_id, role) values (pg_temp.fx('org_a'), pg_temp.fx('outsider'), 'viewer')$$), '1',
          'memberships: service role can insert');

-- ---------------------------------------------------------------------------
-- memberships: update
-- ---------------------------------------------------------------------------

select is(pg_temp.try_as('a_admin', $$update public.memberships set role = 'recruiter' where org_id = pg_temp.fx('org_a') and user_id = pg_temp.fx('a_viewer')$$), '1',
          'memberships: admin changes a teammate''s role');
select is(pg_temp.try_as('a_recruiter', $$update public.memberships set role = 'admin' where user_id = pg_temp.fx('a_recruiter')$$), '0',
          'memberships: recruiter cannot promote themselves');
select is(pg_temp.try_as('a_viewer', $$update public.memberships set role = 'admin' where user_id = pg_temp.fx('a_viewer')$$), '0',
          'memberships: viewer cannot promote themselves');
select is(pg_temp.try_as('b_admin', $$update public.memberships set role = 'viewer' where org_id = pg_temp.fx('org_a')$$), '0',
          'memberships: admin of B cannot change org A roles');
select is(pg_temp.try_as('a_admin', $$update public.memberships set org_id = pg_temp.fx('org_b') where org_id = pg_temp.fx('org_a') and user_id = pg_temp.fx('a_viewer')$$), '42501',
          'memberships: admin cannot move a membership into another org');
-- Provisional: the last admin can demote themselves; keeping one admin is
-- checked in app code (open decision Q4).
select is(pg_temp.try_as('a_admin', $$update public.memberships set role = 'viewer' where user_id = pg_temp.fx('a_admin')$$), '1',
          'memberships: the database lets an admin demote themselves (Q4: app enforces one admin)');

-- ---------------------------------------------------------------------------
-- memberships: delete
-- ---------------------------------------------------------------------------

select is(pg_temp.try_as('a_admin', $$delete from public.memberships where org_id = pg_temp.fx('org_a') and user_id = pg_temp.fx('a_viewer')$$), '1',
          'memberships: admin removes a teammate');
select is(pg_temp.try_as(who, $$delete from public.memberships where org_id = pg_temp.fx('org_a') and user_id = pg_temp.fx('a_viewer')$$), '0',
          'memberships: ' || who || ' cannot remove an org A teammate')
from unnest(array['a_recruiter', 'b_admin', 'outsider', 'anon']) who;
select is(pg_temp.try_as('a_viewer', $$delete from public.memberships where user_id = pg_temp.fx('a_viewer')$$), '0',
          'memberships: a viewer cannot remove their own membership');
select is(pg_temp.try_as('service', $$delete from public.memberships where org_id = pg_temp.fx('org_a') and user_id = pg_temp.fx('a_viewer')$$), '1',
          'memberships: service role can delete');

-- A removed member loses access immediately.
delete from public.memberships where org_id = pg_temp.fx('org_a') and user_id = pg_temp.fx('a_viewer');
select is(pg_temp.count_as('a_viewer', $$select 1 from public.organizations where id = pg_temp.fx('org_a')$$), 0,
          'memberships: after removal the user no longer sees the org');
select is(pg_temp.count_as('a_viewer', $$select 1 from public.jobs where org_id = pg_temp.fx('org_a')$$), 0,
          'memberships: after removal the user no longer sees the org''s jobs');

select * from finish();
rollback;
