# 10 · Progress

Where the phase 1 build stands. Update this file whenever a build step lands.

_Last updated: 2026-11-15._

## Skeleton build order (from `08-roadmap-and-open-questions.md`)

| # | Step | Status | What exists |
| --- | --- | --- | --- |
| 1 | Repo, app, Supabase, schema + RLS | ✅ Done | Next.js 16 app; Supabase cloud project; 3 migrations; 28 cross-org isolation tests |
| 2 | Company auth, orgs, memberships | ✅ Done | Sign up / log in, onboarding, company URLs (`/app/<slug>`), org switcher, team page (invite, change role, remove, last-admin guard) |
| 3 | Jobs, invites, invite emails | ✅ Done | `/app/<slug>/jobs`: assessments (create, edit, clone, lock state), jobs, invites by paste or CSV (max 200, deduped), invite list with resend and revoke, role checks plus RLS; 19 tests |
| 4 | Candidate flow: verify, system check, instructions, workspace, timer, autosave, submit | ✅ Done | `/a/<token>`: landing (token not used up on load), email code with lockout, consent, system check (camera and screen placeholder), instructions, timed workspace, autosave, review, submit, scoring stored, resume, expired; 11 tests |
| 5 | Engine: step type interface + `inbox_reply` + `spreadsheet` | ✅ Done | Step-type interface, seeded variants, server-only scoring; `numeric`, `inbox_reply` (rubric, needs review, AI scorer seam), `spreadsheet` (in-house grid, partial credit); `demo-petty-cash` and `demo-mini-close` scenarios; `/dev/engine` scenario picker; 104 unit tests |
| 6 | Results table + candidate report | ✅ Done | Per-job results table (sort, filter, search, needs-review badge); candidate report with answers next to the expected answer, per-task points, rubric review for `inbox_reply` (`review_rubric_step` function), timeline, notes with hire / no hire vote; viewers read-only on scores (PR #19) |
| 7 | Proctoring: browser signals, camera snapshots, screen share, flags | ✅ Done | Real camera and screen checks; browser signals (blur, full-screen exits, copy/paste); webcam and screen snapshots to a private per-org bucket; rules turn signals into flags with evidence; flags section on the report where admins and recruiters confirm or clear with a note (PR #23) |
| 8 | `journal_entry` + `document_review`; Example 1 (or Example 4) end to end | ✅ Done | `journal_entry` and `document_review` with `demo-entries-review` (PR #18); Example 4 as `harbor-lane-bank-rec` v1: Harbor Lane Coffee bank rec, journal entries and a reply to Dana, 30 minutes, 100 points (PR #22). Not published to the cloud yet; needs an accountant's review |

8 of 8 skeleton steps. Stages A to D are built in code: send a link, take a proctored test, review and judge the result, with a real accounting simulation. Stage E (pilot-ready) is next.

## Current implementation

What runs today, from the code on main and the cloud project (2026-11-15, main at `97d2aa2`).

**Hosting.** Vercel (Hobby) builds and deploys production from `main` (previews per PR) at `https://assessment-platform-rho-ecru.vercel.app`. Hobby blocks deploys of commits whose author isn't on the Vercel team, so collaborators' PR previews show BLOCKED; their code deploys once merged. One Supabase cloud project (`fexzsiizgcjuddtoeaui`, Free plan) holds the database, auth and storage. Email goes through Resend when `RESEND_API_KEY` is set; otherwise messages are written to `.dev-outbox/`. Production has Resend in **test mode**: `EMAIL_FROM` is `Assessment Platform <onboarding@resend.dev>`, so invites and codes only reach the Resend account owner's address until a domain is verified. `/api/health` returns all true.

**Cloud test data.** One test admin (`pilot-admin@example.com`, company slug `test`, TOTP enrolled; password kept by the founder, not in the repo) with one job, "Demo Job", on `demo-petty-cash`.

**Database.** 19 tables in `public`: `organizations`, `memberships`, `profiles`, `jobs`, `assessments`, `scenarios`, `invites`, `invite_secrets`, `invite_accommodations`, `attempts`, `attempt_secrets`, `step_responses`, `action_events`, `integrity_events`, `media`, `flags`, `notes`, `audit_log`, `ai_shadow_scores`. RLS on every table; answer keys and tokens live in the `*_secrets` tables and AI shadow scores in `ai_shadow_scores`, which only the server reads. 13 migrations, all applied in the cloud with versions matching the files (the last 7 applied 2026-11-15):

| Migration | Adds |
| --- | --- |
| `20261109023434_initial_schema` | Tables, RLS policies, `private` helper functions, triggers |
| `20261109024040_harden_helpers` | Locked-down helper functions (`search_path`, grants) |
| `20261109034338_org_slug` | Company URLs (`organizations.slug`), `create_organization` |
| `20261110120000_review_rubric_step` | `review_rubric_step`: a recruiter scores a rubric step, score and audit log updated |
| `20261110160000_proctoring` | Private `proctoring` bucket (2 MB images), `private.can_view_media`, `flags.rule` and `flags.review_note`, reviewers may change only review columns |
| `20261110200000_retention` | Per-company retention, daily purge, delete candidate on request (PR #25) |
| `20261111100000_last_admin_guard` | Trigger: an org always keeps one admin (D13 Q4, PR #34) |
| `20261111100100_profiles` | `profiles` synced from `auth.users`; teammates read without the service key (D13 Q5, PR #34) |
| `20261111110000_retention_clocks` | Two retention periods: media 90 days (30–365), results 365 (30–730); `set_retention` (D2, PR #32) |
| `20261111120000_invite_sends_and_unique` | `invites.last_sent_at`, `sent_count`; one live invite per email per job (D12, PR #35) |
| `20261111121000_accommodations_contact_email` | `invite_accommodations` (extra time, camera/screen waiver), company contact email (D9, PR #35) |
| `20261111140000_auto_score` | `auto_score` kept next to the final `score`, write-once (D11, PR #33) |
| `20261111141000_ai_shadow_scores` | Server-only AI shadow scores and `private.ai_shadow_agreement` view (D8, PR #33) |

**Look and feel.** Every screen follows the Mantle prototype (`docs/design/prototype.html`, see `13-design-system.md`). Prototype features the backend doesn't support yet are listed below under "Prototype features not built yet".

**Company side** (`/app/<slug>`, opens on Jobs): jobs (create job dialog), job page with the candidates list, invite page (`/jobs/<id>/invite`: paste or CSV), resend and revoke, assessments library and configure screen, candidates results table, candidate report (answers vs expected, rubric review, flags with snapshots, notes and vote, timeline), team. Plus sign up, log in, onboarding, `/auth/*` callbacks and set password.

**Candidate side** (`/a/<token>`): landing → `verify` (6-digit email code) → `check` (consent, camera, entire-screen share) → `instructions` → `workspace` → `review` → `done`. Server routes under `/api/candidate/*`: `code`, `verify`, `start`, `state`, `answer`, `event`, `submit`, and `proctoring/{consent,signals,upload,media}`.

**Engine.** Five step types: `numeric`, `inbox_reply` (rubric; human review, AI scorer not wired), `spreadsheet`, `journal_entry`, `document_review`. Four scenarios in code: `demo-petty-cash`, `demo-mini-close`, `demo-entries-review`, `harbor-lane-bank-rec`. Only `demo-petty-cash` v1 is published to the cloud; publishing is `pnpm scenarios:publish`. `/dev/engine` previews any scenario.

**Proctoring.** Rules (`src/lib/proctoring/rules.ts`): `left_window`, `paste`, `fullscreen`, `screen_share`, `camera`, `multiple_displays`. Camera and screen snapshots every 45 s and on leaving the window, uploaded with signed URLs. Each attempt gets an integrity label (`clear`, `review`, `suspicious`); nothing auto-rejects.

**Tests.** 48 Vitest files (498 tests, 27 of them component files), 14 pgTAP files (820 assertions), 19 Playwright specs (63 tests, 3 browsers, axe on every page), no open `test.fixme`. CI on every PR: `checks` (lint, types, unit, component), `database` (pgTAP), `e2e`. Work is test-first (`11-testing.md`).

**Known gaps before a pilot.** No verified email domain (Resend test mode only reaches one address); Supabase Auth email templates from PR #34 not pasted into the dashboard yet (teammate invite links break until they are); `ANTHROPIC_API_KEY` not set in Vercel (shadow scoring skips); `CRON_SECRET` status unchecked; Supabase still on Free (pauses after 7 idle days); `harbor-lane-bank-rec` waits on an accountant. Pilot decisions D1–D16 are decided (`decisions/2026-11-10-pilot-decisions.md`) and the code for them is merged.

## Prototype features not built yet

The prototype (`design/prototype.html`) shows these, but the backend doesn't support them, so the app leaves them out (no dead buttons, no made-up data). To build later:

**Recruiter side**
- Hiring stages: stage column and filter, stage select and Reject on the report, Board view, bulk Advance / Reject.
- Messaging candidates (bulk, per row, from the report); reminders (manual, and "2 days before invites close"); extend one candidate's invite; "Invite again" after a revoke; who revoked and when.
- Accommodations: the recruiter drawer (extra time %, no camera, no screen sharing, note) and the "+N min" badges everywhere.
- Company profile: logo upload, a named candidate contact (shown on emails, landing, done and error pages), teammate display names, inviter name on set-password, resending a teammate invite, a Team step in onboarding.
- A two-factor on/off column on Team. Teammates are now read from `profiles` without the service key (PR #34), and factor status isn't in there yet.
- Settings: "Let viewers see proctoring snapshots"; per-assessment "Who can see snapshots", extra-time toggle, phone side camera.
- Assessments: preview as candidate, Build your own, pharmacy library, "New" badges and recruiter-facing descriptions.
- Jobs: archived jobs, last activity, row actions menu, job owner.
- Invite page: public link, editing the invite message, full email preview.
- Export: PDF reports, snapshots, stage and notes columns, a server-side export logged with the user's name (CSV is built in the browser today); More filters; pagination.
- Report: AI-suggested rubric scores with reasoning and "Accept AI", the one-line summary, score distribution curve (a strip of real scores is shown), PDF download, the submitted spreadsheet viewer, all-snapshots and full activity log pages, extra time / one device and IP rows (camera and screen gaps already show as a downtime flag). Analytics tab.

**Candidate side**
- Accommodation requests (links in the invite email, landing and verify; the request dialog), the no-webcam path and the approved no-camera option.
- Saving offline on the device; a Send button and sent state for replies, "Write a follow-up".
- A materials list with separate read-only source tabs (bank statement, cash ledger).
- Task-complete detection (green task pills; review statuses such as "Entry 2 out of balance" and last change time).
- The done-page survey and a "[X business days]" promise; "Email me the link" on the phone page; a privacy page for the email footer link; a per-company sender name on emails.

## The MVP, piece by piece

1. **Foundation** (done): database, tenant isolation, server-only answer keys.
2. **Company side** (done): companies, teams, URLs, assessments, jobs, invites, results table and candidate report with rubric review and notes.
3. **Candidate side** (done): invite link → 6-digit email code → consent → system check → instructions → timed workspace (inbox left, task right) → review → submit. Server-owned timer, autosave, resume after refresh.
4. **Engine** (done for MVP step types): turns a scenario into tasks with each candidate's own numbers, then scores them. `numeric`, `inbox_reply` (rubric; AI scorer not wired yet), `spreadsheet`, `journal_entry` and `document_review` are built.
5. **Integrity** (built): browser signals, webcam snapshots, full-screen share, flags with evidence that a recruiter confirms or clears. Nothing auto-rejects.
6. **Content** (first draft): Example 4 from `07-accounting-simulations.md` is built as `harbor-lane-bank-rec`; it still needs a working accountant's review and publishing.

## Stages to the MVP

| Stage | Build | Unlocks |
| --- | --- | --- |
| A. A candidate can take a test | Steps 3 + 4, using the demo scenario | First end-to-end run: send link → take test → see score |
| B. A company can judge results | Step 6 | A recruiter can actually use it |
| C. Real accounting content | Steps 5 + 8 | The test screens accountants |
| D. Trustworthy results | Step 7 | Companies can believe the scores |
| E. Pilot-ready | Deploy on Vercel, Resend Pro, Supabase Pro, consent text, accountant review, admin MFA | First pilot company (the phase 1 gate) |

**Stage E, batch 3 (done):** PR #24 production email guard (invites and codes error clearly on Vercel until Resend is set), `/api/health`, error pages, code resend cooldown, `docs/12-pilot-runbook.md`; PR #25 per-org retention (default 180 days, 30 to 730), admin delete on request, daily purge at 03:30 UTC (`CRON_SECRET`), migration `20261110200000_retention`; PR #27 TOTP required for company admins (`/app/account/security`, `/app/account/verify`) and a real 404 for another company's candidate report. Open team decisions: `decisions/2026-11-10-pilot-decisions.md`. Vercel is done; Resend, Supabase Pro, consent wording and the accountant review are on people.

## Waiting on people, not code

- [ ] Resend: buy and verify a sending domain, then set `EMAIL_FROM` to an address on it (production runs in Resend test mode from `onboarding@resend.dev` until then), and point Supabase Auth SMTP at Resend.
- [ ] Supabase → Authentication → Emails: paste `supabase/templates/invite.html` (Invite user) and `confirmation.html` (Confirm signup) from PR #34; URL Configuration: remove `/auth/callback`, keep `/auth/confirm` and `/auth/set-password`.
- [ ] Supabase → Authentication: turn on leaked-password protection (security advisor warning).
- [ ] Vercel env vars: `ANTHROPIC_API_KEY` (server only; D8 shadow scoring skips without it); confirm `CRON_SECRET` is set.
- [x] Vercel env vars `RESEND_API_KEY` and `EMAIL_FROM` (Production and Preview); `/api/health` returns all true (2026-11-15).
- [x] Vercel project from the GitHub repo, with the env vars in `01-architecture-and-hosting.md` (production deploys from main).
- [x] Decide D1 to D16 in `decisions/2026-11-10-pilot-decisions.md` (decided 2026-11-10; they also settle Q2–Q9, S1/S2, the PR #19 report rules and the PR #23 proctoring questions). Q2 (email code on sign-up) waits for a verified Resend domain.
- [x] Apply all migrations to the cloud project (13, last 7 applied 2026-11-15; versions match `supabase/migrations/`).
- [x] Candidate report for another company's invite id returns a real 404 (PR #27).
- [ ] Publish `harbor-lane-bank-rec` (`pnpm scenarios:publish`) after an accountant reviews it.
- [ ] D3 free legal checks (compare notice with competitors, pilot firm HR review, UNC law clinics / Launch Chapel Hill); paid lawyer before charging, leaving NC, or turning on AI scoring.
- [ ] D14: ask pilot firms what they would pay (first round free).

## Log

| Date | Landed |
| --- | --- |
| 2026-11-15 | PR #36 merged: Mantle UI rebuild (Andy). Cloud: migrations `20261111100000` to `20261111141000` applied (versions match the files). Production email live in Resend test mode (`onboarding@resend.dev`, delivers only to the Resend account owner). `/api/health` all true |
| 2026-11-15 | Pilot decisions built and merged, each test-first with CI green: PR #30 Harbor Lane `{{first_name}}` greeting and NSF date order (D10); PR #31 camera/screen downtime recorded and flagged, timer never pauses (D4); PR #34 MFA for recruiters (and viewers when `viewers_see_media`), button-confirm auth links, last-admin trigger, `profiles` (D1, D13); PR #32 two retention periods and required Monitored / Not monitored choice (D2, D5); PR #35 invite last sent and send count, unique live invites, per-invite accommodations, contact email (D12, D9); PR #33 `auto_score` and shadow AI scoring with Claude Sonnet 5.5 (D11, D8); PR #37 flaky downtime test fix |
| 2026-11-12 | Mantle UI from the prototype (`docs/design/prototype.html`, `13-design-system.md`): design tokens and components ported (`src/app/mantle.css`, `src/components/`), every company and candidate screen and both emails restyled. Behaviour changes: `/app/<slug>` opens Jobs (no dashboard); invite form moved to `/jobs/<id>/invite`; assessment configure screens at `/jobs/assessments/new` and `/jobs/assessments/<id>`; monitoring consent moved to the verify page (consent version `2026-11-11.verify-table`); explicit start photo and a connection check on the system check; task-centred workspace with calculator, new-mail toast and one-minute warning; report shows percentile, votes and integrity signal counts |
| 2026-11-14 | CI fixes for the Mantle UI (PR #36): `/app/<slug>` now redirects to Jobs over HTTP in `src/proxy.ts` (no client-side jump); the verify form keeps a name, code and consent typed before hydration; account-menu links no longer prefetch (404s after sign-out); screenshot baselines regenerated |
| 2026-11-15 | Main (PRs #32, #35, #33, #37) merged into the Mantle UI (PR #36): Configure assessment asks Monitored / Not monitored with nothing preselected (camera and screen switches appear only when Monitored); Settings has the two retention fields and the candidate contact email; the job page shows last sent date and send count, and the invite drawer sets accommodations (extra time, camera / screen waivers), shown on the row and the report; the report shows the automatic score next to the final one; the verify page states both retention periods and the contact line, and the instructions show extra time and waivers. Consent version `2026-11-15.verify-table.contact` |
| 2026-11-10 | Batch 3 (stage E): PR #24 launch hardening and pilot runbook; PR #25 retention and delete on request (migration `20261110200000_retention`); PR #27 admin MFA and candidate report 404; PR #26 pilot decisions brief. All test-first |
| 2026-11-10 | Batch 2: PR #21 report rows for journal entries and document review, contrast, real 404 for foreign job ids; PR #22 `harbor-lane-bank-rec` (docs/07 Example 4); PR #23 proctoring with migration `20261110160000_proctoring`. All test-first |
| 2026-11-10 | Batch 1: PR #17 fixes 5 app bugs (Safari hydration, candidate button pending state, revoke confirmation, read state on reload, cross-company 404); PR #18 `journal_entry` + `document_review` and `demo-entries-review`; PR #19 results table, candidate report, rubric review migration. All work test-driven from here on (`11-testing.md`) |
| 2026-11-10 | Tests: PR #13 pgTAP schema, constraints, RLS policies, secret tables, triggers and functions; PR #14 component tests (191) and `Field` error fix; PR #15 Playwright journeys for employer, candidate and recruiter-to-candidate (3 browsers), button and page-change checks, axe on every page, Linux screenshot baselines. 6 app bugs logged as `test.fixme` in `e2e/known-issues.spec.ts` |
| 2026-11-09 | PR #12 testing foundation: tests moved off the cloud database to a local throwaway Supabase; pgTAP, component, Playwright (3 browsers) and Lighthouse set up; CI jobs `checks`, `database`, `e2e` (`11-testing.md`) |
| 2026-11-09 | Stage A: PR #8 `inbox_reply` + `spreadsheet` step types and `demo-mini-close`; PR #9 jobs, assessments and invites; PR #10 candidate flow. All checks pass on main after each merge |
| 2026-11-09 | Stage A shared setup: email helper, token helpers, `publishScenario` + `pnpm scenarios:publish` (demo scenario published to the platform library), `test:jobs` / `test:candidate` scripts |
| 2026-11-08 | PR #2: schema + RLS, company auth, engine core, decision brief. PR #3: company pages under `/app/<slug>` |
