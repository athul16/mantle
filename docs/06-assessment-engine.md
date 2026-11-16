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

First two to build for the skeleton: `inbox_reply` and `spreadsheet`. Built so far: `numeric`, `inbox_reply`, `spreadsheet`, `journal_entry`, `document_review`, `rapid_round`, `multiple_choice` (see "As built" below).

## Variants (anti-leak)

Each scenario has a server-side generator:

```ts
generate(seed: string): Variant   // deterministic for a given attempt
```

It produces the numbers (bank balance, check amounts, NSF amount) **and** the answer key from the same values, so the reconciliation always ties. Documents (bank statements, invoices) are rendered from templates with the variant values.

## Scoring and labels

1. On submit or timeout, score every step server-side.
2. Rubric steps are marked `needsReview` for a person. AI scores per criterion with reasoning are computed after submit in shadow mode only (see "AI rubric scoring" below).
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
| `inbox_reply` | Prompt, to, subject, character limit | `{ body }` (≤ 20,000 chars) | Rubric criteria with guidance and per-variant reference notes. A written reply scores 0 provisional points with `needsReview` and a person marks it; a blank one is final at 0. An AI scorer runs in shadow mode only (below) |
| `spreadsheet` | Grid of read-only cells and number input cells | `{ cells: { id: number \| null } }` | Each keyed cell full within its tolerance, else 0. Input cells not in the key are scratch |
| `journal_entry` | Prompt, chart of accounts (code + name), entry and line limits; running totals and a "Balanced / Out of balance by" check per entry | `{ entries: [{ memo, lines: [{ account, debit, credit }] }] }` | See below |
| `document_review` | A document (header fields, line table, totals, footnote) with a Flag toggle on every item; reason list; optional decision; optional "nothing wrong here" confirm | `{ flags: [{ target, reason, note }], decision, clean? }`, one flag per item | See below |
| `multiple_choice` | Prompt (the group's name) and options as radios (`select: "single"`) or checkboxes (`"multi"`) | `{ selected: [optionId] }` | See below |
| `rapid_round` | One quick item at a time with its own countdown | `{ items: { [itemId]: { values, ms } } }` | Per item, plus a timing line; see "Timed sections and rapid rounds" |

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

**`document_review` "nothing wrong here".** Optional, for documents that are clean in some variants, so a candidate doesn't have to invent a finding. The config adds `confirmClean: { label (default "Nothing wrong with this document"), points? }`; the candidate sees the label as a checkbox under the document (it can't be ticked while items are flagged, and items can't be flagged while it is ticked). The answer gets `clean: true | false`, sent only when the config offers the confirm. The key says `clean: true` for a variant whose document has no issues; then its `findings` must be empty and the config's findings are not scored in that variant. A config may list no findings at all only when it has `confirmClean` (every variant clean).

- Clean document: one "Nothing wrong" item worth `confirmClean.points`, earned only when confirmed. `points` defaults to the findings' total (2 when there are none), so every variant of the step has the same maximum. Flags on a clean document are false flags.
- Document with issues: confirming it clean costs `falseFlagPenalty`, like one more false flag, in the same "False flags" item and under the same cap.
- Backwards compatible: configs without `confirmClean`, keys without `clean` and answers without `clean` score exactly as before; a stray `clean` in an answer is ignored when the config doesn't offer the confirm.

**`multiple_choice` scoring.** Config: `prompt` and option labels (both may hold `{{templates}}`), `options: [{ id, label }]` (2 to 20, unique ids), `select: "single" | "multi"` (default single), `points` (default 1). Key: `{ correct: [optionId] }`, exactly one for single, one or more for multi. One "Answer" item:

- Single: full points when exactly the right option is picked, else 0.
- Multi: each right option picked earns `points / (right options)`; each wrong option picked costs `points / (wrong options)`, so picking every option earns 0. Floored at 0, rounded to 0.01. When every option is right, wrong picks can't happen.
- Picks that aren't options are ignored. The note lists the picks and, unless full marks, the expected options.

Leak tests (`tests/engine/mini-close.test.ts`, `tests/components/engine/no-key-in-dom.test.tsx`) check every key `value` / `amount` and every key string against the payload and DOM across many seeds. Key fields that only hold ids the candidate already chooses from (`accounts`, `side`, `targets`, `reasons`, `decision`, `choice`, `correct`) are skipped, but only id-shaped strings in them: a note or sentence under one of those fields is still checked. Keys whose secret is *which* public id is right (`multiple_choice`) or whether a document is clean can't be caught by a string search, so a test-only scenario (`tests/engine/key-variants.ts`) keeps the values fixed and varies only the keys, and the tests require the payload and DOM to be identical across seeds.

### Timed sections and rapid rounds

Some tests need parts with their own clock: a two-minute burst of quick checks, then work screens shown one at a time, then a longer task. This is data on the scenario, not a special case in the attempt flow. Code: `src/lib/engine/sequence.ts` (clock math), `src/lib/engine/server/flow.ts` (sections, screens, items, message arrival, authoring checks), `src/lib/candidate/attempt.ts` (applies them to requests), `src/app/api/candidate/advance/route.ts`.

**Sections.** `ScenarioDefinition.sections?: { id, title, minutes, stepIds, oneAtATime? }[]`. Sections run back to back from `attempts.started_at`. Each gets its own `minutes`; the next one starts when it runs out or when the candidate presses "Finish section" (confirmed in a dialog), whichever is first. Only the current section's steps are open: the server leaves the others out of the workspace payload and answers a save to them with `locked`. Without `sections` nothing changes: every step is open for the whole attempt. `validateSections(definition, timeLimitMinutes)` reports steps in no section or in two, unknown steps, missing screen times and sections that add up to more than the time limit; a test runs it on every code-defined scenario.

**One-at-a-time screens.** In a `oneAtATime` section each step is a screen with its own `Step.seconds`. One screen is open at a time; "Next screen" moves on early. Screens are cut at the section's end, and the section ends when its last screen ends, so nobody waits on an empty section. The section countdown in the bar shows the section's own limit.

**Messages.** A message linked to a step in a section arrives `arriveAtMinute` after that section starts (and never before it starts), so a section's brief is there when it opens. Messages without `stepId` are timed from the attempt start as before. In the payload, `arriveAtMinute` is the actual arrival in minutes after the attempt start.

**The overall timer never pauses (D4).** Sections sit inside the attempt's deadline; finishing early starts the next section, it doesn't bank time. When every section is over, the workspace shows a card that links to review; the attempt still ends at submit or the deadline.

**Sequence hook.** A step type may implement `sequence` on `ServerStepType`: `count(config)`, `secondsPerItem(config)`, `renderItem(config, ctx, index)` (one item, templates filled, nothing from the key) and `recordItem(config, prev, index, raw, ms)` (validates `{ index, values }`, adds it to the saved answer, throws on a bad shape, another item or an item that already has an answer). For such a step the attempt flow injects `config.current = { index, count, endsAt, item }` (or `config.done`) and nothing else about the items. Items run back to back from the step's start (its section, screen, or the attempt), each `secondsPerItem` long and never past the step's end; an answer moves straight on to the next item. A save is accepted only for the open item, or for one that closed less than 1.5 s ago (network delay), else `item_closed`. Response time is measured on the server (`now - item start`). Browser components submit an item with `onCommit` (no debounce); the workspace refreshes after it, when the nearest section, screen or item deadline passes, and after a `locked` / `item_closed` reply (which it never retries).

**Extra time** (`invite_accommodations.extraTimePercent`) stretches sections, screens and items by the same percent, as it stretches the overall limit.

**Events.** All flow state is computed from server-written `action_events` (no schema change): `advanced_section { sectionId, at }`, `advanced_screen { stepId, at }` and `answered_item { stepId, index, at }`, with `at` as the server time of the request. An advance counts only inside the window of the section or screen it names, so a stale or repeated request changes nothing (the API answers `not_current`). The browser can't write these kinds: `/api/candidate/event` accepts only `opened_message` and `started_step`.

**Review.** With sections, the review page lists every step of every section that has started; steps of finished sections show "Section closed". Scoring is unchanged: every step is scored at submit, unanswered ones as 0.

**`rapid_round`.**

| | |
| --- | --- |
| Config | `{ intro, secondsPerItem (default 20), items: [{ id, prompt, exhibit?: { title?, rows?: [{ label, value }], table?: { columns, rows } }, fields, points (default 1) }] }`. Fields: `{ id, label, kind: "choice", options: [{ id, label }] }` or `{ id, label, kind: "number", unit?, decimals }`. Prompts and exhibit text may hold `{{templates}}` |
| Candidate sees | `toPublic` gives only `{ intro, itemCount, secondsPerItem }`; the open item arrives as `current`. Choice fields are sent without `kind` (anything with `options` is a choice), so the word `choice` only ever appears in keys |
| Key | `{ items: { [itemId]: { [fieldId]: { choice } \| { value, tolerance (default 0) } } } }` |
| Answer | `{ items: { [itemId]: { values, ms } } }`; only the first answer to an item counts |
| Scoring | Per item: share of fields right × points, with a note (`Correct in 4.2s.`, the misses, or `No answer`). Plus a 0-point `timing` item: `Median response 7.0s over 2 answered; 1 with no answer.` |
| View | "Item N of M", the item's countdown (`role="timer"`; the header clock drops the role while an item shows its own), the exhibit, radio groups or a number box ("1,250.50" is read as 1250.5), and "Submit answer", enabled once every field is filled |

The demo `demo-timed-close` (12 minutes) has three sections: "Quick checks" (2 minutes, a four-item rapid round: two journal-entry flashes, a pay / hold invoice with a seeded exhibit and a depreciation amount), "Work screens" (3 minutes, one at a time: allowance for doubtful accounts, 90 s; monthly insurance expense, 90 s) and "Reply" (4 minutes, an email from the owner linked to the reply step), plus an intro message at the start.

**Company report.** `describeStep` (`src/lib/results/answer-key.ts`, server only, rendered only on org-member pages) gives one row per rapid item: `Item N`, the prompt with templates filled, the candidate's values (`Debit: Rent expense; Credit: Cash`, numbers with unit and decimals), the expected values from the key (a tolerance shown only when it's at least the last shown decimal) and the server-measured response time; then the step's "Response time" line. The report table adds a Time column when rows have times.

