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
| 7 | Proctoring: browser signals, camera snapshots, screen share, flags | ⬜ | |
| 8 | `journal_entry` + `document_review`; Example 1 (or Example 4) end to end | 🟡 Half | `journal_entry` (per-line partial credit, balance check) and `document_review` (findings, false-flag penalty) built with `demo-entries-review` (PR #18). Still to build: the Example 4 simulation end to end |

6 of 8 steps, plus half of step 8. Stages A and B are built: a company can send a link, a candidate can take a test, and a recruiter can review and judge the result.

## The MVP, piece by piece

1. **Foundation** (done): database, tenant isolation, server-only answer keys.
2. **Company side** (done): companies, teams, URLs, assessments, jobs, invites, results table and candidate report with rubric review and notes.
3. **Candidate side** (done, except proctoring): invite link → 6-digit email code → consent → system check → instructions → timed workspace (inbox left, task right) → review → submit. Server-owned timer, autosave, resume after refresh.
4. **Engine** (done for MVP step types): turns a scenario into tasks with each candidate's own numbers, then scores them. `numeric`, `inbox_reply` (rubric; AI scorer not wired yet), `spreadsheet`, `journal_entry` and `document_review` are built.
5. **Integrity** (not started): browser signals, webcam snapshots, full-screen share, flags with evidence that a recruiter confirms or clears. Nothing auto-rejects.
6. **Content** (not started): the first full accounting simulation from `07-accounting-simulations.md`, reviewed by a working accountant.

## Stages to the MVP

| Stage | Build | Unlocks |
| --- | --- | --- |
| A. A candidate can take a test | Steps 3 + 4, using the demo scenario | First end-to-end run: send link → take test → see score |
| B. A company can judge results | Step 6 | A recruiter can actually use it |
| C. Real accounting content | Steps 5 + 8 | The test screens accountants |
| D. Trustworthy results | Step 7 | Companies can believe the scores |
| E. Pilot-ready | Deploy on Vercel, Resend Pro, Supabase Pro, consent text, accountant review, admin MFA | First pilot company (the phase 1 gate) |

## Waiting on people, not code

- [ ] Resend: account, verified sending subdomain, SMTP in Supabase (setup guide sent as a PDF). Blocks stage A.
- [ ] Supabase → Authentication → URL Configuration: Site URL and redirect URLs.
- [ ] Vercel project from the GitHub repo, with the env vars in `01-architecture-and-hosting.md`.
- [ ] Open decisions Q2, Q3, Q4, Q5, Q7, Q9 in `decisions/2026-11-08-skeleton-open-questions.md` (none urgent).
- [ ] Stage A provisional decisions in `decisions/2026-11-09-stage-a-open-decisions.md`, including two schema decisions (S1, S2).
- [ ] Apply migration `20261110120000_review_rubric_step.sql` to the cloud project (until then, rubric review fails in production).
- [ ] Open decisions from PR #19: viewers can add notes and votes; the report rebuilds expected answers from the attempt seed; a review overwrites the provisional score (audit log keeps the record).
- [ ] Remaining app issues: low colour contrast on grey labels (serious); another company's job id under your own company URL returns 200 with the 404 page. The other 4 bugs from the E2E suite are fixed (PR #17).

## Log

| Date | Landed |
| --- | --- |
| 2026-11-10 | Batch 1: PR #17 fixes 5 app bugs (Safari hydration, candidate button pending state, revoke confirmation, read state on reload, cross-company 404); PR #18 `journal_entry` + `document_review` and `demo-entries-review`; PR #19 results table, candidate report, rubric review migration. All work test-driven from here on (`11-testing.md`) |
| 2026-11-10 | Tests: PR #13 pgTAP schema, constraints, RLS policies, secret tables, triggers and functions; PR #14 component tests (191) and `Field` error fix; PR #15 Playwright journeys for employer, candidate and recruiter-to-candidate (3 browsers), button and page-change checks, axe on every page, Linux screenshot baselines. 6 app bugs logged as `test.fixme` in `e2e/known-issues.spec.ts` |
| 2026-11-09 | PR #12 testing foundation: tests moved off the cloud database to a local throwaway Supabase; pgTAP, component, Playwright (3 browsers) and Lighthouse set up; CI jobs `checks`, `database`, `e2e` (`11-testing.md`) |
| 2026-11-09 | Stage A: PR #8 `inbox_reply` + `spreadsheet` step types and `demo-mini-close`; PR #9 jobs, assessments and invites; PR #10 candidate flow. All checks pass on main after each merge |
| 2026-11-09 | Stage A shared setup: email helper, token helpers, `publishScenario` + `pnpm scenarios:publish` (demo scenario published to the platform library), `test:jobs` / `test:candidate` scripts |
| 2026-11-08 | PR #2: schema + RLS, company auth, engine core, decision brief. PR #3: company pages under `/app/<slug>` |
