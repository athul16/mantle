-- Proctoring (step 7). See docs/02-security-and-integrity.md.
--
-- 1. A private storage bucket for camera and screen snapshots. Paths are
--    <org_id>/<attempt_id>/<source>/<file>.jpg. Candidates upload with signed
--    upload URLs the server creates, so there are no insert, update or delete
--    policies: only the server writes. Org members read their own org's
--    snapshots with the same rule as the media table (admins and recruiters;
--    viewers only when the org turns on viewers_see_media).
-- 2. flags.rule: which rule raised the flag, one flag per rule per attempt, so
--    re-running the rules updates a flag instead of adding another.
-- 3. flags.review_note: the reviewer's note when confirming or clearing.
-- 4. Reviewers may change only the review columns. The reason and evidence
--    stay as the rule wrote them (pgTAP found the old policy allowed rewriting
--    them).

-- ---------------------------------------------------------------------------
-- 1. Storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proctoring', 'proctoring', false, 2 * 1024 * 1024, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Who may see an org's proctoring media. Mirrors the "media visible per role" policy.
create function private.can_view_media(target_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_manage_org(target_org)
      or (
        private.has_org_role(target_org, array['viewer'])
        and exists (
          select 1 from public.organizations o
          where o.id = target_org and coalesce((o.settings->>'viewers_see_media')::boolean, false)
        )
      );
$$;
revoke all on function private.can_view_media(uuid) from public, anon;
grant execute on function private.can_view_media(uuid) to authenticated;

-- First path segment is the org id. Anything that isn't a uuid is readable by nobody.
create policy "members read proctoring snapshots" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'proctoring'
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and private.can_view_media(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------------------
-- 2 and 3. Flags
-- ---------------------------------------------------------------------------

alter table public.flags
  add column rule text,
  add column review_note text,
  add constraint flags_attempt_rule_key unique (attempt_id, rule),
  add constraint flags_review_note_length check (review_note is null or length(review_note) <= 2000);

-- ---------------------------------------------------------------------------
-- 4. Reviewers change review columns only
-- ---------------------------------------------------------------------------

revoke update on public.flags from authenticated;
grant update (status, review_note, reviewed_by, reviewed_at) on public.flags to authenticated;