**Report rows for timing (evidence only).** When the scenario has a `rapid_round`, the report shows a Timing card (`src/lib/results/timing.ts`, computed in `getCandidateReport` with the member's own client, so RLS applies). Neither row changes the score, `integrity_label`, flags or `src/lib/proctoring/rules.ts`; the card says so, and its wording is neutral.

- *Answered within 2 s of returning to the window:* each `answered_item` action event (time from its payload, server clock) is joined with the latest `returned_to_window` browser signal at or before it; answers within 2 s (`QUICK_AFTER_RETURN_MS`) are listed with the item, the gap, how long the candidate was away and when. Return times come from the browser's clock, so a small clock skew can move an answer across the 2 s line.
- *Rapid round vs other tasks:* rapid-round score % against every other step's score %, points pooled on each side, leaving out steps still waiting for a reviewer. Shown when the two are 30 points or more apart (`RAPID_GAP_POINTS`), in either direction.

### AI rubric scoring, shadow mode (decision D8)

After a submit (candidate or timeout), each non-blank `inbox_reply` is scored by Claude Sonnet 5.5 (`claude-sonnet-5-5`) against the same criteria, guidance and reference facts a reviewer sees. The result is **never shown to anyone and never used in a score**: it goes to `ai_shadow_scores`, which only the service role can read, so AI and human scores can be compared before deciding whether to show AI suggestions (D8 option C).

- Code: `src/lib/engine/step-types/inbox_reply/ai-scorer.ts` (prompt, structured output, clamping through `applyRubricResults`), `src/lib/engine/server/rubric-requests.ts` (rubric requests rebuilt from the seed), `src/lib/candidate/shadow-score.ts` (runs it and stores the rows).
- When: scheduled with Next's `after()` from the submit path (decision E6), so it runs after the response. It never blocks or fails a submission: every error is caught and logged, without candidate content.
- Key: `ANTHROPIC_API_KEY` (server only). Without it the scorer logs and skips. Tests remove the key and use a fake client; they never call the API.
- Each row stores the model id, `prompt_version` (bump `PROMPT_VERSION` whenever the prompt, schema or request settings change), per-criterion `earned` / `max` / `reasoning`, status (`scored` or `failed`, with `stop_reason` and `error`), token usage and duration. One row per attempt, step, model and prompt version; a re-run skips steps already stored.
- No server-side fallback model is configured: a refusal is stored as `failed` rather than scored by a different model, which would mix models in the agreement data.
- Comparison, in the Supabase SQL editor: `select * from private.ai_shadow_agreement order by step_id, criterion_id;` gives, per model, prompt version, step and criterion, how many replies were AI-scored and compared with a reviewed human score, the means, the mean absolute difference, the exact-agreement rate and the share within a quarter of the criterion's points. `private.ai_shadow_criterion_scores` has the row-level pairs with the AI's reasoning. Both views are in `private`, which the API doesn't expose, and only the owner and service role can select from them.
- Retention: rows cascade with the attempt, so candidate deletion and retention purges remove them.

### Demo scenarios

Code-defined, in `src/lib/engine/scenarios/`. Not real test content.

| Slug | Steps | Shows |
| --- | --- | --- |
| `demo-petty-cash` | `numeric` | Engine core, seeded numbers |
| `demo-mini-close` | `spreadsheet`, `numeric` (minute 5), `inbox_reply` (minute 10) | Scheduled messages, a small bank rec |
| `demo-timed-close` | `rapid_round`, two `numeric` screens, `inbox_reply`, in three timed sections | Timed sections, one-at-a-time screens, rapid items (see "Timed sections and rapid rounds") |
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
- `attempts.auto_score` and `step_responses.auto_score` (decision D11): the score as the server computed it at submit. `score` is the final score, which a rubric review (`review_rubric_step`) changes; `auto_score` never changes once written (a trigger refuses). Rows from before the change were backfilled: a reviewed rubric step's automatic score is the same step with every criterion back at 0 and `needsReview`, which is what `inbox_reply` always produces. The candidate report shows the automatic score next to the final one once a reviewer has changed it.
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
