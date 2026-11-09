# 01 · Architecture and hosting

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend + API | Next.js (TypeScript) on Vercel | One codebase for candidate app, company dashboard, and API routes; deploys on push |
| Database | Supabase Postgres | Relational data (orgs, jobs, invites, attempts, responses); SQL reporting |
| Auth | Supabase Auth for company users; signed invite token + email code for candidates | Candidates never create accounts |
| Multi-tenancy | `org_id` on every tenant row + Row Level Security | Isolation without separate databases; the main thing that makes scaling cheap |
| Files | Supabase Storage, private buckets, signed URLs | Scenario documents, proctoring snapshots, exports |
| Email | Resend (decided, Q1) | Invites, codes, reminders, completion notices; also Supabase Auth's SMTP |
| Background jobs | Supabase Edge Functions + cron | Expire invites, auto-submit timed-out attempts, scoring |
| Payments (later) | Stripe | Per completed candidate or per seat |
| Video (later) | Cloudflare R2 or S3 | Continuous recording is too large for Supabase Storage |
| Live phone camera (later) | Managed WebRTC (LiveKit, Daily) | Don't run our own media servers |

## As built (Nov 2026)

| Piece | Detail |
| --- | --- |
| Next.js | 16.4 with the App Router, TypeScript, Tailwind 4, pnpm 12. Middleware is called **proxy** in Next 16 (`src/proxy.ts`). **Cache Components** is on (decision Q10): pages that read cookies or params do so inside `<Suspense>` |
| Supabase | Cloud project `assessment-platform` (ref `fexzsiizgcjuddtoeaui`), region us-east-1, Free plan, in its own Supabase organization (moved there 2026-11-08 so invites cover only this project). No local Docker database; migrations in `supabase/migrations/` are the source of truth |
| Auth (company) | Email + password via `@supabase/ssr` cookies. Session refreshed in `src/proxy.ts`; real checks in `src/lib/auth.ts` on every page and action |
| Vercel | Not set up yet |
| Email | Resend chosen; not connected yet (SMTP in Supabase Auth, then `RESEND_API_KEY` for app emails) |

### Environment variables

| Variable | Visibility | Set in |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | `.env.local`, Vercel |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public | `.env.local`, Vercel |
| `SUPABASE_SECRET_KEY` | **Server only**; bypasses RLS | `.env.local`, Vercel (never `NEXT_PUBLIC_`, never committed) |
| `NEXT_PUBLIC_APP_URL` | Public; base URL for links in emails | `.env.local` (`http://localhost:3000`), Vercel (real URL) |
| `RESEND_API_KEY` (planned) | Server only | Added with candidate emails (step 3) |

`.env.example` lists them; `.env.local` is gitignored.

### Routes

| Path | Who | Notes |
| --- | --- | --- |
| `/` | Anyone | Landing page |
| `/login`, `/signup` | Signed out | |
| `/auth/confirm`, `/auth/callback`, `/auth/set-password` | Email links | Where Supabase email links land |
| `/onboarding` | Signed in | Create a company |
| `/app` | Signed in | Redirects to the last-used company |
| `/app/[orgSlug]` + `/jobs`, `/candidates`, `/team` | Members of that company | Non-members get 404 |
| `/dev/engine` | Dev only | Engine preview; 404 in production |
| `/a/[token]` (planned) | Candidates | Not intercepted by the proxy |

## Hosting options considered

| Option | Verdict |
| --- | --- |
| **A. Vercel + Supabase** | **Chosen.** Lowest setup work, $0 while building, about $45/month with paying pilots (Vercel Pro $20/seat + Supabase Pro $25/org). Scaling is mostly tier upgrades. |
| B. Firebase | NoSQL makes cross-candidate reporting painful; read-heavy bills can spike |
| C. Render/Railway + Postgres + Clerk | Works, but more pieces to wire and secure |
| D. AWS directly | Most control, weeks of setup; only if a large client requires it |

### Gotchas

- Vercel Hobby is non-commercial only. Move to Pro before charging a company.
- Supabase Free pauses projects after 7 days of inactivity. Move to Pro before the first real pilot, since candidates open links at random times.
- Vercel functions have small request body limits. Media must upload directly from the browser to storage.

### Scaling path

1. Pilot: Vercel Pro + Supabase Pro.
2. Growth: larger Supabase compute; add Redis (e.g., Upstash) for autosave and timer traffic when a company invites a whole applicant pool with one deadline.
3. Enterprise: Supabase Team for SOC 2 reports; EU project for clients needing EU data residency.
4. If needed: move Postgres to AWS RDS. It's standard Postgres, so queries don't change.

## How competitors host (Nov 2026 research)

| Company | Setup |
| --- | --- |
| HackerRank | AWS across US, Germany, and India regions; Docker/Kubernetes, service-oriented; Redis Cloud for caching and live execution status at 20,000+ simultaneous tests |
| TestGorilla | AWS in Ireland (EU) |
| Codility | US and EU hosting options |

Most of HackerRank's infrastructure complexity comes from running untrusted candidate code in sandboxes. Our simulations don't execute code, so answers are just database writes. Lessons we keep: plan for per-client data region, and add a cache when concurrent load arrives.

## Request flow (candidate)

1. Candidate opens `/a/{inviteToken}`. The page must not use up the token on load: corporate email scanners (Microsoft 365 Safe Links) open links before the person does. The candidate clicks a button first (see decision Q3).
2. Server checks the token, sends an email code, creates an `attempt` on verification.
3. Each step is fetched from the API with its candidate-specific variant data. No answer keys leave the server.
4. Answers autosave to `step_responses` on change.
5. Proctoring snapshots upload via signed URLs; events post to `integrity_events`.
6. Submit (or server-side timeout) triggers scoring and label generation.
