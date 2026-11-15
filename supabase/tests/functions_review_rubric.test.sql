-- public.review_rubric_step: admins and recruiters mark rubric (inbox_reply)
-- steps; the attempt total is recomputed. Viewers, other orgs and anonymous
-- callers can't, and bad scores are rejected.
begin;
\ir fixtures/setup.psql

select plan(32);

-- A scored attempt on inv_a2: one numeric step (2/2) and one rubric step
-- waiting for review (0 of 3 + 2 provisional points).
insert into public.attempts (id, org_id, invite_id, scenario_id, started_at, deadline_at, submitted_at, status, score) values
  (pg_temp.fx('att_scored'), pg_temp.fx('org_a'), pg_temp.fx('inv_a2'), pg_temp.fx('lib_pub'),
   now() - interval '30 minutes', now() + interval '30 minutes', now(), 'scored',
   '{"points": 2, "maxPoints": 7, "steps": {
      "num":  {"points": 2, "maxPoints": 2, "items": [{"id": "value", "label": "Value", "earned": 2, "max": 2}]},
      "mail": {"points": 0, "maxPoints": 5, "needsReview": true, "items": [
        {"id": "tone",  "label": "Tone",  "earned": 0, "max": 3, "note": "Needs review."},
        {"id": "facts", "label": "Facts", "earned": 0, "max": 2, "note": "Needs review."}]}}}');
insert into public.step_responses (attempt_id, org_id, step_id, answer, score) values
  (pg_temp.fx('att_scored'), pg_temp.fx('org_a'), 'mail', '{"body": "hello"}',
   '{"points": 0, "maxPoints": 5, "needsReview": true, "items": [
      {"id": "tone",  "label": "Tone",  "earned": 0, "max": 3},
      {"id": "facts", "label": "Facts", "earned": 0, "max": 2}]}');

-- The server stores the automatic score twice: as the final score and as auto_score.
update public.attempts set auto_score = score where id = pg_temp.fx('att_scored');
update public.step_responses set auto_score = score where attempt_id = pg_temp.fx('att_scored');

-- Catalog and grants
select is((select prosecdef from pg_proc where oid = 'public.review_rubric_step(uuid, text, jsonb)'::regprocedure), true,
          'review_rubric_step is security definer');
select is(has_function_privilege(r, 'public.review_rubric_step(uuid, text, jsonb)', 'execute'), allowed,
          'review_rubric_step: ' || r || case when allowed then ' may' else ' may not' end || ' execute')
from (values ('anon', false), ('authenticated', true)) t(r, allowed);
select is_empty(
  $$ select 1 from pg_proc p, aclexplode(p.proacl) a
      where p.oid = 'public.review_rubric_step(uuid, text, jsonb)'::regprocedure and a.grantee = 0 $$,
  'PUBLIC has no execute on review_rubric_step');

-- Who may review (try_as rolls back each call)
select is(pg_temp.try_as(who, $$select public.review_rubric_step(pg_temp.fx('att_scored'), 'mail', '{"tone": 2, "facts": 1}')$$), r,
          'review: ' || who || ' -> ' || r)
from (values ('a_admin', '1'), ('a_recruiter', '1'), ('a_viewer', '42501'), ('b_admin', '42501'),
             ('outsider', '42501'), ('anon', '42501')) t(who, r);
select is(pg_temp.try_as('b_admin', $$select public.review_rubric_step(gen_random_uuid(), 'mail', '{"tone": 1, "facts": 1}')$$), '42501',
          'review: an unknown attempt gives the same error as another org''s');

