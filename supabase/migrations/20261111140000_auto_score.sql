-- Keep the automatic score apart from the final one (decision D11, option c2).
--
-- Until now a reviewer's rubric marks overwrote the provisional automatic
-- score in attempts.score and step_responses.score. From here on:
--
--   * score       the final score (automatic, then changed by reviewers)
--   * auto_score  the score as the server computed it at submit; written once
--                 by the server, never changed by a review
--
-- Company users still only read these tables (no write policies), and
-- review_rubric_step still writes only `score`, so RLS is unchanged.

alter table public.attempts       add column auto_score jsonb;
alter table public.step_responses add column auto_score jsonb;

comment on column public.attempts.auto_score is
  'Attempt score as computed automatically at submit, before any reviewer marks. score holds the final score.';
comment on column public.step_responses.auto_score is
  'Step score as computed automatically at submit, before any reviewer marks. score holds the final score.';

-- ---------------------------------------------------------------------------
-- Backfill. Only rubric steps (inbox_reply) can be reviewed, and their
-- automatic score is always 0 per criterion with needsReview. A reviewed step
-- keeps its items, labels and notes, so the original is that step with every
-- `earned` back at 0, `points` 0, `needsReview` true and no `review`.
-- Steps nobody reviewed are copied as they are.
-- ---------------------------------------------------------------------------

create function pg_temp.unreviewed(p_step jsonb) returns jsonb
language sql immutable
as $$
  select case
    when jsonb_typeof(p_step) = 'object' and p_step ? 'review' then
      (p_step - 'review') || jsonb_build_object(
        'points', 0,
        'needsReview', true,
        'items', coalesce(
          (select jsonb_agg(jsonb_set(i, '{earned}', '0'::jsonb) order by ord)
             from jsonb_array_elements(p_step -> 'items') with ordinality t(i, ord)),
          '[]'::jsonb))
    else p_step
  end
$$;

update public.step_responses
set auto_score = pg_temp.unreviewed(score)
where score is not null;

update public.attempts a
set auto_score = jsonb_set(jsonb_set(a.score, '{steps}', s.steps), '{points}', to_jsonb(s.points))
from (
  select a2.id,
         jsonb_object_agg(e.key, pg_temp.unreviewed(e.value)) as steps,
         coalesce(sum((pg_temp.unreviewed(e.value) ->> 'points')::numeric), 0) as points
  from public.attempts a2
  cross join lateral jsonb_each(a2.score -> 'steps') e
  where jsonb_typeof(a2.score -> 'steps') = 'object'
  group by a2.id
) s
where s.id = a.id;

update public.attempts
set auto_score = score
where score is not null and auto_score is null;

-- ---------------------------------------------------------------------------
-- Write once: the server may set auto_score (or set the same value again when
-- a crashed scoring run is finished), but nobody changes it afterwards.
-- ---------------------------------------------------------------------------

create function private.keep_auto_score() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.auto_score is not null and new.auto_score is distinct from old.auto_score then
    raise exception 'auto_score is written once and cannot change' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.keep_auto_score() from public, anon, authenticated;

create trigger attempts_keep_auto_score
  before update of auto_score on public.attempts
  for each row execute function private.keep_auto_score();

create trigger step_responses_keep_auto_score
  before update of auto_score on public.step_responses
  for each row execute function private.keep_auto_score();
