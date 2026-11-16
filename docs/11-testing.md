# Testing

How the app is tested, where each kind of test goes, and how CI runs them.

## Test first

All work is test-driven. Write the tests for the behaviour first (unit, component, pgTAP and E2E as the change needs), run them and see them fail, then write the code that makes them pass. Bug fixes start with a failing test that reproduces the bug. Commit the tests before the implementation, and list them in the PR.

## The rule: cloud is real, tests are local

The cloud Supabase project is the only real database. **Tests never run against it.** Every test that needs a database uses a throwaway local Supabase started with Docker (`pnpm db:test:start`), with the repo's migrations applied.

This is enforced in code, not by convention. `tests/helpers/env.ts` loads `.env.test` (written from `supabase status`) over whatever is in the shell or `.env.local`, and `assertLocalSupabase()` throws unless the Supabase URL host is `127.0.0.1`, `localhost` or `::1`. Vitest setup, Playwright config and the Lighthouse fixture script all call it. `ALLOW_CLOUD_TESTS=1` turns the guard off; don't use it without a reason you could explain to the owner.

The one exception is the nightly **cloud smoke** (`scripts/cloud-smoke.mts`): read-only, opt-in through repository secrets, and it writes nothing.

## Layers

| Layer | Tool | Where | Database | Command |
| --- | --- | --- | --- | --- |
| Schema, RLS policies, triggers, functions | pgTAP | `supabase/tests/*.test.sql` | local | `pnpm test:db` |
| Engine and other pure logic | Vitest (node) | `tests/engine/`, `tests/**/*.test.ts` | none | `pnpm test:engine` |
| Integration: RLS through the API, server actions, candidate routes | Vitest (node) | `tests/rls.test.ts`, `tests/jobs/`, `tests/candidate/`, new `tests/<area>/` | local | `pnpm test:integration` (or `test:rls`, `test:jobs`, `test:candidate`) |
| Client components | Vitest (jsdom) + Testing Library + jest-dom | `tests/components/**/*.test.tsx` | none | `pnpm test:components` |
| Browser: real pages, clicks, navigation, emails, accessibility, screenshots | Playwright (chromium, firefox, webkit) + axe | `e2e/*.spec.ts` | local | `pnpm test:e2e` |
| Performance, CLS, accessibility scores | Lighthouse CI | `lighthouserc.cjs` | local | `pnpm test:lhci` |
| Coverage | `@vitest/coverage-v8` | `coverage/` | local | `pnpm test:coverage` |

What goes where:

