-- Policies on review data: flags (confirm or clear, never reject), notes
-- (each member writes their own) and the audit log (admins read, members
-- append their own actions, nobody edits).
begin;
\ir fixtures/setup.psql

select plan(73);

-- ---------------------------------------------------------------------------
-- flags
-- ---------------------------------------------------------------------------

select is(pg_temp.count_as(who, $$select 1 from public.flags where id in (pg_temp.fx('flag_a'), pg_temp.fx('flag_b'))$$), n,
          'flags: ' || who || ' reads ' || n)
from (values ('a_admin', 1), ('a_recruiter', 1), ('a_viewer', 1), ('b_admin', 1), ('outsider', 0), ('anon', 0), ('service', 2)) t(who, n);

select is(pg_temp.try_as(who, format(
            $$update public.flags set status = 'cleared', reviewed_by = %L, reviewed_at = now() where id = pg_temp.fx('flag_a')$$,
            pg_temp.fx(who))), r,
          'flags: ' || who || ' clearing org A''s flag as themselves -> ' || r)
from (values ('a_admin', '1'), ('a_recruiter', '1'), ('a_viewer', '0'), ('b_admin', '0'), ('outsider', '0')) t(who, r);

select is(pg_temp.try_as('a_recruiter', $$update public.flags set status = 'confirmed', reviewed_by = pg_temp.fx('a_admin'), reviewed_at = now() where id = pg_temp.fx('flag_a')$$), '42501',
          'flags: a reviewer cannot record someone else as the reviewer');
select is(pg_temp.try_as('a_recruiter', $$update public.flags set status = 'confirmed', reviewed_at = now() where id = pg_temp.fx('flag_a')$$), '42501',
          'flags: a review must name the reviewer (reviewed_by left null is rejected)');
select is(pg_temp.try_as('a_recruiter', $$update public.flags set org_id = pg_temp.fx('org_b'), reviewed_by = pg_temp.fx('a_recruiter') where id = pg_temp.fx('flag_a')$$), '42501',
          'flags: cannot move a flag to another org');
select is(pg_temp.try_as('anon', $$update public.flags set status = 'cleared' where id = pg_temp.fx('flag_a')$$), '0',
          'flags: anonymous visitors cannot review');

-- Reviewers may only change status, review_note, reviewed_by and reviewed_at:
-- the reason and evidence the flag was raised with stay as the rule wrote them.
select isnt(pg_temp.try_as('a_recruiter', $$update public.flags set evidence = '{}', reason = 'nothing here', reviewed_by = pg_temp.fx('a_recruiter') where id = pg_temp.fx('flag_a')$$), '1',
            'flags: a reviewer cannot rewrite a flag''s reason or evidence');

select is(pg_temp.try_as(who, $$insert into public.flags (attempt_id, org_id, reason) values (pg_temp.fx('att_a'), pg_temp.fx('org_a'), 'manual')$$), r,
          'flags: ' || who || ' raising a flag -> ' || r)
from (values ('a_admin', '42501'), ('a_recruiter', '42501'), ('a_viewer', '42501'), ('anon', '42501'), ('service', '1')) t(who, r);

select is(pg_temp.try_as(who, $$delete from public.flags where id = pg_temp.fx('flag_a')$$), r,
          'flags: ' || who || ' deleting a flag -> ' || r)
from (values ('a_admin', '0'), ('a_recruiter', '0'), ('b_admin', '0'), ('service', '1')) t(who, r);

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------

select is(pg_temp.count_as(who, $$select 1 from public.notes where org_id in (pg_temp.fx('org_a'), pg_temp.fx('org_b'))$$), n,
          'notes: ' || who || ' reads ' || n)
from (values ('a_admin', 2), ('a_recruiter', 2), ('a_viewer', 2), ('b_admin', 1), ('outsider', 0), ('anon', 0)) t(who, n);

select is(pg_temp.try_as(who, format(
            $$insert into public.notes (attempt_id, org_id, author_id, body, vote) values (pg_temp.fx('att_a'), pg_temp.fx('org_a'), %L, 'n', 'hire')$$,
            pg_temp.fx(who))), r,
          'notes: ' || who || ' writing their own note on an org A attempt -> ' || r)
from (values ('a_admin', '1'), ('a_recruiter', '1'), ('a_viewer', '1'), ('b_admin', '42501'), ('outsider', '42501')) t(who, r);

select is(pg_temp.try_as('anon', $$insert into public.notes (attempt_id, org_id, author_id) values (pg_temp.fx('att_a'), pg_temp.fx('org_a'), pg_temp.fx('a_admin'))$$), '42501',
          'notes: anonymous visitors cannot write notes');
select is(pg_temp.try_as('a_viewer', $$insert into public.notes (attempt_id, org_id, author_id) values (pg_temp.fx('att_a'), pg_temp.fx('org_a'), pg_temp.fx('a_admin'))$$), '42501',
          'notes: cannot write a note as someone else');

