-- Policies on company content: scenarios, assessments, jobs, invites.
-- Members read their org's rows; admins and recruiters write; viewers,
-- other orgs and anonymous visitors don't. Library scenarios (org_id null)
-- are readable once published and never writable by company users.
begin;
\ir fixtures/setup.psql

select plan(92);

-- ---------------------------------------------------------------------------
-- scenarios
-- ---------------------------------------------------------------------------

select is(pg_temp.count_as(who, $$select 1 from public.scenarios where slug like 'pgtap-%'$$), n,
          'scenarios: ' || who || ' reads ' || n || ' (' || what || ')')
from (values
  ('a_admin',     3, 'published library + both of org A''s'),
  ('a_recruiter', 3, 'published library + both of org A''s'),
  ('a_viewer',    3, 'published library + both of org A''s'),
  ('b_admin',     2, 'published library + org B''s'),
  ('outsider',    1, 'published library only'),
  ('anon',        0, 'nothing'),
  ('service',     5, 'everything')
) t(who, n, what);

select is(pg_temp.count_as('a_admin', $$select 1 from public.scenarios where id = pg_temp.fx('lib_draft')$$), 0,
          'scenarios: unpublished library scenarios are hidden from company users');
select is(pg_temp.count_as('a_admin', $$select 1 from public.scenarios where id = pg_temp.fx('scn_b')$$), 0,
          'scenarios: another org''s scenario is hidden');

select is(pg_temp.try_as(who, $$insert into public.scenarios (org_id, slug, title, role_family, definition) values (pg_temp.fx('org_a'), 'pgtap-new', 'n', 'accounting', '{}')$$), r,
          'scenarios: ' || who || ' inserting into org A -> ' || r)
from (values ('a_admin', '1'), ('a_recruiter', '1'), ('a_viewer', '42501'), ('b_admin', '42501'),
             ('outsider', '42501'), ('anon', '42501'), ('service', '1')) t(who, r);

select is(pg_temp.try_as('a_admin', $$insert into public.scenarios (org_id, slug, title, role_family, definition) values (null, 'pgtap-new', 'n', 'accounting', '{}')$$), '42501',
          'scenarios: a company admin cannot add to the platform library');

select is(pg_temp.try_as(who, $$update public.scenarios set title = 'edited' where id = pg_temp.fx('scn_a')$$), r,
          'scenarios: ' || who || ' updating an org A draft -> ' || r)
from (values ('a_admin', '1'), ('a_recruiter', '1'), ('a_viewer', '0'), ('b_admin', '0'), ('anon', '0')) t(who, r);

select is(pg_temp.try_as('a_admin', $$update public.scenarios set title = 'edited' where id = pg_temp.fx('lib_draft')$$), '0',
          'scenarios: a company admin cannot edit a library scenario');
select is(pg_temp.try_as('a_admin', $$update public.scenarios set org_id = pg_temp.fx('org_b') where id = pg_temp.fx('scn_a')$$), '42501',
          'scenarios: cannot move an own scenario to another org');
select is(pg_temp.try_as('a_admin', $$update public.scenarios set org_id = null where id = pg_temp.fx('scn_a')$$), '42501',
          'scenarios: cannot move an own scenario into the platform library');

select is(pg_temp.try_as(who, $$delete from public.scenarios where id = pg_temp.fx('scn_a')$$), r,
          'scenarios: ' || who || ' deleting an org A draft -> ' || r)
from (values ('a_recruiter', '1'), ('a_viewer', '0'), ('b_admin', '0'), ('anon', '0')) t(who, r);
select is(pg_temp.try_as('a_admin', $$delete from public.scenarios where id = pg_temp.fx('lib_draft')$$), '0',
          'scenarios: a company admin cannot delete a library scenario');

-- ---------------------------------------------------------------------------
-- assessments
-- ---------------------------------------------------------------------------

select is(pg_temp.count_as(who, $$select 1 from public.assessments where org_id in (pg_temp.fx('org_a'), pg_temp.fx('org_b'))$$), n,
          'assessments: ' || who || ' reads ' || n)
from (values ('a_admin', 2), ('a_recruiter', 2), ('a_viewer', 2), ('b_admin', 1), ('outsider', 0), ('anon', 0)) t(who, n);

select is(pg_temp.try_as(who, $$insert into public.assessments (org_id, scenario_id, title, time_limit_minutes) values (pg_temp.fx('org_a'), pg_temp.fx('lib_pub'), 'n', 30)$$), r,
          'assessments: ' || who || ' inserting into org A -> ' || r)
from (values ('a_admin', '1'), ('a_recruiter', '1'), ('a_viewer', '42501'), ('b_admin', '42501'),
             ('anon', '42501'), ('service', '1')) t(who, r);

select is(pg_temp.try_as('a_recruiter', $$insert into public.assessments (org_id, scenario_id, title, time_limit_minutes) values (pg_temp.fx('org_a'), pg_temp.fx('scn_a'), 'n', 30)$$), '1',
          'assessments: can use an own org scenario');

