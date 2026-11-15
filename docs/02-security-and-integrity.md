# 02 · Security and integrity

## Data protection

| Area | Rule |
| --- | --- |
| Tenant isolation | `org_id` on every tenant row; RLS policies; automated tests that attempt cross-org reads |
| Company login | Email + password; authenticator-app MFA required for admins and recruiters, and for viewers when the company shows them proctoring media; SAML SSO later |
| Candidate access | Single-use invite token (long, random, expires) + 6-digit email code before starting |
| Encryption | HTTPS everywhere; encrypted at rest; private buckets with short-lived signed URLs |
| Secrets | Service keys only in server env vars, never in browser code |
| Audit log | Record who viewed or exported each candidate report |
| Retention | Two per-org clocks: media (camera snapshots, screen screenshots) and results (everything else). Deleted automatically; delete on request |

## Protecting the test

- Answer keys, scoring, and variant generators live on the server only.
- Steps are served one at a time from the API.
- Timer is enforced server-side; late answers are rejected; a cron job auto-submits abandoned attempts.
- Every answer autosaves, so refreshes and dropped connections resume with the remaining time.
- Each candidate gets the same scenario structure with **generated numbers** (see `06-assessment-engine.md`), so leaked answers are useless.

## Proctoring

All of this runs in a normal browser with no download. A browser cannot see other apps by itself, so full-screen sharing is how we see other windows.

| Feature | How | Stored | Phase |
| --- | --- | --- | --- |
| Front camera | Snapshot every 30 to 60 s plus on events; on-device face check (no face, multiple faces) | JPEG + events | MVP |
| Other windows | Required **entire-screen** share (verify the shared surface is a monitor, not a tab); periodic screenshots; if sharing stops the task is covered until it is back, and the timer keeps running (D4) | Screenshots | MVP |
| Second monitor | Chromium Window Management API reports multiple displays (with permission) | Event | MVP |
| Browser signals | Tab switch, blur, fullscreen exit, paste | Events | MVP |
| Phone side camera | QR code pairs phone to the attempt via one-time token; phone shows desk, hands, screen | Snapshots, later video | Phase 2 |
| Continuous video | Chunked recording to R2/S3, or managed live streaming | Video | Later, paid |
| Desktop lockdown app | OS-level monitoring | Process list | Only if a client requires it |

Storage estimate: one camera + one screen at one capture per 30 s for 60 minutes ≈ 240 images ≈ 10 to 25 MB per candidate.

## Integrity model: suspicious labels

Decided: **AI labels, company decides.** Same model HackerRank uses.

- Signals (events, snapshot analysis, answer similarity, timing anomalies) produce an attempt-level label: `clear`, `review`, or `suspicious`, plus a list of flags.
- Every flag carries evidence: timestamp, reason, and the matching snapshot or screenshot.
- Recruiters can confirm or clear each flag. Clearing is logged.
- Nothing auto-rejects a candidate. Companies may filter by label; that's their decision.
- Proctoring settings lock once the first candidate starts a published assessment, so every candidate in a round has the same rules. To change them, clone the assessment.

### How HackerRank does it (reference)

- Proctor Mode: screenshots and webcam images every 15 s, analyzed by automated models (face detection via Amazon Rekognition / Google Gemini); flags phones in the webcam feed, unauthorized apps on screen, and similar answers across candidates.
- Recruiters get an Integrity Summary rated High or Medium, plus a session replay with flagged events.
- Recruiters can manually override flags. A suspicion score also lets companies filter.

Our differentiator: make reviewing a flag take seconds (evidence inline), so recruiters actually look instead of bulk-filtering. Optional paid tier later: our team reviews flags before the company sees them.

## Compliance

- **Fair hiring:** tests must be job-related; watch for adverse impact. Simulations mirroring real tasks help here. Have a working professional review each scenario.
- **Consent:** tell candidates what is captured, why, and for how long, before starting.
- **Biometrics:** detect whether a face is present; do not build face recognition or identity matching without legal review (e.g., Illinois BIPA). Some jurisdictions also regulate automated hiring tools.
- **Accessibility:** extra-time accommodations; a path for candidates without a webcam.
- **SOC 2:** not needed for pilots; start once there's revenue.

Not legal advice. Check hiring-law points with a lawyer before selling to larger employers.

## As built (Nov 2026)