select is(pg_temp.try_as('a_viewer', $$update public.notes set body = 'edited' where id = pg_temp.fx('note_a_viewer')$$), '1',
          'notes: an author edits their own note');
select is(pg_temp.try_as('a_viewer', $$update public.notes set body = 'edited' where id = pg_temp.fx('note_a_admin')$$), '0',
          'notes: a viewer cannot edit the admin''s note');
select is(pg_temp.try_as('a_admin', $$update public.notes set body = 'edited' where id = pg_temp.fx('note_a_viewer')$$), '0',
          'notes: an admin cannot edit someone else''s note');
select is(pg_temp.try_as('b_admin', $$update public.notes set body = 'edited' where org_id = pg_temp.fx('org_a')$$), '0',
          'notes: another org cannot edit org A notes');
select is(pg_temp.try_as('a_viewer', $$update public.notes set author_id = pg_temp.fx('a_admin') where id = pg_temp.fx('note_a_viewer')$$), '42501',
          'notes: cannot hand a note to another author');
select is(pg_temp.try_as('a_viewer', $$update public.notes set org_id = pg_temp.fx('org_b'), attempt_id = pg_temp.fx('att_b') where id = pg_temp.fx('note_a_viewer')$$), '42501',
          'notes: cannot move a note to another org');

select is(pg_temp.try_as(who, format('delete from public.notes where id = %L', pg_temp.fx(note))), r,
          'notes: ' || who || ' deleting ' || note || ' -> ' || r)
from (values ('a_viewer', 'note_a_viewer', '1'), ('a_admin', 'note_a_viewer', '0'),
             ('b_admin', 'note_a_viewer', '0'), ('anon', 'note_a_viewer', '0')) t(who, note, r);

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------

select is(pg_temp.count_as(who, $$select 1 from public.audit_log where org_id in (pg_temp.fx('org_a'), pg_temp.fx('org_b'))$$), n,
          'audit_log: ' || who || ' reads ' || n)
from (values ('a_admin', 1), ('a_recruiter', 0), ('a_viewer', 0), ('b_admin', 1), ('outsider', 0), ('anon', 0), ('service', 2)) t(who, n);

select is(pg_temp.try_as(who, format(
            $$insert into public.audit_log (org_id, actor_id, action) values (pg_temp.fx('org_a'), %L, 'viewed_report')$$,
            pg_temp.fx(who))), r,
          'audit_log: ' || who || ' appending their own action in org A -> ' || r)
from (values ('a_admin', '1'), ('a_recruiter', '1'), ('a_viewer', '1'), ('b_admin', '42501'), ('outsider', '42501')) t(who, r);

select is(pg_temp.try_as('a_viewer', $$insert into public.audit_log (org_id, actor_id, action) values (pg_temp.fx('org_a'), pg_temp.fx('a_admin'), 'forged')$$), '42501',
          'audit_log: cannot log an action as someone else');
select is(pg_temp.try_as('a_viewer', $$insert into public.audit_log (org_id, actor_id, action) values (pg_temp.fx('org_a'), null, 'anonymous')$$), '42501',
          'audit_log: cannot log an action with no actor');
select is(pg_temp.try_as('anon', $$insert into public.audit_log (org_id, action) values (pg_temp.fx('org_a'), 'x')$$), '42501',
          'audit_log: anonymous visitors cannot append');

select is(pg_temp.try_as(who, $$update public.audit_log set action = 'rewritten' where org_id = pg_temp.fx('org_a')$$), '0',
          'audit_log: ' || who || ' cannot edit entries')
from unnest(array['a_admin', 'a_recruiter', 'anon']) who;
select is(pg_temp.try_as(who, $$delete from public.audit_log where org_id = pg_temp.fx('org_a')$$), '0',
          'audit_log: ' || who || ' cannot delete entries')
from unnest(array['a_admin', 'a_recruiter', 'anon']) who;
select is(pg_temp.try_as('service', $$insert into public.audit_log (org_id, action) values (pg_temp.fx('org_a'), 'system')$$), '1',
          'audit_log: service role appends system entries');

-- ---------------------------------------------------------------------------
-- A removed member loses their write access too
-- ---------------------------------------------------------------------------

delete from public.memberships where org_id = pg_temp.fx('org_a') and user_id = pg_temp.fx('a_viewer');
select is(pg_temp.try_as('a_viewer', $$update public.notes set body = 'after removal' where id = pg_temp.fx('note_a_viewer')$$), '0',
          'notes: a removed member can no longer edit their old note');
select is(pg_temp.count_as('a_viewer', $$select 1 from public.notes$$), 0,
          'notes: a removed member can no longer read notes');

select * from finish();
rollback;
