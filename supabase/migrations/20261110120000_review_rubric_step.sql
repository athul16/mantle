-- Rubric review: an admin or recruiter enters the points per criterion for a
-- step that needs a person to mark it (inbox_reply), and the attempt's final
-- score is updated. See docs/05-company-experience.md (candidate report) and
-- docs/03-roles-and-permissions.md (viewers are read-only on scores).
--
-- Attempts and step_responses stay read-only for company users (writes come
-- from the server). A table-wide UPDATE policy would let a recruiter rewrite
-- answers or any score, so instead this one function does the narrow write:
--
--   * the caller must be an admin or recruiter of the attempt's org
--   * the attempt must be scored, and the step must be one that needs review
--     (its stored score has needsReview, or was reviewed before)
--   * every criterion gets a number between 0 and that criterion's max
--   * it records who reviewed and when, recomputes the attempt total, and
--     appends to the audit log
--
-- The criteria and their max points come from the stored score, so no answer
-- key or scoring code is needed here.

create function public.review_rubric_step(p_attempt_id uuid, p_step_id text, p_scores jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_status  text;
  v_score   jsonb;
  v_step    jsonb;
  v_items   jsonb := '[]'::jsonb;
  v_item    jsonb;
  v_raw     jsonb;
  v_earned  numeric;
  v_max     numeric;
  v_points  numeric := 0;
  v_total   numeric := 0;
  v_key     text;
begin
  select a.org_id, a.status, a.score into v_org, v_status, v_score
  from public.attempts a
  where a.id = p_attempt_id
  for update;

  -- Same error whether the attempt doesn't exist or belongs to another org,
  -- so the function doesn't reveal other companies' attempts.
  if v_org is null or not private.can_manage_org(v_org) then
    raise exception 'not allowed to review this attempt' using errcode = '42501';
  end if;

  if v_status <> 'scored' or v_score is null then
    raise exception 'attempt is not scored yet' using errcode = '22023';
  end if;

  v_step := v_score -> 'steps' -> p_step_id;
  if v_step is null then
    raise exception 'attempt has no step "%"', p_step_id using errcode = '22023';
  end if;
  if not (coalesce((v_step ->> 'needsReview')::boolean, false) or v_step ? 'review') then
    raise exception 'step "%" is not marked by a reviewer', p_step_id using errcode = '22023';
  end if;

  if p_scores is null or jsonb_typeof(p_scores) <> 'object' then
    raise exception 'scores must be an object of criterion id to points' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_scores) loop
    if not exists (select 1 from jsonb_array_elements(v_step -> 'items') i where i ->> 'id' = v_key) then
      raise exception 'unknown criterion "%"', v_key using errcode = '22023';
    end if;
  end loop;

  for v_item in select * from jsonb_array_elements(v_step -> 'items') loop
    v_raw := p_scores -> (v_item ->> 'id');
    if v_raw is null or jsonb_typeof(v_raw) <> 'number' then
      raise exception 'criterion "%" needs a number', v_item ->> 'id' using errcode = '22023';
    end if;
    v_earned := (v_raw #>> '{}')::numeric;
    v_max := (v_item ->> 'max')::numeric;
    if v_earned < 0 or v_earned > v_max then
      raise exception 'criterion "%" must be between 0 and %', v_item ->> 'id', v_max using errcode = '22023';
    end if;
    v_items := v_items || jsonb_build_array(jsonb_set(v_item, '{earned}', to_jsonb(v_earned)));
    v_points := v_points + v_earned;
  end loop;

  v_step := (v_step - 'needsReview')
    || jsonb_build_object(
         'items', v_items,
         'points', v_points,
         'review', jsonb_build_object('by', (select auth.uid()), 'at', now())
       );
  v_score := jsonb_set(v_score, array['steps', p_step_id], v_step);

  select coalesce(sum((s.value ->> 'points')::numeric), 0) into v_total
  from jsonb_each(v_score -> 'steps') s;
  v_score := jsonb_set(v_score, '{points}', to_jsonb(v_total));

  update public.attempts set score = v_score where id = p_attempt_id;
  update public.step_responses set score = v_step
  where attempt_id = p_attempt_id and step_id = p_step_id;

  insert into public.audit_log (org_id, actor_id, action, target)
  values (v_org, (select auth.uid()), 'reviewed_rubric', p_attempt_id::text || ':' || p_step_id);

  return v_score;
end;
$$;

revoke all on function public.review_rubric_step(uuid, text, jsonb) from public, anon;
grant execute on function public.review_rubric_step(uuid, text, jsonb) to authenticated;
