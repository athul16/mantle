# Mantle

Mantle (this repo: `assessment-platform`) runs job simulations that screen applicants for roles usually hired on behavioral interviews. We start with **accounting interns** and **pharmaceutical interns**.

Companies send candidates a link. Candidates spend 30 to 45 minutes doing a realistic slice of the job. Companies get a ranked list with scores, evidence, and integrity labels.

**Status:** phase 1 skeleton in progress. See [`docs/10-progress.md`](docs/10-progress.md).

## Design

The app follows the clickable prototype in [`docs/design/prototype.html`](docs/design/prototype.html). Tokens, fonts, components and the screen map are in [`docs/13-design-system.md`](docs/13-design-system.md).

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
| `pnpm db:test:start` / `db:test:stop` | Local throwaway Supabase for tests (Docker), writes `.env.test` |
| `pnpm test` | All Vitest tests (unit, integration, components) |
| `pnpm test:rls` / `test:jobs` / `test:candidate` | Integration tests against the local test database |
| `pnpm test:components` | Component tests (jsdom) |
| `pnpm test:db` | pgTAP schema and RLS tests |
| `pnpm test:e2e` | Playwright in chromium, firefox and webkit |
| `pnpm test:coverage` / `test:lhci` | Coverage report / Lighthouse CI |

Tests never touch the cloud database; see [`docs/11-testing.md`](docs/11-testing.md). Schema changes go only through `supabase/migrations/`. Environment variables are listed in `docs/01-architecture-and-hosting.md`.

## Layout

```
src/app/mantle.css       design tokens + component classes (ported from the prototype)
src/components/          shared UI: ui.tsx (form pieces), brand.tsx (Mantle mark, logo tile), icons.tsx
src/app/                 pages: (auth)/ login+signup, auth/ email links, onboarding/, app/[orgSlug]/ company area, dev/ dev-only
src/lib/auth.ts          current user, memberships, company from URL
src/lib/supabase/        browser, server, server-only service, and proxy clients
src/lib/engine/          assessment engine (types, server/, client/, step-types/, scenarios/)
src/lib/database.types.ts  generated from the schema; regenerate after each migration
src/proxy.ts             session refresh + signed-out redirect (Next 16 "proxy" = old middleware)
supabase/migrations/     every schema change, named by the version Supabase recorded
supabase/tests/          pgTAP tests (pnpm test:db)
tests/                   Vitest: rls.test.ts, jobs/, candidate/ (local test DB), engine/ (unit), components/ (jsdom), helpers/ (shared fixtures)
e2e/                     Playwright specs and fixtures
.github/workflows/       ci (checks, database, e2e), nightly (lighthouse, cloud smoke), e2e-snapshots
docs/                    product + technical specs; decisions/ holds decision briefs; design/ holds the prototype
```

## Docs

All product and technical specs live in [`docs/`](docs/). Start with [`docs/00-overview.md`](docs/00-overview.md).
