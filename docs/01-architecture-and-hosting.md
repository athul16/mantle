# 01 · Architecture and hosting

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend + API | Next.js (TypeScript) on Vercel | One codebase for candidate app, company dashboard, and API routes; deploys on push |
| Database | Supabase Postgres | Relational data (orgs, jobs, invites, attempts, responses); SQL reporting |
| Auth | Supabase Auth for company users; signed invite token + email code for candidates | Candidates never create accounts |
| Multi-tenancy | `org_id` on every tenant row + Row Level Security | Isolation without separate databases; the main thing that makes scaling cheap |
| Files | Supabase Storage, private buckets, signed URLs | Scenario documents, proctoring snapshots, exports |
| Email | Resend or Postmark | Invites, reminders, completion notices |
| Background jobs | Supabase Edge Functions + cron | Expire invites, auto-submit timed-out attempts, scoring |
| Payments (later) | Stripe | Per completed candidate or per seat |
| Video (later) | Cloudflare R2 or S3 | Continuous recording is too large for Supabase Storage |
| Live phone camera (later) | Managed WebRTC (LiveKit, Daily) | Don't run our own media servers |

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

1. Candidate opens `/a/{inviteToken}`.
2. Server checks the token, sends an email code, creates an `attempt` on verification.
3. Each step is fetched from the API with its candidate-specific variant data. No answer keys leave the server.
4. Answers autosave to `step_responses` on change.
5. Proctoring snapshots upload via signed URLs; events post to `integrity_events`.
6. Submit (or server-side timeout) triggers scoring and label generation.