- **Tenant isolation:** RLS on all 17 tables (the 16 tenant tables plus `profiles`); `pnpm test:rls` runs 28 tests that sign in as admin, recruiter, and viewer of two companies and try cross-company reads and writes, role escalation, secret-table reads, and anonymous access.
- **Candidate secrets** (invite token hash, email-code hash, seed, session hash) are in `invite_secrets` / `attempt_secrets`, readable only by the server. Raw tokens and codes are never stored.
- **Service key** is used only in server code marked `server-only` (Supabase Auth admin calls such as sending teammate invites, and candidate routes). Company-side writes use the signed-in user's client so RLS applies. Teammates' emails and invite state come from `public.profiles` (one row per auth user, kept in sync by a trigger on `auth.users` that logs and skips on any error so it can never block sign-up), read with the user's own client: RLS shows your own profile and those of people who share a company with you.
- **Answer keys** live in `src/lib/engine/server/` and step types' `server.ts`, all `server-only`; a unit test fails if any key value appears in what's sent to the candidate.
- **Company URLs** return 404 to non-members, so they don't reveal which companies exist.
- **Email links and scanners:** Microsoft 365 Safe Links can open one-time links before the recipient, so no link uses its token on page load. Candidate links (`/a/{token}`) need a Continue click. Teammate invites and sign-up confirmation land on `/auth/confirm`, which only shows an "Accept invite" or "Confirm email" button; the button's POST verifies the token (decision D13 / Q3). The email templates are in `supabase/templates/` and must also be set in the hosted project's dashboard.
- **Two-factor (MFA):** admins and recruiters must use an authenticator app (TOTP) and be at `aal2` to open company pages or run company actions; viewers must too when the company turns on `viewers_see_media` (decision D1). The rule lives in `src/app/app/account/mfa-gate.ts` and is applied by the proxy (`src/lib/supabase/proxy.ts`) and by `requireOrgMembership` / `requireMembership`. It is enforced in app code, not in RLS. Without a factor they are sent to `/app/account/security` to enrol; with one but only a password so far, to `/app/account/verify`.
- **Proctoring (step 7):** the system check shows a monitoring notice (what, why, who sees it, how long) and records consent with its version before asking for the camera or screen. Then a camera check with a start photo and a required entire-screen share (a window or tab is refused when the browser reports the surface). In the workspace, browser signals (leaving the window, leaving full screen, copy, paste by length only, second display) go to `integrity_events` in batches; camera and screen snapshots every 45 s and when the candidate leaves the window go straight from the browser to the private `proctoring` bucket through signed upload URLs. If the camera or share stops, the task area is covered until it is back; the server timer keeps running (D4: it never pauses). Each down period is recorded as a `monitoring_down` event (source, from, to, length, and whether it ended on reconnect, at submit or at the deadline; a gap left open by a refresh or a closed tab ends at the next reconnect or at submit/deadline) and the `downtime` rule flags one gap of 30 s or more, or 60 s of covered time in total (camera and screen gaps at the same time count once), the same bar as time away from the window (`THRESHOLDS.longDowntimeSeconds` / `totalDowntimeSeconds`). The flag lists every gap and the total, so the recruiter can judge whether the lost time mattered; there is no add-time feature yet. Rules in `src/lib/proctoring/rules.ts` turn signals into one flag per rule with evidence (events and the nearest snapshots) and set `attempts.integrity_label`. The candidate report lists flags with thumbnails (signed URLs created with the member's own client, so storage policies apply); admins and recruiters confirm or clear with a note, written to `audit_log`; reviewers can change only the review columns.
- **Retention (decision D2: two clocks):** each company sets two periods in Settings (admins only, audited). Media (camera snapshots and screen screenshots): default 90 days, 30 to 365. Results (the invite with email and name, the attempt, answers, scores, integrity events, flags, notes and votes): default 365 days, 30 to 730. Media is never kept longer than results; the database enforces the ranges and that rule (`organizations_retention_range`). Both clocks run from the candidate's last activity: the latest of invite creation, invite expiry, attempt deadline and submission. A daily cron (`/api/cron/retention`) first deletes the media rows and files of attempts past the media period (`purge_media_for_retention`; the results stay), then deletes every candidate past the results period entirely (`purge_candidate_for_retention`; rows are deleted, no anonymised shell). Each purge writes an audit row with only the attempt or invite id. Admins can also delete one candidate's data from the report at any time. The monitoring notice states both periods from the company's settings, and its consent version changes with the wording.
- **Not built yet:** on-device face check, phone side camera, email confirmation code (Q2, waits for Resend), Sign in with Microsoft.
