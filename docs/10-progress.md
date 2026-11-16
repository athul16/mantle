# 10 · Progress

Where the phase 1 build stands. Update this file whenever a build step lands.

_Last updated: 2026-11-15 (proctoring v2)._

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

What runs today, from the code on main and the cloud project (2026-11-10).

**Hosting.** Vercel builds and deploys production from `main` (previews per PR). One Supabase cloud project (`fexzsiizgcjuddtoeaui`, Free plan) holds the database, auth and storage. Email goes through Resend when `RESEND_API_KEY` is set; otherwise messages are written to `.dev-outbox/`. Resend is not set in production yet.

**Database.** 16 tables in `public`: `organizations`, `memberships`, `jobs`, `assessments`, `scenarios`, `invites`, `invite_secrets`, `attempts`, `attempt_secrets`, `step_responses`, `action_events`, `integrity_events`, `media`, `flags`, `notes`, `audit_log`. RLS on every table; answer keys and tokens live in the `*_secrets` tables, which only the server reads. Fourteen migrations in `supabase/migrations/` (the table below lists the first five; the newest is `20261115120000_proctoring_v2`, which adds media `audio` and `reason`, an audio-accepting bucket and the full screen and microphone waiver columns, and has not been applied to the cloud yet):

| Migration | Adds |
| --- | --- |
| `20261109023434_initial_schema` | Tables, RLS policies, `private` helper functions, triggers |
| `20261109024040_harden_helpers` | Locked-down helper functions (`search_path`, grants) |
| `20261109034338_org_slug` | Company URLs (`organizations.slug`), `create_organization` |
| `20261110120000_review_rubric_step` | `review_rubric_step`: a recruiter scores a rubric step, score and audit log updated |
| `20261110160000_proctoring` | Private `proctoring` bucket (2 MB images), `private.can_view_media`, `flags.rule` and `flags.review_note`, reviewers may change only review columns |

**Look and feel.** Every screen follows the Mantle prototype (`docs/design/prototype.html`, see `13-design-system.md`). Prototype features the backend doesn't support yet are listed below under "Prototype features not built yet".

**Company side** (`/app/<slug>`, opens on Jobs): jobs (create job dialog), job page with the candidates list, invite page (`/jobs/<id>/invite`: paste or CSV), resend and revoke, assessments library and configure screen, candidates results table, candidate report (answers vs expected, rubric review, flags with snapshots, notes and vote, timeline), team. Plus sign up, log in, onboarding, `/auth/*` callbacks and set password.

**Candidate side** (`/a/<token>`): landing → `verify` (6-digit email code) → `check` (consent, camera, entire-screen share) → `instructions` → `workspace` → `review` → `done`. Server routes under `/api/candidate/*`: `code`, `verify`, `start`, `state`, `answer`, `event`, `submit`, and `proctoring/{consent,signals,upload,media}`.

**Engine.** Seven step types: `numeric`, `inbox_reply` (rubric; human review, AI scorer not wired), `spreadsheet`, `journal_entry`, `document_review` (with an optional "nothing wrong here" confirm), `rapid_round`, `multiple_choice`. Timed sections and one-at-a-time screens (`06-assessment-engine.md`, "Timed sections and rapid rounds"). Seven scenarios in code: `demo-petty-cash`, `demo-mini-close`, `demo-entries-review`, `demo-timed-close`, `harbor-lane-bank-rec`, `audit-calder-bluestem`, `corporate-ap-ridgeway`. Only `demo-petty-cash` v1 is published to the cloud; publishing is `pnpm scenarios:publish`. `/dev/engine` previews any scenario.

**Proctoring (v2, 2026-11-15).** Settings per assessment: camera, screen, require full screen, microphone, gaze check; per-invite waivers for each of them except gaze (which follows the camera). Rules (`src/lib/proctoring/rules.ts`): `left_window`, `paste`, `copy`, `copy_then_leave`, `fullscreen`, `screen_share`, `camera`, `multiple_displays`, `downtime`, `gaze`, `no_face`, `multiple_faces`, `speech`. Camera and screen snapshots every 45 s and on leaving the window; while away, screenshots at +2 s, +6 s, every 10 s and on return; audio clips only around speech; gaze runs on the device and sends events only. The label is severity based: suspicious for combinations (left window with camera or screen trouble, copy then leave, multiple faces, speech with looking away or leaving, or 3+ kinds of flag), review for any other flag, clear for none, with the reasons shown on the report. Nothing auto-rejects. Details: `02-security-and-integrity.md`, `decisions/2026-11-15-proctoring-v2.md`.

**Tests.** 48 Vitest files (498 tests, 27 of them component files), 14 pgTAP files (820 assertions), 19 Playwright specs (63 tests, 3 browsers, axe on every page), no open `test.fixme`. CI on every PR: `checks` (lint, types, unit, component), `database` (pgTAP), `e2e`. Work is test-first (`11-testing.md`).

**Known gaps before a pilot.** Proctoring v2 has not been tried in real browsers yet: full screen, speech detection and the gaze angles are only checked with Chromium's fake camera and microphone and unit tests, so the thresholds are first guesses; the report doesn't show how long an audio clip is; the gaze check downloads about 19 MB of MediaPipe files (cached after the first load); legal review (D3) before candidates outside North Carolina. Resend not set up (production invites and codes error until it is); `CRON_SECRET` not yet set in Vercel; Supabase still on Free (pauses after 7 idle days); AI rubric scorer; `harbor-lane-bank-rec` waits on an accountant; the team decisions in `decisions/2026-11-10-pilot-decisions.md`.

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

