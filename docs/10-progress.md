# 10 · Progress

Where the phase 1 build stands. Update this file whenever a build step lands.

_Last updated: 2026-11-10._

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

**Database.** 16 tables in `public`: `organizations`, `memberships`, `jobs`, `assessments`, `scenarios`, `invites`, `invite_secrets`, `attempts`, `attempt_secrets`, `step_responses`, `action_events`, `integrity_events`, `media`, `flags`, `notes`, `audit_log`. RLS on every table; answer keys and tokens live in the `*_secrets` tables, which only the server reads. Five migrations, all applied in the cloud:

| Migration | Adds |
| --- | --- |
| `20261109023434_initial_schema` | Tables, RLS policies, `private` helper functions, triggers |
| `20261109024040_harden_helpers` | Locked-down helper functions (`search_path`, grants) |
| `20261109034338_org_slug` | Company URLs (`organizations.slug`), `create_organization` |
| `20261110120000_review_rubric_step` | `review_rubric_step`: a recruiter scores a rubric step, score and audit log updated |
| `20261110160000_proctoring` | Private `proctoring` bucket (2 MB images), `private.can_view_media`, `flags.rule` and `flags.review_note`, reviewers may change only review columns |

**Company side** (`/app/<slug>`): dashboard, jobs and job detail with invites (paste or CSV, resend, revoke), assessments, candidates results table, candidate report (answers vs expected, rubric review, flags with snapshots, notes and vote, timeline), team. Plus sign up, log in, onboarding, `/auth/*` callbacks and set password.

**Candidate side** (`/a/<token>`): landing → `verify` (6-digit email code) → `check` (consent, camera, entire-screen share) → `instructions` → `workspace` → `review` → `done`. Server routes under `/api/candidate/*`: `code`, `verify`, `start`, `state`, `answer`, `event`, `submit`, and `proctoring/{consent,signals,upload,media}`.

**Engine.** Five step types: `numeric`, `inbox_reply` (rubric; human review, AI scorer not wired), `spreadsheet`, `journal_entry`, `document_review`. Four scenarios in code: `demo-petty-cash`, `demo-mini-close`, `demo-entries-review`, `harbor-lane-bank-rec`. Only `demo-petty-cash` v1 is published to the cloud; publishing is `pnpm scenarios:publish`. `/dev/engine` previews any scenario.

**Proctoring.** Rules (`src/lib/proctoring/rules.ts`): `left_window`, `paste`, `fullscreen`, `screen_share`, `camera`, `multiple_displays`. Camera and screen snapshots every 45 s and on leaving the window, uploaded with signed URLs. Each attempt gets an integrity label (`clear`, `review`, `suspicious`); nothing auto-rejects.

**Tests.** 48 Vitest files (498 tests, 27 of them component files), 14 pgTAP files (820 assertions), 19 Playwright specs (63 tests, 3 browsers, axe on every page), no open `test.fixme`. CI on every PR: `checks` (lint, types, unit, component), `database` (pgTAP), `e2e`. Work is test-first (`11-testing.md`).

**Known gaps before a pilot.** Admin MFA; retention and delete on request; the candidate report returns 200 for another company's invite id; Resend not set up (since PR #24 production email errors clearly instead of failing silently); Supabase still on Free (pauses after 7 idle days); AI rubric scorer; `harbor-lane-bank-rec` waits on an accountant. The first three are batch 3 below.

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

**Stage E, batch 3:** `pilot-hardening` merged as PR #24 (production email guard: invites and codes error clearly on Vercel until Resend is set; `/api/health`; error pages; code resend cooldown; `docs/12-pilot-runbook.md`). `pilot-retention` is PR #25, open (per-org retention, default 180 days; admin delete on request; daily purge at 03:30 UTC; migration `20261110200000_retention`, not yet in the cloud). `pilot-admin-mfa` in progress (TOTP required for admins; candidate report 404). Open team decisions: `decisions/2026-11-10-pilot-decisions.md`. Vercel is done; Resend, Supabase Pro, consent wording and the accountant review are on people.

## Waiting on people, not code

- [ ] Resend: account, verified sending subdomain, SMTP in Supabase (setup guide sent as a PDF). Blocks stage A.
- [ ] Supabase → Authentication → URL Configuration: Site URL and redirect URLs.
- [x] Vercel project from the GitHub repo, with the env vars in `01-architecture-and-hosting.md` (production deploys from main).
- [ ] Open decisions Q2, Q3, Q4, Q5, Q7, Q9 in `decisions/2026-11-08-skeleton-open-questions.md` (none urgent).
- [ ] Stage A provisional decisions in `decisions/2026-11-09-stage-a-open-decisions.md`, including two schema decisions (S1, S2).
- [x] Apply migration `20261110160000_proctoring.sql` to the cloud project (applied 2026-11-10, with the rubric review migration).
- [ ] Publish `harbor-lane-bank-rec` (`pnpm scenarios:publish`) after an accountant reviews it.
- [ ] Open decisions from PR #19: viewers can add notes and votes; the report rebuilds expected answers from the attempt seed; a review overwrites the provisional score (audit log keeps the record).
- [ ] Remaining app issue: the candidate report for another company's invite id may return 200 with the 404 page (same pattern fixed for jobs in PR #21). Colour contrast and the other E2E bugs are fixed (PRs #17, #21, #23).
- [ ] Proctoring open decisions (privacy, retention, consent wording) in PR #23.

## Log

| Date | Landed |
| --- | --- |
| 2026-11-10 | Batch 2: PR #21 report rows for journal entries and document review, contrast, real 404 for foreign job ids; PR #22 `harbor-lane-bank-rec` (docs/07 Example 4); PR #23 proctoring with migration `20261110160000_proctoring`. All test-first |
| 2026-11-10 | Batch 1: PR #17 fixes 5 app bugs (Safari hydration, candidate button pending state, revoke confirmation, read state on reload, cross-company 404); PR #18 `journal_entry` + `document_review` and `demo-entries-review`; PR #19 results table, candidate report, rubric review migration. All work test-driven from here on (`11-testing.md`) |
| 2026-11-10 | Tests: PR #13 pgTAP schema, constraints, RLS policies, secret tables, triggers and functions; PR #14 component tests (191) and `Field` error fix; PR #15 Playwright journeys for employer, candidate and recruiter-to-candidate (3 browsers), button and page-change checks, axe on every page, Linux screenshot baselines. 6 app bugs logged as `test.fixme` in `e2e/known-issues.spec.ts` |
| 2026-11-09 | PR #12 testing foundation: tests moved off the cloud database to a local throwaway Supabase; pgTAP, component, Playwright (3 browsers) and Lighthouse set up; CI jobs `checks`, `database`, `e2e` (`11-testing.md`) |
| 2026-11-09 | Stage A: PR #8 `inbox_reply` + `spreadsheet` step types and `demo-mini-close`; PR #9 jobs, assessments and invites; PR #10 candidate flow. All checks pass on main after each merge |
| 2026-11-09 | Stage A shared setup: email helper, token helpers, `publishScenario` + `pnpm scenarios:publish` (demo scenario published to the platform library), `test:jobs` / `test:candidate` scripts |
| 2026-11-08 | PR #2: schema + RLS, company auth, engine core, decision brief. PR #3: company pages under `/app/<slug>` |
