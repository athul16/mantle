# Context for AI coding assistants

Read `docs/00-overview.md` first, then the doc for the area you are working on. The docs are the source of truth for product decisions.

Non-negotiable rules for any code in this repo:

- Every tenant-owned table has an `org_id` column and Row Level Security. Never write a query that can read across organizations.
- Answer keys, scoring logic, and variant generators run on the server only. Never send them to the browser.
- The timer is enforced on the server (`attempts.started_at` + limit). The client timer is display only.
- Proctoring media uploads go from the browser straight to storage via signed upload URLs, never through API routes.
- Integrity signals produce **suspicious labels with evidence**. Nothing in the code auto-rejects a candidate.
- New question or task kinds are added as **step types** (see `docs/06-assessment-engine.md`), not as special cases in the attempt flow.

Working rules:

- The cloud Supabase project is the only real database. Tests run against a local throwaway Supabase (`pnpm db:test:start`, Docker) and never against the cloud; the test setup refuses a non-local URL. See `docs/11-testing.md`.
- Schema changes only through new files in `supabase/migrations/`. After applying to the cloud project, regenerate `src/lib/database.types.ts`; check them locally with `pnpm db:test:reset && pnpm test:db && pnpm test:rls`.
- Candidate secrets (invite token hashes, email codes, seeds, session hashes) live in `invite_secrets` / `attempt_secrets`, which only the service role can read. Don't add them as columns on tables company users can read.
- The service client (`src/lib/supabase/service.ts`) is for Supabase Auth admin calls and candidate routes only. Company-side writes go through the user's own client so RLS checks them.
- Company pages live under `/app/[orgSlug]`; get the company with `requireOrgMembership(slug)` from `src/lib/auth.ts`.
- This is Next.js 16: read `node_modules/next/dist/docs/` before writing app code (middleware is `src/proxy.ts`, `cookies()`/`params` are async, Cache Components is on).
- Update `docs/10-progress.md` when a build step lands.