- [ ] Resend: account, verified sending subdomain, SMTP in Supabase (setup guide sent as a PDF). Blocks stage A.
- [ ] Supabase → Authentication → URL Configuration: Site URL and redirect URLs.
- [x] Vercel project from the GitHub repo, with the env vars in `01-architecture-and-hosting.md` (production deploys from main).
- [ ] Open decisions Q2, Q3, Q4, Q5, Q7, Q9 in `decisions/2026-11-08-skeleton-open-questions.md` (none urgent).
- [ ] Stage A provisional decisions in `decisions/2026-11-09-stage-a-open-decisions.md`, including two schema decisions (S1, S2).
- [x] Apply migration `20261110160000_proctoring.sql` to the cloud project (applied 2026-11-10, with the rubric review migration).
- [x] Apply migration `20261110200000_retention.sql` (PR #25) to the cloud project (applied 2026-11-10).
- [ ] Vercel env vars: `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET`; then `/api/health` should return all true (`12-pilot-runbook.md`).
- [ ] Decide D1 to D16 in `decisions/2026-11-10-pilot-decisions.md` (D3, D2, D1, D13, D12 first).
- [ ] Publish `harbor-lane-bank-rec` (`pnpm scenarios:publish`) after an accountant reviews it.
- [ ] Open decisions from PR #19: viewers can add notes and votes; the report rebuilds expected answers from the attempt seed; a review overwrites the provisional score (audit log keeps the record).
- [ ] Remaining app issue: the candidate report for another company's invite id may return 200 with the 404 page (same pattern fixed for jobs in PR #21). Colour contrast and the other E2E bugs are fixed (PRs #17, #21, #23).
- [ ] Proctoring open decisions (privacy, retention, consent wording) in PR #23.

## Log

| Date | Landed |
| --- | --- |
| 2026-11-16 | Engine follow-ups (branch `feat/engine-followups`, no migration): `multiple_choice` step type (single exact, multi per-option with wrong picks costing, floored at 0); `document_review` optional "nothing wrong here" confirm (key says whether the document is clean; old configs and answers score as before); company report shows each rapid item's prompt, values, expected values and response time, plus a Timing card with answers within 2 s of returning to the window and a large rapid round vs other tasks gap (evidence only, label unchanged). Test-first; scenarios not switched yet |
| 2026-11-16 | `corporate-ap-ridgeway` v1, phase B (branch `feat/sim-corporate-ap-b`, docs/07 Example 6, draft: needs accountant review): three `rapid_round` steps, 15 items × 20 s, 10 points each (JE flash, pay or hold, cash application; seeded amounts and names, order shuffled per seed, harder kinds worth 1 point and the rest ½), and the whole scenario in six timed sections (52 minutes, 100 points; match and inbox one screen at a time; linked messages timed from their section's start). Test-first in `tests/engine/corporate-ap-ridgeway.test.ts` |
| 2026-11-16 | `audit-calder-bluestem` v1, phase B (branch `feat/sim-audit-b`, docs/07 Example 5, draft: needs accountant review): three seeded rapid rounds of 15 × 20 s, 10 points each (tick and tie, FOB cutoff calls, sample selection and a missing check number), and six timed sections over 52 minutes (vouching and inbox one screen at a time, messages timed from their section's start). Now 100 points; still unpublished. Test-first in `tests/engine/audit-calder-bluestem.test.ts` |
| 2026-11-16 | Timed sections, one-at-a-time screens and the `rapid_round` step type (branch `feat/timed-sections`): sections with their own minutes, "Finish section" / "Next screen" (`/api/candidate/advance`), steps outside the current section locked, rapid items one at a time with a server-timed countdown and response times, extra time stretching sections, screens and items; state comes from server-written action events (`advanced_section`, `advanced_screen`, `answered_item`), no migration. Demo `demo-timed-close`. The overall timer never pauses (D4). Tests in `tests/engine/{sequence,sections,rapid-round}.test.ts`, `tests/components/engine/rapid-round.test.tsx`, `tests/candidate/sections.test.ts`, `e2e/candidate/timed-sections.spec.ts` |
| 2026-11-15 | `audit-calder-bluestem` v1, phase A (branch `feat/sim-audit`): audit intern at Calder & Finch on Bluestem Manufacturing's year-end, 70 points on existing step types (vouching with four planted traps, controller push-back, bank confirmation, summary of misstatements, adjusting entries). Rapid rounds (30 points) wait for sections and `rapid_round`. Draft, needs accountant review (docs/07 Example 5). Test-first |
| 2026-11-15 | `corporate-ap-ridgeway` v1, phase A (branch `feat/sim-corporate-ap`, docs/07 Example 6, draft: needs accountant review): corporate AP intern at Ridgeway Outdoor Supply, 50 min, 70 points from existing step types: four three-way matches (short shipment, price above PO, already-paid invoice, clean match, shuffled per candidate) and posting the approved invoice; vendor chasing the held invoice, run total, lookalike-domain bank-change email; vendor statement rec and note to Priya. Rapid rounds (30 points) wait for the sections engine (phase B). Test-first in `tests/engine/corporate-ap-ridgeway.test.ts` |
| 2026-11-15 | Proctoring v2 (branch `feat/proctoring-v2`): pasting `123 456` fills the verify code; Require full screen, Microphone and Gaze check settings; full screen and microphone waivers per invite (migration `20261115120000_proctoring_v2`, consent version `2026-11-15.proctoring-v2`); away screenshots, full-screen cover, mic monitor with speech clips, on-device gaze check, cut and copy recorded; rules for copy, copy then leave, gaze, no face, multiple faces, speech and full-screen downtime; severity-based label with reasons; report with Copies and new counters, filmstrip per absence and audio players. Reverses D6 (full screen is now an option) and D7 (on-device gaze is built); see `decisions/2026-11-15-proctoring-v2.md`. E2E in `e2e/proctoring/proctoring-v2.spec.ts` |
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
