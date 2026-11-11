-- D12 (docs/decisions/2026-11-10-pilot-decisions.md): S1 and S2 from
-- docs/decisions/2026-11-09-stage-a-open-decisions.md, in one migration.
--
-- S1. invites.last_sent_at and invites.sent_count: when the link was last
--     emailed and how many times. A new invite starts at (now(), 1); every
--     resend sets last_sent_at = now() and adds one. Existing rows are
--     backfilled from created_at with a count of 1.
--
-- S2. A partial unique index on (job_id, lower(email)) for invited, started
--     and completed rows, so two batches submitted at the same moment can't
--     both invite the same email. Revoked and expired rows stay outside the
--     index, so re-inviting after a revoke or an expiry keeps working (J3).
--
--     Before the index is built:
--       * invites still marked 'invited' whose expiry has passed are marked
--         'expired' (the app shows them as expired already; the row now says
--         so too, which takes them out of the index), and
--       * if a race already produced two live invites for one email, the older
--         unstarted ('invited') copies are revoked, keeping the newest. A pair
--         where both were started or completed can't be fixed automatically;
--         the migration then stops with a message instead of guessing.

-- ---------------------------------------------------------------------------
-- S1. Send tracking
-- ---------------------------------------------------------------------------

alter table public.invites
  add column last_sent_at timestamptz,
  add column sent_count   int not null default 1;

update public.invites set last_sent_at = created_at where last_sent_at is null;

alter table public.invites
  alter column last_sent_at set not null,
  alter column last_sent_at set default now(),
  add constraint invites_sent_count_positive check (sent_count >= 1);

-- ---------------------------------------------------------------------------
-- S2. One live invite per email per job
-- ---------------------------------------------------------------------------

update public.invites
set status = 'expired'
where status = 'invited' and expires_at <= now();

-- Revoke older unstarted duplicates; the newest live row (preferring started
-- or completed ones) is kept.
with ranked as (
  select id, status,
         row_number() over (
           partition by job_id, lower(email)
           order by (status in ('started', 'completed')) desc, created_at desc, id desc
         ) as rn
  from public.invites
  where status in ('invited', 'started', 'completed')
)
update public.invites i
set status = 'revoked'
from ranked r
where i.id = r.id and r.rn > 1 and r.status = 'invited';

do $$
declare
  dupes int;
begin
  select count(*) into dupes
  from (
    select 1 from public.invites
    where status in ('invited', 'started', 'completed')
    group by job_id, lower(email)
    having count(*) > 1
  ) d;
  if dupes > 0 then
    raise exception '% job/email pairs have more than one started or completed invite; resolve them by hand before adding invites_job_email_live_key', dupes;
  end if;
end;
$$;

create unique index invites_job_email_live_key
  on public.invites (job_id, lower(email))
  where status in ('invited', 'started', 'completed');
