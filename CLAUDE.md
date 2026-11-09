# Context for AI coding assistants

Read `docs/00-overview.md` first, then the doc for the area you are working on. The docs are the source of truth for product decisions.

Non-negotiable rules for any code in this repo:

- Every tenant-owned table has an `org_id` column and Row Level Security. Never write a query that can read across organizations.
- Answer keys, scoring logic, and variant generators run on the server only. Never send them to the browser.
- The timer is enforced on the server (`attempts.started_at` + limit). The client timer is display only.
- Proctoring media uploads go from the browser straight to storage via signed upload URLs, never through API routes.
- Integrity signals produce **suspicious labels with evidence**. Nothing in the code auto-rejects a candidate.
- New question or task kinds are added as **step types** (see `docs/06-assessment-engine.md`), not as special cases in the attempt flow.
