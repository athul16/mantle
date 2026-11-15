-- auto_score (decision D11): the automatic score is kept next to the final
-- one. The server writes it once; after that nobody changes it, the service
-- role included. Company users can read it like score, and can't write either.
begin;
\ir fixtures/setup.psql

select plan(10);

select col_type_is('public', t, 'auto_score', 'jsonb', t || '.auto_score is jsonb')
from unnest(array['attempts', 'step_responses']) t;

select ok(
  (select tgtype & 2 = 2 and tgtype & 16 = 16 and tgtype & 1 = 1 from pg_trigger where tgname = t),
  t || ': fires before update, for each row'
)
from unnest(array['attempts_keep_auto_score', 'step_responses_keep_auto_score']) t;

select is(has_function_privilege('authenticated', 'private.keep_auto_score()', 'execute'), false,
          'signed-in users cannot call the trigger function');

-- The server sets it once ...
select lives_ok(
  $$ update public.attempts set auto_score = '{"points": 1, "maxPoints": 2, "steps": {}}' where id = pg_temp.fx('att_a') $$,
  'auto_score can be set when empty');
select lives_ok(
  $$ update public.attempts set auto_score = '{"points": 1, "maxPoints": 2, "steps": {}}', score = '{"points": 2}' where id = pg_temp.fx('att_a') $$,
  'setting the same auto_score again (re-run of scoring) and changing score is fine');
select throws_ok(
  $$ update public.attempts set auto_score = '{"points": 2, "maxPoints": 2, "steps": {}}' where id = pg_temp.fx('att_a') $$,
  '42501', 'auto_score is written once and cannot change',
  'auto_score cannot change once set');

-- ... and company users can't write it at all (no write policy on attempts).
select is(pg_temp.try_as(who, $$ update public.attempts set auto_score = null where id = pg_temp.fx('att_a') $$), '0',
          who || ' cannot update auto_score')
from unnest(array['a_admin', 'a_recruiter']) who;

select * from finish();
rollback;
