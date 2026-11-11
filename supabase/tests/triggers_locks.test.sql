-- Triggers: published scenarios are immutable, and an assessment's time limit,
-- proctoring and scenario freeze once a candidate has started (locked_at set).
-- The triggers fire for every role, the service role included.
begin;
\ir fixtures/setup.psql

select plan(41);

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

select set_eq(
  $$ select tgrelid::regclass::text, tgname::text, tgfoid::regproc::text
       from pg_trigger
      where not tgisinternal
        and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace) $$,
  $$ values ('assessments', 'assessments_locked',                 'prevent_locked_assessment_edits'),
            ('scenarios',   'scenarios_immutable_when_published', 'prevent_published_scenario_edits'),
            ('memberships', 'memberships_keep_one_admin',         'private.keep_one_admin') $$,
  'public has exactly the expected triggers (the last-admin guard is in policies_organizations)'
);

select ok(
  (select tgtype & 2 = 2 and tgtype & 16 = 16 and tgtype & 1 = 1 from pg_trigger where tgname = t),
  t || ': fires before update, for each row'
)
from unnest(array['assessments_locked', 'scenarios_immutable_when_published']) t;

select is(
  (select proconfig from pg_proc where oid = ('public.' || f || '()')::regprocedure),
  array['search_path=""'],
  f || ': search_path is fixed to empty'
)
from unnest(array['prevent_locked_assessment_edits', 'prevent_published_scenario_edits']) f;

select ok(
  not (select prosecdef from pg_proc where oid = ('public.' || f || '()')::regprocedure),
  f || ': runs as the caller (not security definer)'
)
from unnest(array['prevent_locked_assessment_edits', 'prevent_published_scenario_edits']) f;

select throws_ok(
  $$ select public.prevent_locked_assessment_edits() $$,
  '0A000', null,
  'trigger functions cannot be called directly'
);

-- ---------------------------------------------------------------------------
-- Assessment lock
-- ---------------------------------------------------------------------------

-- Unlocked: everything editable.
select is(pg_temp.try_as(who, $$update public.assessments set time_limit_minutes = 90, proctoring = '{"screen":true}', scenario_id = pg_temp.fx('scn_a') where id = pg_temp.fx('asm_a')$$), '1',
          'unlocked assessment: ' || who || ' changes time limit, proctoring and scenario')
from unnest(array['a_recruiter', 'service']) who;

-- Locked: the frozen fields are refused for every role.
select is(pg_temp.try_as(who, q), 'P0001', 'locked assessment: ' || who || ' cannot change ' || what)
from (values
  ('time limit', $$update public.assessments set time_limit_minutes = 90 where id = pg_temp.fx('asm_a_locked')$$),
  ('proctoring', $$update public.assessments set proctoring = '{"camera":false}' where id = pg_temp.fx('asm_a_locked')$$),
  ('scenario',   $$update public.assessments set scenario_id = pg_temp.fx('scn_a') where id = pg_temp.fx('asm_a_locked')$$)
) t(what, q)
cross join unnest(array['a_admin', 'a_recruiter', 'service', 'owner']) who;

select throws_like(
  $$ update public.assessments set time_limit_minutes = 90 where id = pg_temp.fx('asm_a_locked') $$,
  '%clone it to change settings%',
  'the lock error tells the user to clone the assessment'
);

select is(pg_temp.try_as('a_recruiter', q), '1', 'locked assessment: can still change ' || what)
from (values
  ('the title',                   $$update public.assessments set title = 'Renamed' where id = pg_temp.fx('asm_a_locked')$$),
  ('the pass score',              $$update public.assessments set pass_score = 70 where id = pg_temp.fx('asm_a_locked')$$),
  ('proctoring to the same value', $$update public.assessments set proctoring = '{"camera":true}', time_limit_minutes = 60 where id = pg_temp.fx('asm_a_locked')$$)
) t(what, q);

select is(pg_temp.try_as('a_recruiter', $$update public.assessments set locked_at = null, time_limit_minutes = 5 where id = pg_temp.fx('asm_a_locked')$$), 'P0001',
          'locked assessment: clearing the lock and changing the time limit in one update is refused');

-- Locking takes effect on the next statement.
update public.assessments set locked_at = now() where id = pg_temp.fx('asm_a');
select is(pg_temp.try_as('a_recruiter', $$update public.assessments set time_limit_minutes = 15 where id = pg_temp.fx('asm_a')$$), 'P0001',
          'once locked_at is set, the time limit is frozen');

-- BUG: the trigger only compares the frozen fields when the old row is locked;
-- it doesn't stop locked_at itself going back to null. So a manager can unlock
-- in one update and change proctoring or the time limit in the next.
select todo('the assessment lock can be cleared by setting locked_at to null', 2);
select isnt(pg_temp.try_as('a_recruiter', $$update public.assessments set locked_at = null where id = pg_temp.fx('asm_a_locked')$$), '1',
            'locked assessment: locked_at cannot be cleared');
select pg_temp.act_as('a_recruiter');
update public.assessments set locked_at = null where id = pg_temp.fx('asm_a_locked');
select pg_temp.act_as('owner');
select is(pg_temp.try_as('a_recruiter', $$update public.assessments set proctoring = '{}' where id = pg_temp.fx('asm_a_locked')$$), 'P0001',
          'locked assessment: unlock in one statement, then edit proctoring in the next, is refused');

-- ---------------------------------------------------------------------------
-- Published scenarios are immutable
-- ---------------------------------------------------------------------------

select is(pg_temp.try_as(who, format('update public.scenarios set title = %L where id = %L', 'edited', pg_temp.fx(scn))), 'P0001',
          'published scenario ' || scn || ': ' || who || ' cannot edit it')
from (values ('a_admin', 'scn_a_pub'), ('a_recruiter', 'scn_a_pub'), ('service', 'scn_a_pub'),
             ('service', 'lib_pub'), ('owner', 'lib_pub')) t(who, scn);

select is(pg_temp.try_as('service', $$update public.scenarios set published_at = null where id = pg_temp.fx('lib_pub')$$), 'P0001',
          'a published scenario cannot be unpublished');
select is(pg_temp.try_as('service', $$update public.scenarios set definition = '{"steps":["changed"]}' where id = pg_temp.fx('lib_pub')$$), 'P0001',
          'a published scenario''s definition cannot change');
select throws_like(
  $$ update public.scenarios set title = 'x' where id = pg_temp.fx('lib_pub') $$,
  '%create a new version%',
  'the error tells the author to create a new version'
);

select is(pg_temp.try_as('a_recruiter', $$update public.scenarios set title = 'edited', definition = '{"steps":[1]}' where id = pg_temp.fx('scn_a')$$), '1',
          'a draft scenario is editable');

update public.scenarios set published_at = now() where id = pg_temp.fx('scn_a');
select is(pg_temp.try_as('a_recruiter', $$update public.scenarios set title = 'after publish' where id = pg_temp.fx('scn_a')$$), 'P0001',
          'publishing a draft makes it immutable from then on');

-- Provisional: the trigger covers updates only. An unused published scenario
-- of the company's own can still be deleted (used ones are kept by the FK).
select is(pg_temp.try_as('a_admin', $$delete from public.scenarios where id = pg_temp.fx('scn_a_pub')$$), '1',
          'an unused published own scenario can be deleted (trigger covers updates only)');

select * from finish();
rollback;
