-- Proctoring v2: audio clips in the media table and bucket, a capture reason
-- on each media row, and full screen / microphone waivers on invite
-- accommodations. RLS on media and invite_accommodations is unchanged.
begin;
\ir fixtures/setup.psql

select plan(46);

-- ---------------------------------------------------------------------------
-- media.source and media.reason
-- ---------------------------------------------------------------------------

select is(pg_temp.try_as('owner', format($$ update public.media set source = 'audio' where attempt_id = %L $$, pg_temp.fx('att_a'))), '1',
          'media.source accepts audio');
select is(pg_temp.try_as('owner', format($$ update public.media set source = 'microphone' where attempt_id = %L $$, pg_temp.fx('att_a'))), '23514',
          'media.source still rejects anything else');

select has_column('public', 'media', 'reason', 'media has a reason column');
select col_type_is('public', 'media', 'reason', 'text', 'media.reason is text');
select col_is_null('public', 'media', 'reason', 'media.reason is nullable (older rows have none)');
select is(pg_temp.try_as('owner', format($$ update public.media set reason = null where attempt_id = %L $$, pg_temp.fx('att_a'))), '1',
          'media.reason may be null');
select is(pg_temp.try_as('owner', format($$ update public.media set reason = %L where attempt_id = %L $$, r, pg_temp.fx('att_a'))), '1',
          'media.reason accepts ' || r)
from unnest(array['interval', 'left_window', 'away', 'returned', 'speech', 'start']) r;
select is(pg_temp.try_as('owner', format($$ update public.media set reason = %L where attempt_id = %L $$, r, pg_temp.fx('att_a'))), '23514',
          'media.reason rejects ' || quote_literal(r))
from unnest(array['bored', 'Interval', '']) r;

-- ---------------------------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------------------------

select ok((select allowed_mime_types from storage.buckets where id = 'proctoring') @> array['audio/webm', 'audio/ogg', 'audio/mp4'],
          'bucket proctoring accepts the audio clip types');
select ok((select allowed_mime_types from storage.buckets where id = 'proctoring') @> array['image/jpeg', 'image/webp', 'image/png'],
          'bucket proctoring still accepts the image types');
select ok(not ((select allowed_mime_types from storage.buckets where id = 'proctoring') && array['audio/wav', 'video/webm', 'text/html']),
          'bucket proctoring refuses other audio, video and HTML');
select is((select file_size_limit from storage.buckets where id = 'proctoring'), 2 * 1024 * 1024::bigint,
          'bucket proctoring size limit stays 2 MB');

-- ---------------------------------------------------------------------------
-- Retention purge still covers audio
-- ---------------------------------------------------------------------------

insert into public.media (attempt_id, org_id, source, reason, storage_path)
values (pg_temp.fx('att_a'), pg_temp.fx('org_a'), 'audio', 'speech',
        pg_temp.fx('org_a')::text || '/' || pg_temp.fx('att_a')::text || '/audio/1-clip.webm');
insert into storage.objects (bucket_id, name)
values ('proctoring', pg_temp.fx('org_a')::text || '/' || pg_temp.fx('att_a')::text || '/audio/2-orphan.ogg');

select ok(
  public.purge_media_for_retention(pg_temp.fx('att_a'), now() + interval '10 years')
    @> array[pg_temp.fx('org_a')::text || '/' || pg_temp.fx('att_a')::text || '/audio/1-clip.webm',
             pg_temp.fx('org_a')::text || '/' || pg_temp.fx('att_a')::text || '/audio/2-orphan.ogg'],
  'the media purge returns audio files (with and without a media row) for deletion'
);
select is((select count(*)::int from public.media where attempt_id = pg_temp.fx('att_a')), 0, 'the media purge deletes audio rows');

-- ---------------------------------------------------------------------------
-- invite_accommodations waivers
-- ---------------------------------------------------------------------------

select has_column('public', 'invite_accommodations', c, 'invite_accommodations has ' || c)
from unnest(array['waive_fullscreen', 'waive_microphone']) c;
select col_not_null('public', 'invite_accommodations', c, c || ' is not null')
from unnest(array['waive_fullscreen', 'waive_microphone']) c;
select col_default_is('public', 'invite_accommodations', c, 'false', c || ' defaults to false')
from unnest(array['waive_fullscreen', 'waive_microphone']) c;

select has_function('public', 'set_invite_accommodations', array['uuid', 'integer', 'boolean', 'boolean', 'boolean', 'boolean'],
                    'set_invite_accommodations takes the full screen and microphone waivers');
