-- Policies on candidate data: attempts, step_responses, action_events,
-- integrity_events, media. Company members only read; every write comes from
-- server routes with the service role. Viewers see proctoring media only when
-- the org setting viewers_see_media is on.
begin;
\ir fixtures/setup.psql

select plan(132);

create temp table cases (tbl text, ins text, upd text, del text);
insert into cases values
  ('attempts',
   $$insert into public.attempts (org_id, invite_id, scenario_id) values (pg_temp.fx('org_a'), pg_temp.fx('inv_a2'), pg_temp.fx('lib_pub'))$$,
   $$update public.attempts set status = 'scored', score = '{"total":100}' where id = pg_temp.fx('att_a')$$,
   $$delete from public.attempts where id = pg_temp.fx('att_a')$$),
  ('step_responses',
   $$insert into public.step_responses (attempt_id, org_id, step_id, answer) values (pg_temp.fx('att_a'), pg_temp.fx('org_a'), 'step-2', '{}')$$,
   $$update public.step_responses set answer = '{"value":999}' where attempt_id = pg_temp.fx('att_a')$$,
   $$delete from public.step_responses where attempt_id = pg_temp.fx('att_a')$$),
  ('action_events',
   $$insert into public.action_events (attempt_id, org_id, kind) values (pg_temp.fx('att_a'), pg_temp.fx('org_a'), 'forged')$$,
   $$update public.action_events set kind = 'forged' where attempt_id = pg_temp.fx('att_a')$$,
   $$delete from public.action_events where attempt_id = pg_temp.fx('att_a')$$),
  ('integrity_events',
   $$insert into public.integrity_events (attempt_id, org_id, kind) values (pg_temp.fx('att_a'), pg_temp.fx('org_a'), 'forged')$$,
   $$update public.integrity_events set kind = 'forged' where attempt_id = pg_temp.fx('att_a')$$,
   $$delete from public.integrity_events where attempt_id = pg_temp.fx('att_a')$$),
  ('media',
   $$insert into public.media (attempt_id, org_id, source, storage_path) values (pg_temp.fx('att_a'), pg_temp.fx('org_a'), 'screen', 'x')$$,
   $$update public.media set storage_path = 'elsewhere' where attempt_id = pg_temp.fx('att_a')$$,
   $$delete from public.media where attempt_id = pg_temp.fx('att_a')$$);

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

select is(pg_temp.count_as(who, format('select 1 from public.%I where org_id in (%L, %L)', tbl, pg_temp.fx('org_a'), pg_temp.fx('org_b'))), n,
          tbl || ': ' || who || ' reads ' || n)
from (values ('a_admin', 1), ('a_recruiter', 1), ('a_viewer', 1), ('b_admin', 1), ('outsider', 0), ('anon', 0), ('service', 2)) a(who, n)
cross join unnest(array['attempts', 'step_responses', 'action_events', 'integrity_events']) tbl;

select is(pg_temp.count_as('a_admin', $$select 1 from public.attempts where id = pg_temp.fx('att_b')$$), 0,
          'attempts: asking for another org''s attempt by id returns nothing');

-- media, setting off (the fixture default)
select is(pg_temp.count_as(who, format('select 1 from public.media where org_id in (%L, %L)', pg_temp.fx('org_a'), pg_temp.fx('org_b'))), n,
          'media (viewers_see_media off): ' || who || ' reads ' || n)
from (values ('a_admin', 1), ('a_recruiter', 1), ('a_viewer', 0), ('b_admin', 1), ('b_viewer', 0),
             ('outsider', 0), ('anon', 0), ('service', 2)) a(who, n);

update public.organizations set settings = '{"viewers_see_media": "false"}' where id = pg_temp.fx('org_a');
select is(pg_temp.count_as('a_viewer', $$select 1 from public.media$$), 0,
          'media: the string "false" keeps viewers out');

update public.organizations set settings = '{"viewers_see_media": true}' where id = pg_temp.fx('org_a');
select is(pg_temp.count_as('a_viewer', $$select 1 from public.media$$), 1,
          'media (viewers_see_media on in A): org A viewer reads org A media');
select is(pg_temp.count_as('a_viewer', $$select 1 from public.media where org_id = pg_temp.fx('org_b')$$), 0,
          'media: org A''s setting does not open org B''s media');
select is(pg_temp.count_as('b_viewer', $$select 1 from public.media$$), 0,
          'media: org B viewer still reads nothing (setting is on in A only)');
select is(pg_temp.count_as('b_viewer', $$select 1 from public.media where org_id = pg_temp.fx('org_a')$$), 0,
          'media: another org''s viewer never reads org A media');
update public.organizations set settings = '{}' where id = pg_temp.fx('org_a');

-- ---------------------------------------------------------------------------
-- Writes: nobody but the service role
-- ---------------------------------------------------------------------------

select is(pg_temp.try_as(who, ins), '42501', tbl || ': ' || who || ' cannot insert')
from cases cross join unnest(array['a_admin', 'a_recruiter', 'a_viewer', 'b_admin', 'anon']) who;

select is(pg_temp.try_as(who, upd), '0', tbl || ': ' || who || ' cannot update')
from cases cross join unnest(array['a_admin', 'a_recruiter', 'a_viewer', 'b_admin', 'anon']) who;

select is(pg_temp.try_as(who, del), '0', tbl || ': ' || who || ' cannot delete')
from cases cross join unnest(array['a_admin', 'a_recruiter', 'a_viewer', 'b_admin', 'anon']) who;

select is(pg_temp.try_as('service', ins), '1', tbl || ': service role inserts') from cases;
select is(pg_temp.try_as('service', upd), '1', tbl || ': service role updates') from cases;
select is(pg_temp.try_as('service', del), '1', tbl || ': service role deletes') from cases;

select * from finish();
rollback;
