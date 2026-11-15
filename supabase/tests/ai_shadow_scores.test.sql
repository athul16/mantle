-- ai_shadow_scores (decision D8, shadow mode): AI rubric scores are server
-- only. No company user, candidate or anonymous visitor can read or write
-- them, not even by column; the comparison views in `private` are closed too.
-- Rows go with the attempt. The agreement view compares AI and reviewed
-- human scores per criterion.
begin;
\ir fixtures/setup.psql

select plan(45);

-- ---------------------------------------------------------------------------
-- Privileges and policies
-- ---------------------------------------------------------------------------

select table_privs_are('public', 'ai_shadow_scores', r, array[]::text[], 'ai_shadow_scores: ' || r || ' has no table privileges')
from unnest(array['anon', 'authenticated']) r;

select is_empty(
  $$ select column_name || ':' || grantee from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'ai_shadow_scores'
        and grantee in ('anon', 'authenticated', 'PUBLIC') $$,
  'ai_shadow_scores: no column-level grants');

select is_empty(
  $$ select policyname from pg_policies where schemaname = 'public' and tablename = 'ai_shadow_scores' $$,
  'ai_shadow_scores: no policies');

select table_privs_are('private', v, r, array[]::text[], 'private.' || v || ': ' || r || ' has no privileges')
from unnest(array['ai_shadow_criterion_scores', 'ai_shadow_agreement']) v
cross join unnest(array['anon', 'authenticated']) r;

select ok((select coalesce('security_invoker=true' = any(reloptions), false) from pg_class where oid = ('private.' || v)::regclass),
          'private.' || v || ' runs as the caller')
from unnest(array['ai_shadow_criterion_scores', 'ai_shadow_agreement']) v;

-- ---------------------------------------------------------------------------
-- Data: a scored attempt with a reviewed reply (as the owner)
-- ---------------------------------------------------------------------------

insert into public.attempts (id, org_id, invite_id, scenario_id, started_at, deadline_at, submitted_at, status, score) values
  (pg_temp.fx('att_scored'), pg_temp.fx('org_a'), pg_temp.fx('inv_a2'), pg_temp.fx('lib_pub'),
   now() - interval '30 minutes', now() + interval '30 minutes', now(), 'scored', '{"points": 0, "maxPoints": 5, "steps": {}}');
insert into public.step_responses (attempt_id, org_id, step_id, answer, score) values
  (pg_temp.fx('att_scored'), pg_temp.fx('org_a'), 'mail', '{"body": "hello"}',
   '{"points": 4, "maxPoints": 5, "review": {"by": "x", "at": "2026-11-10T10:00:00Z"}, "items": [
      {"id": "tone",  "label": "Tone",  "earned": 3, "max": 3},
      {"id": "facts", "label": "Facts", "earned": 1, "max": 2}]}'),
  (pg_temp.fx('att_scored'), pg_temp.fx('org_a'), 'mail2', '{"body": "hi"}',
   '{"points": 0, "maxPoints": 3, "needsReview": true, "items": [
      {"id": "tone",  "label": "Tone",  "earned": 0, "max": 3}]}');
insert into public.ai_shadow_scores (attempt_id, org_id, step_id, model, prompt_version, status, criteria, points, max_points, input_tokens, output_tokens) values
  (pg_temp.fx('att_scored'), pg_temp.fx('org_a'), 'mail', 'claude-sonnet-5-5', 'v1', 'scored',
   '[{"id": "tone", "earned": 2, "max": 3, "reasoning": "Polite."}, {"id": "facts", "earned": 1, "max": 2, "reasoning": "Missed the fee."}]',
   3, 5, 1200, 400),
  (pg_temp.fx('att_scored'), pg_temp.fx('org_a'), 'mail2', 'claude-sonnet-5-5', 'v1', 'scored',
   '[{"id": "tone", "earned": 1, "max": 3, "reasoning": "Curt."}]', 1, 3, 900, 300),
  (pg_temp.fx('att_scored'), pg_temp.fx('org_a'), 'mail', 'claude-sonnet-5-5', 'v0', 'failed', '[]', null, null, null, null);

-- ---------------------------------------------------------------------------
-- Every actor short of the service role is refused, for every operation
-- ---------------------------------------------------------------------------

select is(pg_temp.try_as(who, q), '42501', who || ' ' || op || ' is refused')
from (values
  ('select', $$select * from public.ai_shadow_scores$$),
  ('select one column', $$select criteria from public.ai_shadow_scores$$),
  ('insert', $$insert into public.ai_shadow_scores (attempt_id, org_id, step_id, model, prompt_version, status) values (pg_temp.fx('att_scored'), pg_temp.fx('org_a'), 'x', 'm', 'v', 'scored')$$),
  ('update', $$update public.ai_shadow_scores set points = 5$$),
  ('delete', $$delete from public.ai_shadow_scores$$),
  ('select the agreement view', $$select * from private.ai_shadow_agreement$$)
) t(op, q)
cross join unnest(array['a_admin', 'a_recruiter', 'a_viewer', 'b_admin', 'anon']) who;

select is(pg_temp.count_as('service', $$select 1 from public.ai_shadow_scores where org_id = pg_temp.fx('org_a')$$), 3,
          'service role reads ai_shadow_scores');
select is(pg_temp.try_as('service', $$insert into public.ai_shadow_scores (attempt_id, org_id, step_id, model, prompt_version, status) values (pg_temp.fx('att_scored'), pg_temp.fx('org_a'), 'mail', 'claude-sonnet-5-5', 'v1', 'failed')$$),
          '23505', 'one row per attempt, step, model and prompt version');

-- ---------------------------------------------------------------------------
-- Comparison views (as the owner, as in the SQL editor)
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select step_id, criterion_id, ai_earned, human_earned from private.ai_shadow_criterion_scores
      where attempt_id = pg_temp.fx('att_scored') order by step_id, criterion_id $$,
  $$ values ('mail', 'facts', 1::numeric, 1::numeric), ('mail', 'tone', 2::numeric, 3::numeric),
            ('mail2', 'tone', 1::numeric, null::numeric) $$,
  'criterion view: failed runs are left out; unreviewed steps have no human score');

select results_eq(
  $$ select step_id, criterion_id, ai_scored, compared, mean_abs_diff, exact_rate, within_quarter_rate
       from private.ai_shadow_agreement where prompt_version = 'v1' order by step_id, criterion_id $$,
  $$ values ('mail', 'facts', 1::bigint, 1::bigint, 0.000::numeric, 1.000::numeric, 1.000::numeric),
            ('mail', 'tone', 1::bigint, 1::bigint, 1.000::numeric, 0.000::numeric, 0.000::numeric),
            ('mail2', 'tone', 1::bigint, 0::bigint, null::numeric, null::numeric, null::numeric) $$,
  'agreement view: per-criterion counts, mean absolute difference and agreement rates');

-- ---------------------------------------------------------------------------
-- Rows go with the attempt
-- ---------------------------------------------------------------------------

delete from public.attempts where id = pg_temp.fx('att_scored');
select is((select count(*)::int from public.ai_shadow_scores where attempt_id = pg_temp.fx('att_scored')), 0,
          'deleting the attempt deletes its AI shadow scores');

select * from finish();
rollback;
