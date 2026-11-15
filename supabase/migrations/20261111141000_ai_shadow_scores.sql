-- AI rubric scores in shadow mode (decision D8, option B).
--
-- After an attempt is submitted, the server asks a model to score each
-- written reply (inbox_reply) against the same rubric a reviewer uses. The
-- result is stored here and nowhere else: it is never shown in the app and
-- never counts towards any score. It exists so AI and human scores can be
-- compared per criterion before anyone decides to show AI suggestions (D8 C).
--
-- Server only, like invite_secrets / attempt_secrets: RLS on with no
-- policies, and no table privileges for anon or authenticated, so company
-- users can't read it even by column. Rows go with the attempt (on delete
-- cascade), so candidate deletion and retention purges remove them too.

create table public.ai_shadow_scores (
  id                          bigint generated always as identity primary key,
  attempt_id                  uuid not null,
  org_id                      uuid not null,
  step_id                     text not null,
  model                       text not null,             -- model id that answered
  prompt_version              text not null,             -- bumps whenever the prompt or schema changes
  status                      text not null check (status in ('scored', 'failed')),
  -- [{ id, earned, max, reasoning }] per rubric criterion, earned clamped to 0..max
  criteria                    jsonb not null default '[]'::jsonb check (jsonb_typeof(criteria) = 'array'),
  points                      numeric,
  max_points                  numeric,
  stop_reason                 text,
  error                       text,
  input_tokens                integer,
  output_tokens               integer,
  cache_read_input_tokens     integer,
  cache_creation_input_tokens integer,
  duration_ms                 integer,
  created_at                  timestamptz not null default now(),
  foreign key (attempt_id, org_id) references public.attempts(id, org_id) on delete cascade,
  unique (attempt_id, step_id, model, prompt_version)
);

alter table public.ai_shadow_scores enable row level security;
revoke all on table public.ai_shadow_scores from public, anon, authenticated;

comment on table public.ai_shadow_scores is
  'Shadow-mode AI rubric scores (D8). Server only; never shown in the app or used in any score.';

-- ---------------------------------------------------------------------------
-- Comparison with human scores, per criterion. Only steps a person reviewed
-- (score has `review`) have a human score. The views live in `private`, which
-- the API doesn't expose: read them in the Supabase SQL editor, e.g.
--
--   select * from private.ai_shadow_agreement order by step_id, criterion_id;
--
-- They run as the caller (security_invoker) and nobody but the owner and the
-- service role may select from them.
-- ---------------------------------------------------------------------------

create view private.ai_shadow_criterion_scores
with (security_invoker = true)
as
select
  s.org_id,
  s.attempt_id,
  s.step_id,
  s.model,
  s.prompt_version,
  c.item ->> 'id'                         as criterion_id,
  (c.item ->> 'max')::numeric             as max_points,
  (c.item ->> 'earned')::numeric          as ai_earned,
  (h.item ->> 'earned')::numeric          as human_earned,
  (r.score -> 'review' ->> 'at')::timestamptz as reviewed_at,
  c.item ->> 'reasoning'                  as ai_reasoning,
  s.created_at                            as ai_scored_at
from public.ai_shadow_scores s
cross join lateral jsonb_array_elements(s.criteria) c(item)
left join public.step_responses r
  on r.attempt_id = s.attempt_id and r.org_id = s.org_id and r.step_id = s.step_id
left join lateral (
  select i as item
  from jsonb_array_elements(r.score -> 'items') i
  where r.score ? 'review' and i ->> 'id' = c.item ->> 'id'
  limit 1
) h on true
where s.status = 'scored';

create view private.ai_shadow_agreement
with (security_invoker = true)
as
select
  model,
  prompt_version,
  step_id,
  criterion_id,
  max(max_points)                                                     as max_points,
  count(*)                                                            as ai_scored,
  count(human_earned)                                                 as compared,
  round(avg(ai_earned) filter (where human_earned is not null), 3)    as ai_mean,
  round(avg(human_earned), 3)                                         as human_mean,
  round(avg(abs(ai_earned - human_earned)), 3)                        as mean_abs_diff,
  round(avg(ai_earned - human_earned), 3)                             as mean_diff_ai_minus_human,
  round(avg((abs(ai_earned - human_earned) < 0.001)::int), 3)         as exact_rate,
  round(avg((abs(ai_earned - human_earned) <= 0.25 * max_points)::int), 3) as within_quarter_rate
from private.ai_shadow_criterion_scores
group by model, prompt_version, step_id, criterion_id;

revoke all on table private.ai_shadow_criterion_scores, private.ai_shadow_agreement from public, anon, authenticated;
grant select on table private.ai_shadow_criterion_scores, private.ai_shadow_agreement to service_role;