-- Validation
select is(pg_temp.try_as('a_recruiter', q), '22023', label)
from (values
  ($$select public.review_rubric_step(pg_temp.fx('att_scored'), 'num',  '{"value": 1}')$$,             'review: a step without needsReview is refused'),
  ($$select public.review_rubric_step(pg_temp.fx('att_scored'), 'nope', '{"tone": 1}')$$,              'review: an unknown step is refused'),
  ($$select public.review_rubric_step(pg_temp.fx('att_scored'), 'mail', '{"tone": 4, "facts": 1}')$$,  'review: points above a criterion max are refused'),
  ($$select public.review_rubric_step(pg_temp.fx('att_scored'), 'mail', '{"tone": -1, "facts": 1}')$$, 'review: negative points are refused'),
  ($$select public.review_rubric_step(pg_temp.fx('att_scored'), 'mail', '{"tone": 1}')$$,              'review: every criterion needs a score'),
  ($$select public.review_rubric_step(pg_temp.fx('att_scored'), 'mail', '{"tone": 1, "facts": 1, "x": 1}')$$, 'review: unknown criteria are refused'),
  ($$select public.review_rubric_step(pg_temp.fx('att_scored'), 'mail', '{"tone": "2", "facts": 1}')$$, 'review: points must be numbers'),
  ($$select public.review_rubric_step(pg_temp.fx('att_scored'), 'mail', '[1, 2]')$$,                   'review: scores must be an object'),
  ($$select public.review_rubric_step(pg_temp.fx('att_a'), 'mail', '{"tone": 1, "facts": 1}')$$,        'review: an attempt that is not scored is refused')
) t(q, label);

-- A real review, as the recruiter
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.fx('a_recruiter'), 'role', 'authenticated')::text, true);
select lives_ok($$select public.review_rubric_step(pg_temp.fx('att_scored'), 'mail', '{"tone": 2.5, "facts": 2}')$$,
                'recruiter reviews the rubric step');
reset role;

select is((select (score ->> 'points')::numeric from public.attempts where id = pg_temp.fx('att_scored')), 6.5::numeric,
          'attempt total is recomputed (2 + 4.5)');
select is((select (score -> 'steps' -> 'mail' ->> 'points')::numeric from public.attempts where id = pg_temp.fx('att_scored')), 4.5::numeric,
          'step points are the sum of the criteria');
select ok((select not (score -> 'steps' -> 'mail' ? 'needsReview') from public.attempts where id = pg_temp.fx('att_scored')),
          'step no longer needs review');
select is((select score -> 'steps' -> 'mail' -> 'review' ->> 'by' from public.attempts where id = pg_temp.fx('att_scored')),
          pg_temp.fx('a_recruiter')::text, 'reviewer is recorded as the caller');
select is((select score -> 'steps' -> 'mail' -> 'items' -> 0 ->> 'note' from public.attempts where id = pg_temp.fx('att_scored')),
          'Needs review.', 'criterion notes are kept');
select is((select (score ->> 'points')::numeric from public.step_responses where attempt_id = pg_temp.fx('att_scored') and step_id = 'mail'),
          4.5::numeric, 'step_responses.score is updated too');
select is((select count(*)::int from public.audit_log where target = pg_temp.fx('att_scored')::text || ':mail' and action = 'reviewed_rubric'
             and actor_id = pg_temp.fx('a_recruiter')), 1, 'the review is in the audit log');

select is((select (auto_score ->> 'points')::numeric from public.attempts where id = pg_temp.fx('att_scored')), 2::numeric,
          'attempts.auto_score keeps the automatic total');
select ok((select (auto_score -> 'steps' -> 'mail' ->> 'needsReview')::boolean
                  and auto_score -> 'steps' -> 'mail' -> 'items' -> 0 ->> 'earned' = '0'
             from public.attempts where id = pg_temp.fx('att_scored')),
          'attempts.auto_score keeps the provisional rubric step');
select is((select (auto_score ->> 'points')::numeric from public.step_responses where attempt_id = pg_temp.fx('att_scored') and step_id = 'mail'),
          0::numeric, 'step_responses.auto_score is not changed by the review');

-- A reviewed step can be overridden later
select is(pg_temp.try_as('a_admin', $$select public.review_rubric_step(pg_temp.fx('att_scored'), 'mail', '{"tone": 3, "facts": 2}')$$), '1',
          'an admin can override a reviewed step');

select * from finish();
rollback;
