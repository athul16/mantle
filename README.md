# Assessment Platform

Job simulations that screen applicants for roles usually hired on behavioral interviews. We start with **accounting interns** and **pharmaceutical interns**.

Companies send candidates a link. Candidates spend 30 to 45 minutes doing a realistic slice of the job. Companies get a ranked list with scores, evidence, and integrity labels.

**Status:** phase 1 skeleton in progress. See [`docs/10-progress.md`](docs/10-progress.md).

## Stack

Next.js 16 (TypeScript, App Router) on Vercel, Supabase (Postgres, Auth, Storage), Resend for email, pnpm.

## Getting started

```bash
pnpm install
cp .env.example .env.local   # fill in values (secret key from Athul, privately)
pnpm dev                     # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `pnpm dev` | Dev server |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint |
| `pnpm test:engine` | Engine unit tests (no network) |
| `pnpm test:rls` | Cross-company isolation tests against the cloud database |

Schema changes go only through `supabase/migrations/` (one shared cloud database). Environment variables are listed in `docs/01-architecture-and-hosting.md`.

## Layout

```
src/app/                 pages: (auth)/ login+signup, auth/ email links, onboarding/, app/[orgSlug]/ company area, dev/ dev-only
src/lib/auth.ts          current user, memberships, company from URL
src/lib/supabase/        browser, server, server-only service, and proxy clients
src/lib/engine/          assessment engine (types, server/, client/, step-types/, scenarios/)
src/lib/database.types.ts  generated from the schema; regenerate after each migration
src/proxy.ts             session refresh + signed-out redirect (Next 16 "proxy" = old middleware)
supabase/migrations/     every schema change, named by the version Supabase recorded
tests/                   rls.test.ts (cloud DB), engine/ (unit)
docs/                    product + technical specs; decisions/ holds decision briefs
```

## Docs

All product and technical specs live in [`docs/`](docs/). Start with [`docs/00-overview.md`](docs/00-overview.md).
