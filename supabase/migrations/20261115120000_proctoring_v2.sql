-- Proctoring v2: audio clips, capture reasons, and full screen / microphone
-- waivers.
--
-- 1. public.media: source may be 'audio' (short clips recorded when speech is
--    heard, stored at <org>/<attempt>/audio/<file>.<webm|ogg|m4a>), and each
--    row may say why it was captured (reason, the CAPTURE_REASONS list in
--    src/lib/proctoring/config.ts). Older rows have no reason.
-- 2. The private proctoring bucket also accepts the audio clip types. The size
--    limit stays 2 MB. Uploads still go straight from the browser through
--    signed upload URLs.
-- 3. public.invite_accommodations: waive_fullscreen and waive_microphone. The
--    gaze check needs the camera, so waiving the camera waives it too (in app
--    code). set_invite_accommodations() takes two new trailing parameters with
--    defaults, so existing four-argument callers keep working; the audit row
--    lists them when either is set.
--
-- The retention purge (purge_media_for_retention, purge_candidate) finds files
-- by media rows and by the <org>/<attempt>/ prefix in storage.objects, so
-- audio clips are deleted with the snapshots without changes here.

-- ---------------------------------------------------------------------------
-- 1. media
-- ---------------------------------------------------------------------------

alter table public.media drop constraint media_source_check;
alter table public.media
  add constraint media_source_check check (source in ('camera', 'screen', 'phone', 'audio'));

alter table public.media add column reason text;
alter table public.media
  add constraint media_reason_check
  check (reason is null or reason in ('interval', 'left_window', 'away', 'returned', 'speech', 'start'));

-- ---------------------------------------------------------------------------
-- 2. Bucket
-- ---------------------------------------------------------------------------

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/webp', 'image/png', 'audio/webm', 'audio/ogg', 'audio/mp4']
where id = 'proctoring';

-- ---------------------------------------------------------------------------
-- 3. Accommodations
-- ---------------------------------------------------------------------------

alter table public.invite_accommodations
  add column waive_fullscreen boolean not null default false,
  add column waive_microphone boolean not null default false;

drop function public.set_invite_accommodations(uuid, int, boolean, boolean);

create function public.set_invite_accommodations(
  p_invite_id uuid,
  p_extra_time_percent int,
  p_waive_camera boolean,
  p_waive_screen boolean,
  p_waive_fullscreen boolean default false,
  p_waive_microphone boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org    uuid;
  v_status text;
begin
  select i.org_id, i.status into v_org, v_status
  from public.invites i
  where i.id = p_invite_id
  for update;
  -- Same error for a missing invite and another org's, so nothing leaks.
  if v_org is null or not private.can_manage_org(v_org) then
    raise exception 'not allowed to change accommodations for this invite' using errcode = '42501';
  end if;
  if p_extra_time_percent is null or p_extra_time_percent not in (0, 25, 50, 100)
     or p_waive_camera is null or p_waive_screen is null
     or p_waive_fullscreen is null or p_waive_microphone is null then
    raise exception 'extra time must be 0, 25, 50 or 100 percent and every waiver true or false' using errcode = '22023';
  end if;
  if v_status not in ('invited', 'expired') or exists (
    select 1 from public.attempts a
    where a.invite_id = p_invite_id and a.org_id = v_org and a.started_at is not null
  ) then
    raise exception 'accommodations are fixed once the candidate has started' using errcode = '55000';
  end if;

  insert into public.invite_accommodations as ia
    (invite_id, org_id, extra_time_percent, waive_camera, waive_screen, waive_fullscreen, waive_microphone, set_by, set_at)
  values
    (p_invite_id, v_org, p_extra_time_percent, p_waive_camera, p_waive_screen, p_waive_fullscreen, p_waive_microphone,
     (select auth.uid()), now())
  on conflict (invite_id) do update
    set extra_time_percent = excluded.extra_time_percent,
        waive_camera       = excluded.waive_camera,
        waive_screen       = excluded.waive_screen,
        waive_fullscreen   = excluded.waive_fullscreen,
        waive_microphone   = excluded.waive_microphone,
        set_by             = excluded.set_by,
        set_at             = excluded.set_at;

  insert into public.audit_log (org_id, actor_id, action, target)
  values (
    v_org,
    (select auth.uid()),
    'set_accommodations',
    format('invite:%s extra_time=+%s%% waive_camera=%s waive_screen=%s',
           p_invite_id, p_extra_time_percent, p_waive_camera::text, p_waive_screen::text)
    || case when p_waive_fullscreen or p_waive_microphone
            then format(' waive_fullscreen=%s waive_microphone=%s', p_waive_fullscreen::text, p_waive_microphone::text)
            else '' end
  );
end;
$$;
revoke all on function public.set_invite_accommodations(uuid, int, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_invite_accommodations(uuid, int, boolean, boolean, boolean, boolean) to authenticated;
