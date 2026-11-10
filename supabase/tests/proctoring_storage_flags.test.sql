-- Proctoring (step 7): the private `proctoring` storage bucket, who can read
-- the snapshots in it, and how flags are reviewed.
--
-- Snapshot paths are <org_id>/<attempt_id>/<source>/<file>. Candidates upload
-- through signed upload URLs the server creates, so no company user (and no
-- anonymous visitor) may write to the bucket directly. Admins and recruiters
-- read their own org's snapshots; viewers only when the org turns on
-- `viewers_see_media`.
begin;
\ir fixtures/setup.psql

select plan(35);

-- ---------------------------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------------------------

select is((select public from storage.buckets where id = 'proctoring'), false, 'bucket proctoring exists and is private');
select ok((select file_size_limit from storage.buckets where id = 'proctoring') between 1 and 5 * 1024 * 1024,
          'bucket proctoring caps file size at 5 MB or less');
select ok((select allowed_mime_types from storage.buckets where id = 'proctoring') @> array['image/jpeg'],
          'bucket proctoring accepts JPEG snapshots');
select ok(not ((select allowed_mime_types from storage.buckets where id = 'proctoring') @> array['text/html']),
          'bucket proctoring refuses other file types (no HTML)');

-- ---------------------------------------------------------------------------
-- Helper
-- ---------------------------------------------------------------------------

select has_function('private', 'can_view_media', array['uuid'], 'private.can_view_media(uuid) exists');
select is((select prosecdef from pg_proc where oid = 'private.can_view_media(uuid)'::regprocedure), true,
          'private.can_view_media is security definer');

-- ---------------------------------------------------------------------------
-- Reading snapshots
-- ---------------------------------------------------------------------------

insert into storage.objects (bucket_id, name) values
  ('proctoring', pg_temp.fx('org_a')::text || '/' || pg_temp.fx('att_a')::text || '/camera/1.jpg'),
  ('proctoring', pg_temp.fx('org_b')::text || '/' || pg_temp.fx('att_b')::text || '/camera/1.jpg'),
  ('proctoring', 'not-a-uuid/whatever.jpg');

create function pg_temp.snap(org text) returns text language sql as $$
  select format($q$select 1 from storage.objects where bucket_id = 'proctoring' and name like %L$q$, pg_temp.fx(org)::text || '/%')
$$;

select is(pg_temp.count_as(who, pg_temp.snap('org_a')), n, 'storage: ' || who || ' reads org A snapshots -> ' || n)
from (values ('a_admin', 1), ('a_recruiter', 1), ('a_viewer', 0), ('b_admin', 0), ('b_viewer', 0), ('outsider', 0), ('anon', 0)) t(who, n);

select is(pg_temp.count_as('b_admin', pg_temp.snap('org_b')), 1, 'storage: b_admin reads org B snapshots');
select is(pg_temp.count_as('a_admin', $$select 1 from storage.objects where bucket_id = 'proctoring' and name like 'not-a-uuid/%'$$), 0,
          'storage: a path without an org id is readable by nobody (and does not error)');

-- Viewers see media once the org allows it.
update public.organizations set settings = settings || '{"viewers_see_media": true}' where id = pg_temp.fx('org_a');
select is(pg_temp.count_as('a_viewer', pg_temp.snap('org_a')), 1, 'storage: a_viewer reads org A snapshots when viewers_see_media is on');
select is(pg_temp.count_as('a_viewer', pg_temp.snap('org_b')), 0, 'storage: ... but still not org B''s');
select is(pg_temp.count_as('a_viewer', $$select 1 from public.media where org_id = pg_temp.fx('org_a')$$), 1,
          'media rows: a_viewer reads them too when viewers_see_media is on');
update public.organizations set settings = settings - 'viewers_see_media' where id = pg_temp.fx('org_a');

-- ---------------------------------------------------------------------------
-- Writing snapshots: only the server (signed upload URLs / service role)
-- ---------------------------------------------------------------------------

select is(pg_temp.try_as(who,
            format($q$insert into storage.objects (bucket_id, name) values ('proctoring', %L)$q$,
                   pg_temp.fx('org_a')::text || '/' || pg_temp.fx('att_a')::text || '/camera/x.jpg')),
          '42501', 'storage: ' || who || ' cannot upload into the bucket directly')
from unnest(array['a_admin', 'a_recruiter', 'anon']) who;

select is(pg_temp.try_as('a_admin', $$update storage.objects set name = name || '.moved' where bucket_id = 'proctoring'$$), '0',
          'storage: an admin cannot rename snapshots');
select is(pg_temp.try_as('a_admin', $$delete from storage.objects where bucket_id = 'proctoring'$$), '0',
          'storage: an admin cannot delete snapshots through the API');

-- ---------------------------------------------------------------------------
-- Flags: rule column, one open flag per rule, review notes
-- ---------------------------------------------------------------------------

select has_column('public', 'flags', 'rule', 'flags.rule names the rule that raised the flag');
select has_column('public', 'flags', 'review_note', 'flags.review_note holds the reviewer''s note');

update public.flags set rule = 'left_window' where id = pg_temp.fx('flag_a');
select throws_ok(
  $$ insert into public.flags (attempt_id, org_id, reason, rule) values (pg_temp.fx('att_a'), pg_temp.fx('org_a'), 'again', 'left_window') $$,
  '23505', null, 'flags: one flag per rule per attempt'
);
select lives_ok(
  $$ insert into public.flags (attempt_id, org_id, reason) values (pg_temp.fx('att_a'), pg_temp.fx('org_a'), 'manual one'),
                                                                 (pg_temp.fx('att_a'), pg_temp.fx('org_a'), 'manual two') $$,
  'flags: flags without a rule are not limited'
);

select is(pg_temp.try_as(who,
            format($q$update public.flags set status = 'cleared', review_note = 'Explained by the candidate', reviewed_by = %L, reviewed_at = now()
                       where id = pg_temp.fx('flag_a')$q$, pg_temp.fx(who))),
          r, 'flags: ' || who || ' clearing with a note -> ' || r)
from (values ('a_admin', '1'), ('a_recruiter', '1'), ('a_viewer', '0'), ('b_admin', '0')) t(who, r);

select is(pg_temp.try_as('a_recruiter',
            $$update public.flags set rule = 'other', reviewed_by = pg_temp.fx('a_recruiter') where id = pg_temp.fx('flag_a')$$),
          '42501', 'flags: a reviewer cannot change which rule raised a flag');
select is(pg_temp.try_as('a_recruiter',
            $$update public.flags set evidence = '{}', reviewed_by = pg_temp.fx('a_recruiter') where id = pg_temp.fx('flag_a')$$),
          '42501', 'flags: a reviewer cannot change the evidence');
select is(pg_temp.try_as('a_recruiter',
            $$update public.flags set reason = 'nothing', reviewed_by = pg_temp.fx('a_recruiter') where id = pg_temp.fx('flag_a')$$),
          '42501', 'flags: a reviewer cannot change the reason');
select is(pg_temp.try_as('service',
            $$update public.flags set evidence = '{"events":[]}' where id = pg_temp.fx('flag_a')$$),
          '1', 'flags: the server still updates evidence while a flag is open');

select * from finish();
rollback;
