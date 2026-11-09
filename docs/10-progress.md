# 10 · Progress

Where the phase 1 build stands. Update this file whenever a build step lands.

_Last updated: 2026-11-09._

## Skeleton build order (from `08-roadmap-and-open-questions.md`)

| # | Step | Status | What exists |
| --- | --- | --- | --- |
| 1 | Repo, app, Supabase, schema + RLS | ✅ Done | Next.js 16 app; Supabase cloud project; 3 migrations; 28 cross-org isolation tests |
| 2 | Company auth, orgs, memberships | ✅ Done | Sign up / log in, onboarding, company URLs (`/app/<slug>`), org switcher, team page (invite, change role, remove, last-admin guard) |
| 3 | Jobs, invites, invite emails | ⬜ Not started | Shared helpers ready: `sendEmail` (`src/lib/email`, writes to `.dev-outbox/` without `RESEND_API_KEY`), invite tokens and codes (`src/lib/tokens.ts`) |
| 4 | Candidate flow: verify, system check, instructions, workspace, timer, autosave, submit | ⬜ Not started | Engine functions it needs are ready |
| 5 | Engine: step type interface + `inbox_reply` + `spreadsheet` | 🟡 Core done | Step-type plug-in interface, seeded variants, server-only scoring, `numeric` step type, demo scenario, `/dev/engine` preview, 44 unit tests. `inbox_reply` and `spreadsheet` not built |
| 6 | Results table + candidate report | ⬜ | |
| 7 | Proctoring: browser signals, camera snapshots, screen share, flags | ⬜ | |
| 8 | `journal_entry` + `document_review`; Example 1 (or Example 4) end to end | ⬜ | |

Roughly 2.5 of 8 steps. The finished parts are the ones every later step depends on.

## The MVP, piece by piece

1. **Foundation** (done): database, tenant isolation, server-only answer keys.
2. **Company side** (half done): companies, teams, and URLs work. Still to build: jobs, invites, the candidates table, and the candidate report.
3. **Candidate side** (not started): invite link → 6-digit email code → consent → system check → instructions → timed workspace (inbox left, task right) → review → submit. Server-owned timer, autosave, resume after refresh.
4. **Engine** (core done): turns a scenario into tasks with each candidate's own numbers, then scores them. Still to build: `inbox_reply` (rubric, AI-assisted), `spreadsheet`, `journal_entry`, `document_review`.
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

## Log

| Date | Landed |
| --- | --- |
| 2026-11-09 | Stage A shared setup: email helper, token helpers, `publishScenario` + `pnpm scenarios:publish` (demo scenario published to the platform library), `test:jobs` / `test:candidate` scripts |
| 2026-11-08 | PR #2: schema + RLS, company auth, engine core, decision brief. PR #3: company pages under `/app/<slug>` |
