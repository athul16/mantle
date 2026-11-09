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

First two to build for the skeleton: `inbox_reply` and `spreadsheet`.

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

## Data model (draft)

All tenant tables carry `org_id` with RLS.

| Table | Key columns |
| --- | --- |
| `organizations` | id, name, logo, settings |
| `memberships` | org_id, user_id, role |
| `scenarios` | id, org_id (null = platform library), title, role_family, version, definition (JSON), published_at |
| `assessments` | id, org_id, scenario_id, time_limit, proctoring (JSON), locked_at |
| `jobs` | id, org_id, title, assessment_id, deadline |
| `invites` | id, org_id, job_id, email, token_hash, expires_at, status |
| `attempts` | id, org_id, invite_id, seed, started_at, deadline_at, submitted_at, status, score, integrity_label |
| `step_responses` | attempt_id, step_id, answer (JSON), updated_at, score (JSON) |
| `action_events` | attempt_id, at, kind, payload (opened message, started step, ...) |
| `integrity_events` | attempt_id, at, kind, payload (tab switch, paste, face missing, ...) |
| `media` | attempt_id, at, source (camera, screen, phone), storage_path |
| `flags` | attempt_id, reason, evidence (JSON), status (open, confirmed, cleared), reviewed_by |
| `notes` | attempt_id, author_id, body, vote |
| `audit_log` | org_id, actor_id, action, target, at |

Scenario definitions are versioned and immutable once published, so every candidate in a round sees the same version.