select hasnt_function('public', 'set_invite_accommodations', array['uuid', 'integer', 'boolean', 'boolean'],
                      'the old four-argument signature is gone (callers use the defaults)');
select is_definer('public', 'set_invite_accommodations', array['uuid', 'integer', 'boolean', 'boolean', 'boolean', 'boolean'],
                  'set_invite_accommodations is still security definer');
select ok(has_function_privilege('authenticated', 'public.set_invite_accommodations(uuid, int, boolean, boolean, boolean, boolean)', 'execute'),
          'authenticated may call it');
select ok(not has_function_privilege('anon', 'public.set_invite_accommodations(uuid, int, boolean, boolean, boolean, boolean)', 'execute'),
          'anon may not call it');

-- inv_a2 has no attempt yet; inv_a has one in progress.
select pg_temp.act_as('a_recruiter');
select lives_ok($$ select public.set_invite_accommodations(pg_temp.fx('inv_a2'), 25, true, false) $$,
                'existing four-argument callers keep working');
select pg_temp.act_as('owner');
select results_eq(
  $$ select extra_time_percent, waive_camera, waive_screen, waive_fullscreen, waive_microphone
       from public.invite_accommodations where invite_id = pg_temp.fx('inv_a2') $$,
  $$ values (25, true, false, false, false) $$,
  'the new waivers default to off'
);
select is(
  (select target from public.audit_log where org_id = pg_temp.fx('org_a') and action = 'set_accommodations' order by id desc limit 1),
  'invite:' || pg_temp.fx('inv_a2') || ' extra_time=+25% waive_camera=true waive_screen=false',
  'the audit row keeps its old wording when the new waivers are off'
);

select pg_temp.act_as('a_admin');
select lives_ok(
  $$ select public.set_invite_accommodations(pg_temp.fx('inv_a2'), 0, false, false, p_waive_fullscreen => true, p_waive_microphone => true) $$,
  'an admin waives full screen and the microphone'
);
select pg_temp.act_as('owner');
select results_eq(
  $$ select extra_time_percent, waive_camera, waive_screen, waive_fullscreen, waive_microphone, set_by
       from public.invite_accommodations where invite_id = pg_temp.fx('inv_a2') $$,
  $$ values (0, false, false, true, true, pg_temp.fx('a_admin')) $$,
  'the full screen and microphone waivers are stored'
);
select is(
  (select target from public.audit_log where org_id = pg_temp.fx('org_a') and action = 'set_accommodations' and actor_id = pg_temp.fx('a_admin')),
  'invite:' || pg_temp.fx('inv_a2') || ' extra_time=+0% waive_camera=false waive_screen=false waive_fullscreen=true waive_microphone=true',
  'the audit row includes the new waivers'
);

select is(
  pg_temp.try_as('a_recruiter', format($$ select public.set_invite_accommodations(%L, 0, false, false, null, false) $$, pg_temp.fx('inv_a2'))),
  '22023', 'a null full screen waiver is refused');
select is(
  pg_temp.try_as('a_recruiter', format($$ select public.set_invite_accommodations(%L, 0, false, false, false, null) $$, pg_temp.fx('inv_a2'))),
  '22023', 'a null microphone waiver is refused');
select is(
  pg_temp.try_as('a_viewer', format($$ select public.set_invite_accommodations(%L, 0, false, false, true, true) $$, pg_temp.fx('inv_a2'))),
  '42501', 'a viewer can''t waive full screen or the microphone');
select is(
  pg_temp.try_as('b_admin', format($$ select public.set_invite_accommodations(%L, 0, false, false, true, true) $$, pg_temp.fx('inv_a2'))),
  '42501', 'another company''s admin can''t either');
select is(
  pg_temp.try_as('a_recruiter', format($$ select public.set_invite_accommodations(%L, 0, false, false, true, true) $$, pg_temp.fx('inv_a'))),
  '55000', 'the new waivers are fixed once the candidate has started');
select is(
  pg_temp.try_as('a_admin', $$ update public.invite_accommodations set waive_microphone = true $$),
  '42501', 'the table still has no direct write path');

-- ---------------------------------------------------------------------------
-- RLS unchanged
-- ---------------------------------------------------------------------------

select policies_are('public', 'media', array['media visible per role'], 'media policies unchanged');
select policies_are('public', 'invite_accommodations', array['members read accommodations'], 'invite_accommodations policies unchanged');

select * from finish();
rollback;
