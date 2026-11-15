-- Every organization keeps at least one admin (decision D13 / Q4).
--
-- The team page already checks this in app code, but two admins demoting each
-- other at the same moment could both pass that check. This trigger is the
-- real rule: removing, demoting or moving the last admin of an org fails with
-- SQLSTATE 23514 (check_violation), whoever runs the statement.
--
-- Concurrency: the trigger locks the organization row first, so two
-- statements touching admins of the same org run one after the other, and the
-- second one sees the first one's result.
--
-- Not blocked: rows removed because the whole organization is being deleted,
-- or because the user's auth account is being deleted (both cascade here
-- after the parent row is gone).

create function private.keep_one_admin()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- Only an admin row going away (delete, demotion, or a move to another org) matters.
  if old.role <> 'admin' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'admin' and new.org_id = old.org_id then
    return new;
  end if;

  -- Cascades from deleting the org or the user: the parent row is already gone.
  perform 1 from public.organizations where id = old.org_id for update;
  if not found then
    return coalesce(new, old);
  end if;
  if not exists (select 1 from auth.users where id = old.user_id) then
    return coalesce(new, old);
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.org_id = old.org_id and m.role = 'admin' and m.user_id <> old.user_id
  ) then
    raise exception 'An organization needs at least one admin. Make someone else an admin first.'
      using errcode = 'check_violation', constraint = 'memberships_keep_one_admin';
  end if;

  return coalesce(new, old);
end;
$$;

revoke execute on function private.keep_one_admin() from public, anon, authenticated;

create trigger memberships_keep_one_admin
  before update or delete on public.memberships
  for each row execute function private.keep_one_admin();
