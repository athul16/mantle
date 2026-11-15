# 06 · Assessment engine

The engine knows nothing about accounting or pharmacy. An assessment is **data**: a scenario plus ordered steps. Each step uses a **step type** plug-in. This lets us build the whole platform before test content is final.

## Concepts

| Concept | Meaning |
| --- | --- |
| Scenario | The story and shared materials: company, role, documents, people, and a parameter generator |
| Step | One task inside the scenario, e.g., "reconcile the bank account" |
| Step type | A plug-in that defines how a step renders, what answer it saves, and how it's scored |
| Variant | Candidate-specific values produced by the scenario's generator, seeded by attempt ID |
| Message | An inbox item that delivers a step or info, optionally scheduled (e.g., arrives at minute 20) |

## Step type interface

```ts
interface StepType<Config, Answer> {
  type: string;                       // "spreadsheet", "journal_entry", ...
  // Browser: renders the task. Receives config with variant values filled in,
  // never the answer key.
  Component: React.FC<{ config: PublicConfig<Config>; answer?: Answer; onChange(a: Answer): void }>;
  // Server: validates the saved JSON shape.
  parseAnswer(raw: unknown): Answer;
  // Server: scores against the key computed from the variant.
  score(args: { config: Config; variant: Variant; answer: Answer }): Promise<StepScore>;
}

interface StepScore {
  points: number;
  maxPoints: number;
  items: { id: string; label: string; earned: number; max: number; note?: string }[];
  needsReview?: boolean;              // e.g., rubric scored by AI
}
```

## Step types

| Type | Used for | Scoring | Phase |
| --- | --- | --- | --- |
| `inbox_reply` | Written replies to emails | Rubric, AI-assisted, company can override | MVP |
| `spreadsheet` | Reconciliations, aging, calculations | Key cells checked by value (formulas not required) | MVP |
| `journal_entry` | Debit/credit entries | Accounts + amounts + direction | MVP |
| `document_review` | Flag issues in invoices, receipts, records | Issue flags + reason | MVP |
| `multiple_choice` | Quick knowledge checks | Exact | MVP |
| `numeric` | Single calculations (e.g., dosage) | Tolerance | MVP |
| `ordering` | Sequence steps of a procedure | Position-weighted | Later |

First two to build for the skeleton: `inbox_reply` and `spreadsheet`. Built so far: `numeric`, `inbox_reply`, `spreadsheet`, `journal_entry`, `document_review` (see "As built" below).

## Variants (anti-leak)

Each scenario has a server-side generator:

```ts
generate(seed: string): Variant   // deterministic for a given attempt
```

It produces the numbers (bank balance, check amounts, NSF amount) **and** the answer key from the same values, so the reconciliation always ties. Documents (bank statements, invoices) are rendered from templates with the variant values.

## Scoring and labels

1. On submit or timeout, score every step server-side.
2. Rubric steps get AI scores per criterion with reasoning; marked `needsReview`.
3. Compute integrity label from events and snapshot analysis (see `02-security-and-integrity.md`).
4. Store results; notify the company.

## As built (engine core)

Code: `src/lib/engine/`. Split so answer keys can't reach the browser:

| Folder | Holds | Runs in |
| --- | --- | --- |
| `types.ts` | Shared shapes (`ScenarioDefinition`, `Step`, `Message`, `StepScore`, `AttemptScore`); no keys | Both |
| `server/` | Seeded RNG (sfc32 + cyrb128), `{{name}}` / `{{name\|money}}` templates (plus `{{first_name}}`, the candidate's, "there" if unknown; not seeded), step-type interface, registry, render, score | Server only (`import "server-only"`) |
| `client/` | Browser registry, `StepView` | Browser |
| `step-types/<type>/` | `public.ts` (what the candidate sees, answer shape), `client.tsx` (input), `server.ts` (key schema, `parseAnswer`, `score`) | Split per file |
| `scenarios/` | Code-defined scenarios + generators, registered by `slug@version` | Server only |

Differences from the sketch above:

- `generate(seed)` returns `{ values, keys }`. Only `values` reach templates; `keys` go to `score()`.
- `score()` receives `{ config, key, variant, answer }`.
- Scheduled messages (`arriveAtMinute`) and the steps they deliver are withheld by the server until that minute (elapsed time from `attempts.started_at`).
- Money is generated in whole cents.
- `numeric` partial credit: full within `tolerance`, half within `partialTolerance`, else 0.

Entry points: `renderAttemptForCandidate(scenario, seed, elapsedMinutes)`, `renderStepForCandidate`, `parseAnswerForStep` (autosave), `scoreAttempt(scenario, seed, answers)`, `getScenario(slug, version)`.

### Built step types

Each has `public.ts` (candidate config, answer schema), `client.tsx` (view) and `server.ts` (config and key schemas, `toPublic`, `parseAnswer`, `score`). Points and labels for the company report are authored in the step config; per-variant expected values are in the key. Both are server only.

| Type | Candidate sees | Answer | Scoring |
| --- | --- | --- | --- |
| `numeric` | Prompt, unit | `{ value }` | Full within `tolerance`, half within `partialTolerance`, else 0 |
| `inbox_reply` | Prompt, to, subject, character limit | `{ body }` (≤ 20,000 chars) | Rubric criteria with guidance and per-variant reference notes. No AI scorer wired yet: a written reply scores 0 provisional points with `needsReview`; a blank one is final at 0 |
| `spreadsheet` | Grid of read-only cells and number input cells | `{ cells: { id: number \| null } }` | Each keyed cell full within its tolerance, else 0. Input cells not in the key are scratch |
| `journal_entry` | Prompt, chart of accounts (code + name), entry and line limits; running totals and a "Balanced / Out of balance by" check per entry | `{ entries: [{ memo, lines: [{ account, debit, credit }] }] }` | See below |
| `document_review` | A document (header fields, line table, totals, footnote) with a Flag toggle on every item; reason list; optional decision | `{ flags: [{ target, reason, note }], decision }`, one flag per item | See below |

**`journal_entry` scoring.** The config lists the expected entries (`id`, `label`, `points`, default 3); the key gives each one's lines as `{ accounts, side, amount }`, where `accounts` may list several acceptable accounts (docs/07: COGS or Accounts payable for the #1043 fix). Key entries must balance. Per expected entry:

- Each expected line earns 1 for the right account, side and amount (within `tolerance`, default half a cent) and ½ for the right account and side with a wrong amount. Each candidate line counts once.
- Each leftover candidate line costs ½, so listing every account can't buy credit. A line with both or neither amount filled counts as leftover.
- Entry share = (line credit − ½ × leftover lines) ÷ expected lines, floored at 0. An unbalanced entry earns at most half its points, since it couldn't be posted.
- Candidates may write entries in any order. Candidate entries are matched to expected entries to maximise the total, one to one (exact search; config allows ≤ 12 expected entries).
- Candidate entries that match nothing are listed in a 0-point "Entries not in the key" item for the reviewer. They aren't penalised.

**`document_review` scoring.** The config lists the findings (`id`, `label`, `points`, default 2), `falseFlagPenalty` (default 1) and an optional `decision` (`options`, `points`, default 1). The key gives each finding's `targets` (item ids it can be flagged on, e.g. the wrong line or the total it inflates), accepted `reasons`, a reviewer `note`, and accepted `decision` ids.

- A finding earns full points for a flag on one of its targets with an accepted reason, half for the right item with another or no reason. Exact matches are assigned first; each flag answers one finding.
- A flag on an item that belongs to no finding is a false flag. A second flag on another target of a found issue is not.
- False flags appear as one "False flags" item with negative `earned` and `max` 0. The deduction is capped at the points earned elsewhere, so the step never goes below 0 and `points` always equals the sum of item `earned`.
- Flags on ids that aren't in the document are ignored.

Leak tests (`tests/engine/mini-close.test.ts`, `tests/components/engine/no-key-in-dom.test.tsx`) check every key `value` / `amount` and every key string against the payload and DOM across many seeds. Key fields that only hold ids the candidate already chooses from (`accounts`, `side`, `targets`, `reasons`, `decision`) are skipped.

### Demo scenarios

Code-defined, in `src/lib/engine/scenarios/`. Not real test content.

| Slug | Steps | Shows |
| --- | --- | --- |
| `demo-petty-cash` | `numeric` | Engine core, seeded numbers |
| `demo-mini-close` | `spreadsheet`, `numeric` (minute 5), `inbox_reply` (minute 10) | Scheduled messages, a small bank rec |
| `demo-entries-review` | `journal_entry`, `document_review` (minute 8) | Four bank-rec adjusting entries (fee, NSF, interest, transposed check, from docs/07 Example 4); a vendor invoice with one line billed for extra units and an invoice number already paid in September (docs/07 Example 1 task 4), plus approve / reject / ask-vendor |

Preview (dev only): `/dev/engine?scenario=<slug>&seed=abc&minute=10`. The page lists every scenario, links to each message's arrival minute, and scores the answers on submit.

Scenario storage (decision Q6): code is the source of truth. Publishing a version copies its definition into a `scenarios` row, which is then immutable; attempts point at that row.

## Data model (as built)

All tenant tables carry `org_id` with RLS. Child tables of an attempt repeat `org_id`, and a composite foreign key forces it to match the attempt's. Migrations: `supabase/migrations/`. Isolation tests: `tests/rls.test.ts`.

Changes from the original draft:

- `organizations.slug`: unique URL name, generated from the name by `create_organization()` (lowercase, hyphens, 3–48 chars, reserved words blocked).
- Candidate secrets moved to server-only tables (RLS on, no policies): `invite_secrets` (token hash, email-code hash, code expiry and attempt count) and `attempt_secrets` (seed, session-token hash).
- `invites.candidate_name`, `invites.created_by`; `attempts.scenario_id`, `attempts.submit_reason`; `assessments.title`, `assessments.pass_score`.
- Triggers: published scenarios can't be edited; an assessment's time limit, proctoring, and scenario lock once a candidate starts.
- Role-check helpers live in a `private` schema the API doesn't expose.
- `invites.last_sent_at` and `invites.sent_count` (D12/S1): set on the first send and every resend; the job page shows "last sent". A partial unique index `invites_job_email_live_key` on `(job_id, lower(email))` for invited, started and completed rows (D12/S2) stops two batches from inviting the same email at once; the batch action retries its check when the insert hits it. Invites still marked invited after their expiry are marked expired before a batch, so they leave the index and can be re-invited.
- `invite_accommodations` (D9): per-invite extra time (+0/25/50/100%) and camera / screen-share waivers. Members read it; writes only through `set_invite_accommodations()`, which allows admins and recruiters before the candidate starts and writes the audit log. The extra time is applied to `attempts.deadline_at` when the attempt starts. `organizations.settings.contact_email` (set by admins through `set_contact_email()`) is shown to candidates.

Original draft table list (still accurate for the main columns):

| Table | Key columns |
| --- | --- |
| `organizations` | id, name, slug, logo, settings |
| `memberships` | org_id, user_id, role |
| `scenarios` | id, org_id (null = platform library), title, role_family, version, definition (JSON), published_at |
| `assessments` | id, org_id, scenario_id, time_limit, proctoring (JSON), locked_at |
| `jobs` | id, org_id, title, assessment_id, deadline |
| `invites` | id, org_id, job_id, email, expires_at, status (token hash → `invite_secrets`) |
| `attempts` | id, org_id, invite_id, scenario_id, started_at, deadline_at, submitted_at, status, score, integrity_label (seed → `attempt_secrets`) |
| `step_responses` | attempt_id, step_id, answer (JSON), updated_at, score (JSON) |
| `action_events` | attempt_id, at, kind, payload (opened message, started step, ...) |
| `integrity_events` | attempt_id, at, kind, payload (tab switch, paste, face missing, ...) |
| `media` | attempt_id, at, source (camera, screen, phone), storage_path |
| `flags` | attempt_id, reason, evidence (JSON), status (open, confirmed, cleared), reviewed_by |
| `notes` | attempt_id, author_id, body, vote |
| `audit_log` | org_id, actor_id, action, target, at |

Scenario definitions are versioned and immutable once published, so every candidate in a round sees the same version.