- A rule that lives in SQL (a policy, a check, a trigger, `create_organization`) → **pgTAP**. Fastest and closest to the rule.
- "User X can/can't do Y through the app" → **integration** (supabase-js as that user, or the real server action with `@/lib/supabase/server` mocked to return that user's client; see `tests/jobs/invites.test.ts`).
- A client component's behaviour (form validation messages, disabled buttons, step views) → **component**. Async Server Components can't be rendered in Vitest; test those through **E2E**.
- A whole journey across pages (sign in → create job → invite → candidate takes test), page transitions, focus, emails → **E2E**.

## Running locally

Needs Docker running (Docker Desktop).

```bash
pnpm db:test:start     # starts local Supabase, applies migrations, writes .env.test
pnpm test:db           # pgTAP
pnpm test              # every Vitest project (engine, integration, components)
pnpm test:e2e          # builds the app against the local DB, serves it on :3210, runs all browsers
pnpm test:lhci         # Lighthouse (needs a build against the local DB: run test:e2e or `pnpm build` with .env.test exported first)
pnpm db:test:stop      # stop and discard the local database
```

Useful variants:

```bash
pnpm db:test:reset                                      # wipe data, re-apply migrations, rewrite .env.test
pnpm test:e2e --project=chromium e2e/smoke.spec.ts      # one browser, one file
pnpm test:e2e --ui                                      # Playwright UI mode
E2E_PREBUILT=1 pnpm test:e2e                            # skip next build (you just built against .env.test)
pnpm exec playwright show-report                        # last HTML report
```

- `pnpm exec playwright install` once, to download the browsers.
- The demo scenarios are published into the local database automatically (Vitest and Playwright global setup).
- Local Supabase ports: API `54321`, DB `54322`. Studio is not started by `db:test:start`; run `pnpm exec supabase start` for it.
- `.env.test` holds the CLI's fixed local development keys. It is git-ignored anyway.
- Emails go to `.dev-outbox/` (the app's fallback with no `RESEND_API_KEY`); the test env sets it empty.

## Shared helpers (don't fork them; extend them)

`tests/helpers/` (usable from Vitest, Playwright and scripts; no runner imports):

| File | What |
| --- | --- |
| `env.ts` | `loadTestEnv()`, `assertLocalSupabase()`, `requireDbEnv()` |
| `supabase.ts` | `serviceClient()` (arrange/check, bypasses RLS), `anonClient()`, `signedInClient(email, password)`, `must(res)` |
| `factories.ts` | `createTestData(prefix)` → `user`, `company` (admin + recruiter + viewer, slug generated by `create_organization`), `libraryScenario`, `assessment`, `job`, `invite` (returns the raw token and `/a/<token>` link), `attempt`, `hiringSetup`, `cleanup`, `trackOrg`, `trackUser` |
| `outbox.ts` | `emailsTo`, `latestEmail`, `waitForEmail`, `inviteTokenFrom`, `codeFrom`, `clearEmails` |
| `scenarios.ts` | `publishDemoScenarios()` |

`e2e/fixtures/` (import `test` and `expect` from `./fixtures`):

| Fixture | What |
| --- | --- |
| `data` | a `createTestData` instance, cleaned up after the test |
| `company` | fresh company with admin/recruiter/viewer |
| `signInAs(role, next?)` | signs that user in through the login form |
| `hiring` | company + assessment + job + invite |
| `outbox` | the outbox helpers |
| `axe(options?)` | fails on WCAG 2.1 A/AA violations; results attached to the report |
| `storageStateFor(browser, user)` | sign in once, reuse the cookies (`test.use({ storageState })`) |

Every factory names things with a random run id, so tests can run in parallel against the same database. Always call `cleanup()` (fixtures do it for you).

## How to add a test

**pgTAP.** Add `supabase/tests/<area>_<topic>.test.sql`. Each file is one transaction that is rolled back. Start with `begin; select plan(n);`, end with `select * from finish(); rollback;`. Arrange as the owner (RLS bypassed), then act as a role:

```sql
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '<user uuid>', 'role', 'authenticated')::text, true);
-- assertions: results_eq, is_empty, throws_ok, policies_are, ...
reset role;
```

Users must exist in `auth.users` for foreign keys: insert them as the owner first (`insert into auth.users (id, email) values (...)`). See `00_smoke_rls_enabled.test.sql`.

**Integration (Vitest node).** Add `tests/<area>/<topic>.test.ts`. Get clients from `tests/helpers`, arrange with `createTestData`, `afterAll(() => data.cleanup())`. `server-only` is aliased to an empty module, so server code can be imported directly. Mock `next/cache` and `@/lib/supabase/server` when calling server actions (pattern in `tests/jobs/invites.test.ts`). Files run one at a time (`fileParallelism: false`).

**Component (Vitest jsdom).** Add `tests/components/<area>/<Component>.test.tsx`. Use `render`, `screen` queries by role and label, and `userEvent.setup()` for clicks and typing. jest-dom matchers (`toBeVisible`, `toBeDisabled`, ...) are set up. Mock `next/navigation` hooks with `vi.mock` where a component uses them.

**E2E (Playwright).** Add `e2e/<area>/<journey>.spec.ts`, import from `../fixtures`. Use role and label locators, web-first assertions (`await expect(...).toBeVisible()`), never fixed sleeps. Check `axe()` on each new page. For page transitions assert the URL and the new page's heading, and that no error boundary rendered. In Firefox, `axeSerious` loads axe without ARIA element reflection (`ariaLabelledByElements` and the like): axe reading those from the page and Playwright then reading them for a `getByRole(..., { name })` crashes Playwright's Firefox ("Page crashed"). `e2e/axe-harness.spec.ts` guards it; if a Firefox page crashes after `land()` or `a11y()`, start there.

**Screenshots (`toHaveScreenshot`).** The viewport (1280×800), locale, time zone (UTC), light colour scheme, disabled animations and hidden caret are fixed in `playwright.config.ts`. Mask anything time- or data-dependent (`mask: [page.getByTestId("deadline")]`). Baselines are **Linux only** and live in `e2e/__screenshots__/` (file names include the platform). Never commit macOS baselines. To create or update them: run the **e2e-snapshots** workflow (Actions → e2e-snapshots → Run workflow, optional `--grep`), download its `screenshot-baselines` artifact and commit the files. When a CI comparison fails, the `playwright-test-results` artifact has the expected, actual and diff images.

## CI

`.github/workflows/ci.yml` runs on every pull request and every push to `main`. No secrets needed.

| Job | Runs |
| --- | --- |
| `checks` | `next typegen`, `tsc --noEmit`, `lint`, `test:engine`, `test:components`, `build` |
| `database` | local Supabase, `test:db` (pgTAP), `test:coverage` (every Vitest project, including rls/jobs/candidate integration), coverage table in the job summary, `coverage` artifact |
| `e2e` | local Supabase, build against it, Playwright in chromium, firefox and webkit; on failure uploads `playwright-report` (HTML report) and `playwright-test-results` (traces, videos, screenshots, diffs) |

**Make `checks`, `database` and `e2e` required status checks** in branch protection for `main`.

`.github/workflows/nightly.yml` (03:00 UTC and on demand):

- `lighthouse`: production build against local Supabase, Lighthouse on `/login`, `/signup` and a fixture candidate landing page; warn-only budgets (performance ≥ 0.9, accessibility ≥ 0.95, best practices ≥ 0.9, CLS ≤ 0.1, LCP ≤ 2.5 s, TBT ≤ 300 ms); reports as the `lighthouse-reports` artifact. Not a required check.
- `cloud-smoke`: read-only check of the real deployment. Runs only when the repository secrets `CLOUD_SUPABASE_URL` and `CLOUD_SUPABASE_PUBLISHABLE_KEY` (and optionally `CLOUD_APP_URL`) are set; otherwise it notes the skip in the job summary and passes.

`.github/workflows/e2e-snapshots.yml`: manual, regenerates screenshot baselines on Linux (above).

Coverage is reported, not enforced. Add thresholds in `vitest.config.mts` once the phase 2 suites land.