-- BUG: the scenario_id foreign key doesn't check the scenario's org, and FK
-- checks ignore RLS, so org A can build an assessment on org B's private scenario.
select todo('assessments.scenario_id accepts another org''s private scenario', 1);
select isnt(pg_temp.try_as('a_recruiter', $$insert into public.assessments (org_id, scenario_id, title, time_limit_minutes) values (pg_temp.fx('org_a'), pg_temp.fx('scn_b'), 'n', 30)$$), '1',
            'assessments: cannot use another org''s private scenario');

select is(pg_temp.try_as(who, $$update public.assessments set title = 'edited' where id = pg_temp.fx('asm_a')$$), r,
          'assessments: ' || who || ' updating an org A assessment -> ' || r)
from (values ('a_admin', '1'), ('a_recruiter', '1'), ('a_viewer', '0'), ('b_admin', '0'), ('anon', '0')) t(who, r);

select is(pg_temp.try_as('a_admin', $$update public.assessments set org_id = pg_temp.fx('org_b') where id = pg_temp.fx('asm_a_locked')$$), '42501',
          'assessments: cannot move an assessment to another org');

select is(pg_temp.try_as(who, $$delete from public.assessments where id = pg_temp.fx('asm_a_locked')$$), r,
          'assessments: ' || who || ' deleting an org A assessment -> ' || r)
from (values ('a_recruiter', '1'), ('a_viewer', '0'), ('b_admin', '0'), ('anon', '0')) t(who, r);

-- ---------------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------------

select is(pg_temp.count_as(who, $$select 1 from public.jobs where org_id in (pg_temp.fx('org_a'), pg_temp.fx('org_b'))$$), n,
          'jobs: ' || who || ' reads ' || n)
from (values ('a_admin', 1), ('a_viewer', 1), ('b_admin', 1), ('outsider', 0), ('anon', 0)) t(who, n);

select is(pg_temp.try_as(who, $$insert into public.jobs (org_id, title, assessment_id) values (pg_temp.fx('org_a'), 'n', pg_temp.fx('asm_a'))$$), r,
          'jobs: ' || who || ' inserting into org A -> ' || r)
from (values ('a_admin', '1'), ('a_recruiter', '1'), ('a_viewer', '42501'), ('b_admin', '42501'),
             ('anon', '42501'), ('service', '1')) t(who, r);

select is(pg_temp.try_as('a_recruiter', $$update public.jobs set title = 'edited' where id = pg_temp.fx('job_a')$$), '1',
          'jobs: recruiter edits an own job');
select is(pg_temp.try_as(who, $$update public.jobs set title = 'edited' where id = pg_temp.fx('job_a')$$), '0',
          'jobs: ' || who || ' cannot edit org A''s job')
from unnest(array['a_viewer', 'b_admin', 'anon']) who;
select is(pg_temp.try_as('a_admin', $$update public.jobs set org_id = pg_temp.fx('org_b') where id = pg_temp.fx('job_a')$$), '42501',
          'jobs: cannot move a job to another org');

select is(pg_temp.try_as(who, $$delete from public.jobs where id = pg_temp.fx('job_a')$$), r,
          'jobs: ' || who || ' deleting org A''s job -> ' || r)
from (values ('a_recruiter', '1'), ('a_viewer', '0'), ('b_admin', '0')) t(who, r);

-- ---------------------------------------------------------------------------
-- invites
-- ---------------------------------------------------------------------------

select is(pg_temp.count_as(who, $$select 1 from public.invites where org_id in (pg_temp.fx('org_a'), pg_temp.fx('org_b'))$$), n,
          'invites: ' || who || ' reads ' || n)
from (values ('a_admin', 2), ('a_viewer', 2), ('b_admin', 1), ('outsider', 0), ('anon', 0)) t(who, n);

select is(pg_temp.try_as(who, $$insert into public.invites (org_id, job_id, email, expires_at) values (pg_temp.fx('org_a'), pg_temp.fx('job_a'), 'new@example.test', now() + interval '1 day')$$), r,
          'invites: ' || who || ' inviting to org A''s job -> ' || r)
from (values ('a_admin', '1'), ('a_recruiter', '1'), ('a_viewer', '42501'), ('b_admin', '42501'),
             ('anon', '42501'), ('service', '1')) t(who, r);

select is(pg_temp.try_as('a_recruiter', $$update public.invites set status = 'revoked' where id = pg_temp.fx('inv_a2')$$), '1',
          'invites: recruiter revokes an own invite');
select is(pg_temp.try_as(who, $$update public.invites set status = 'revoked' where id = pg_temp.fx('inv_a2')$$), '0',
          'invites: ' || who || ' cannot revoke org A''s invite')
from unnest(array['a_viewer', 'b_admin', 'anon']) who;
select is(pg_temp.try_as('a_admin', $$update public.invites set org_id = pg_temp.fx('org_b') where id = pg_temp.fx('inv_a2')$$), '42501',
          'invites: cannot move an invite to another org');

select is(pg_temp.try_as(who, $$delete from public.invites where id = pg_temp.fx('inv_a2')$$), r,
          'invites: ' || who || ' deleting org A''s invite -> ' || r)
from (values ('a_recruiter', '1'), ('a_viewer', '0'), ('b_admin', '0')) t(who, r);

select * from finish();
rollback;
