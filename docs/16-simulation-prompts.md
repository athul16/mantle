# 16 · Simulation authoring prompts (first wave)

Prompts for subagents that build one simulation each, in lead order from `15-next-industries.md`. Give a subagent the **build contract** followed by **one role prompt**. One subagent, one simulation, one branch, one PR.

| Order | Role | Slug | `roleFamily` |
| --- | --- | --- | --- |
| 1 | Marketing coordinator / analyst | `marketing-saltbox-launch` | `marketing` |
| 2 | Business / operations analyst | `analyst-corvid-ops-review` | `consulting` |
| 3 | HR / people operations coordinator | `peopleops-fernhill-onboarding` | `hr` |
| 4 | Bank analyst programme, commercial credit | `banking-stonebridge-renewal` | `banking` |
| 5 | Assistant buyer / merchandise planner | `retail-wrenfield-trade` | `retail` |
| 6 | Insurance claims representative trainee | `claims-kestrel-auto-desk` | `insurance` |

All six share one shape: 50 minutes, 100 points, six timed sections (6 + 10 + 6 + 10 + 6 + 12 minutes), three rapid rounds, two long tasks, and a final desk section shown one screen at a time that holds the values calls. Everything is scored automatically, which matters for high-volume rounds: no attempt waits on a reviewer.

Second-wave prompts (shortage markets) are in `17-simulation-prompts-shortage-markets.md`; they use this file's build contract.

---

## Build contract (prepend to every role prompt)

```text
You are a subagent building ONE job simulation for a hiring assessment platform.
A candidate opens an invite link and works through a timed, realistic slice of a
working day; the hiring company gets a scored report with evidence. You build
the scenario: story, materials, per-candidate variants, answer keys, tests and a
review doc. You do not change the platform.

=== 0. HOW TO WORK ===
- Do not ask before running commands, reading files or looking things up. Stay
  strictly on this task; read only what it needs. Finish through to an open PR
  and a short report. If something truly blocks you, say exactly what and stop.
- Branch: feat/sim-<slug> from main. Commits: short, lowercase, one line, one
  per logical change (tests first, then scenario, then doc). No AI or tool
  attribution anywhere: commits, PR body, comments, docs.
- Before creating files, list them with their directories.
- Never print .env.local or any key. Never point anything at the cloud
  database. Never run `pnpm scenarios:publish`.

=== 1. STACK AND WHAT YOU MAY TOUCH ===
Next.js 16 (App Router) + TypeScript, Supabase Postgres with Row Level
Security, Vitest, pnpm. A scenario is server-only TypeScript; you need no app
routes, no React, no SQL.

Create:
  src/lib/engine/scenarios/<slug>.ts
  tests/engine/<slug>.test.ts
  docs/<roleFamily>/<slug>.md
Edit:
  src/lib/engine/scenarios/index.ts   (import + one registry line; the
                                       /dev/engine picker lists it by itself)
  docs/10-progress.md                 (one history row)
Optional: src/lib/engine/scenarios/<roleFamily>/ for helpers a second
  simulation in this family would reuse (name pools, formatters).

Do NOT touch: supabase/migrations/, src/lib/database.types.ts, anything under
src/app/, src/lib/supabase/, src/lib/candidate/, src/lib/results/, the step
types in src/lib/engine/step-types/, or the engine in src/lib/engine/server/.
If you believe one of these must change, stop and report why.

=== 2. HOW A SCENARIO MEETS THE DATABASE ===
You write no database code, but your scenario must fit these facts:
- Code is the source of truth. Publishing (not your job) copies
  { slug, version, title, role_family, time_limit, definition } into one row
  of the `scenarios` table with org_id = null (the platform library). That
  row is immutable. Attempts point at it. So `definition` must be plain JSON
  (no functions, dates, undefined, Maps) and once a version is published any
  change needs version + 1.
- The per-candidate seed lives in `attempt_secrets` (service role only). The
  server calls generate(seed) on every render and at scoring, so your
  generator must be pure: same seed, same output. No Date.now(), no
  Math.random(), no I/O, no environment reads. Use only the Rng you are given.
- Answers autosave to `step_responses.answer` as JSON in the step type's
  answer shape, keyed by your step id. Step ids are therefore permanent for a
  version. Scores are stored per step from StepScore items; the labels you
  author in step configs are what the company reads in the report.
- Section progress, rapid-item timing and message opens are server-written
  `action_events`. You add nothing for them; you only declare sections.
- Tenant data, RLS and org_id are untouched by a scenario. Do not query
  Supabase from scenario code.
- Keys never go to the browser. Only `values` fill templates. The repo's leak
  tests iterate every registered scenario and will fail yours if a key number
  or key sentence appears in the candidate payload or DOM.

=== 3. READ BEFORE WRITING ===
1. CLAUDE.md, docs/00-overview.md, docs/06-assessment-engine.md (all of it).
2. The model simulation, end to end:
   docs/paralegal/corporate-halyard-robotics.md
   src/lib/engine/scenarios/corporate-halyard-robotics.ts
   tests/engine/corporate-halyard-robotics.test.ts
3. src/lib/engine/types.ts, src/lib/engine/server/scenario.ts,
   src/lib/engine/server/rng.ts, src/lib/engine/server/template.ts.
4. server.ts and public.ts of each step type you use, under
   src/lib/engine/step-types/<type>/. The zod configSchema and keySchema there
   are the contract; if this prompt and the schema disagree, the schema wins.
5. src/lib/engine/scenarios/legal/dates.ts if your role prompt uses business
   days (import it; do not move it). Its holiday tables are verified for
   2026 to 2028 only: keep seeded dates inside those years.

=== 4. SCENARIO CONTRACT ===
export const <camelSlug> = defineScenario({
  slug, version: 1, title, roleFamily, timeLimitMinutes: 50,
  definition: { intro, steps, messages, sections },
  build(rng) { ...; return { values, keys }; },
});

- `definition` is STATIC. Every per-candidate difference reaches the screen
  through {{templates}} filled from `values`: {{name}}, {{amount|money}}
  (value in whole cents), {{count|number}}, and {{first_name}} (the
  candidate's; not yours to set). An unknown template name throws.
- So a document table has a fixed number of rows whose cells are templates
  ("{{po3_qty}}"); which row carries which trap is decided in build() and
  recorded in keys. Pre-format strings (dates, percentages, share counts) in
  build() and store them in values.
- `values`: flat Record<string, string | number>.
  `keys`: Record<stepId, key> in each step type's key shape.
- Message `from` and step `title` are not template-filled: use role lines
  ("Your manager", "Paid media lead") and sign bodies with seeded names.
- Rng: next(), int(min, max) inclusive, pick(array), shuffle(array),
  cents(minDollars, maxDollars). Money is whole cents everywhere.
- Ids: lowercase letters, digits, hyphen, underscore.

Sections: { id, title, minutes, stepIds, oneAtATime? }. They run back to
back and must cover every step exactly once and sum to at most the time limit
(validateSections). In a oneAtATime section every step needs `seconds`, and
the seconds should sum to the section's minutes. A message with `stepId`
arrives `arriveAtMinute` after its SECTION starts; use this for the brief of
each section (minute 0) and for the mid-task update (for example minute 4).

=== 5. STEP TYPES YOU MAY USE (limits from the schemas) ===
rapid_round
  config { intro, secondsPerItem: 20, items: [{ id, prompt, exhibit?:
    { title?, rows?: [{label, value}], table?: { columns, rows } },
    fields: [{ id, label, kind: "choice", options: [{id, label}] } |
             { id, label, kind: "number", unit?, decimals }], points }] }
  key { items: { [itemId]: { [fieldId]: { choice } | { value, tolerance } } } }
  Up to 50 items. Item id "timing" is reserved. Use fixed option ids (a, b, c,
  d) and seed which label sits on which id.
spreadsheet
  config { prompt, columns (max 26), rows (max 200) of cells: string |
    { text, bold?, align? } | { input: cellId, label, points, format:
    "money" | "number" } | null }
  key { tolerance, cells: { [cellId]: { value, tolerance? } } }
  Inputs are numbers only. Money answers are in dollars. Give every input a
  `label`: it is the row name in the company report.
document_review
  config { prompt, document: { title, fields: [{id,label,value}], columns
    (max 12), rows: [{ id, cells }] (max 200), totals, footnote? },
    reasons: [{id,label}] (2 to 20), findings: [{ id, label, points }],
    falseFlagPenalty (default 1), decision?: { prompt, options, points },
    confirmClean? }
  key { findings: { [findingId]: { targets: [rowOrFieldId], reasons:
    [reasonId], note? } }, decision?: [optionId], clean? }
  Full points for the right item with an accepted reason, half for the right
  item with another reason; each false flag costs the penalty, floored at 0.
multiple_choice
  config { prompt, options: [{id,label}] (2 to 20), select: "single" |
    "multi", points }   key { correct: [optionId] }
numeric
  config { prompt, unit?, decimals, points }
  key { value, tolerance, partialTolerance? }
ordering
  config { prompt, items: [{ id, label, detail? }] (6 to 12),
    positionPoints, pairwisePoints }   key { order: [itemId] }
  The authored item order is what the candidate first sees: make it unrelated
  to the key, and let build() decide which content sits on which id.
Do not use inbox_reply (it waits for a human reviewer) or journal_entry.
If a task needs anything else, do not special-case the attempt flow: build
without it and describe the missing step type in your report.

=== 6. SHAPE ===
Sections, in order (ids fixed across all simulations for comparable reports):
  s-rapid-a   6 min   one rapid_round, 15 items x 20 s          10 pts
  s-work-1   10 min   long task 1                                20 pts
  s-rapid-b   6 min   rapid_round                                10 pts
  s-work-2   10 min   long task 2                                20 pts
  s-rapid-c   6 min   rapid_round                                10 pts
  s-desk     12 min   oneAtATime: short tasks + values calls     30 pts
Rapid rounds: items 3, 6, 9, 12, 15 are the harder kinds worth 1 point; the
other ten are worth 0.5. Total exactly 100. A blank attempt scores 0.

=== 7. VARIANTS AND ANTI-COPYING ===
- Seed everything a candidate could copy: every name, company, number, date;
  which row or document carries which trap; row order; option order; where
  the right option sits; which of several equivalent sub-scenarios is used.
- Keys are computed in build() from the same draws as values, so they tie.
- Every reviewed document has clean look-alikes on every seed (items that
  resemble a trap but are fine). False flags cost points.
- Replaying one seed's perfect answers on another seed must average under 40.
- Leak guard: after building, check that no key number appears in any value
  string in a form the leak tests read (12.34, 1,234.56, cents as digits). If
  one does, redraw the whole variant deterministically from the same seed, as
  the model simulation does. Format counts and money so chance collisions are
  rare.

=== 8. IMMERSION ===
- One working day at one fictional firm. The intro and the first message, from
  a named manager, set the stakes and a deadline inside the fiction.
- A recurring cast of three to five people, each with a recognisable voice,
  seeded names, fixed role lines. Every task arrives as a message from one of
  them and reads like a real email or chat. No "Question 4", no "the
  candidate", no exam phrasing.
- Documents look like the trade's real artefacts: the same fields, column
  order and abbreviations a practitioner sees daily, with some realistic
  noise (an irrelevant line, a note).
- Continuity: a fact from the first long task matters again later; each long
  task gets one mid-task message that changes the work (a revised figure, a
  withdrawn item). The engine does not branch, so anything referring back
  must be true whatever the candidate answered.
- The last section is rushed on purpose. Never hide information a real
  employee would have.

=== 9. FAST SECTIONS (integrity by design) ===
- Never leave a long quiet stretch: rapid rounds sit between the long tasks.
- Every rapid item must need its on-screen exhibit (seeded numbers, dates,
  names, a rule from this firm's own card). Nothing answerable from general
  knowledge alone, and nothing a search or a pasted prompt answers faster
  than a competent person reading the exhibit. Keep exhibits to what can be
  read in about eight seconds.
- Exactly one right option per item. Wrong options are the specific slips a
  weak candidate makes; list them in the doc.
- Calibrate so a competent practitioner finishes most items with a few
  seconds left. Speed is evidence in the report, never a reason to reject.

=== 10. VALUES CALLS ===
Five multiple_choice steps in s-desk, ids `values-<tag>`, 2 points each,
titles "Judgment: <short name>". They are situations from this job, written
as messages from the cast, never a personality questionnaire.
Tags (use the five your role prompt names):
  integrity (won't alter records, backdate or hide a problem)
  candor (raises bad news early and plainly)
  ownership (finishes, follows up, admits own mistakes)
  client-care (protects the client's or customer's interest and information)
  in-lane (escalates what is above their authority instead of guessing)
  quality (won't skip a control to hit a deadline)
  teamwork (handles a colleague's error without hiding it or humiliating them)
Rules: four options with fixed ids, order seeded. The right option must be
defensible from a rule, duty or written firm policy you can cite. The three
wrong options are tempting in different ways: the helpful shortcut, the
people-pleasing yes, the over-escalation that helps nobody. At least one call
has pressure from a superior or a client. The "candor" call is about the
candidate's own mistake: make it true on every seed by having a colleague's
message report it. Seed the surrounding facts so answers can't be memorised.
Whether values points should count in the total, and whether companies can
pick their own values, are open product questions: list them in the doc.

=== 11. TESTS FIRST ===
Write tests/engine/<slug>.test.ts before the scenario and commit it failing.
Follow the model test: `vi.mock("server-only", () => ({}))`, dynamic imports,
`renderAttemptForCandidate(scenario, seed, timeLimit)` to read what the
candidate sees, `scoreAttempt(scenario, seed, answers)` to score. Over 200
seeds ("attempt-0000" ...), with a long timeout:
 1. Solve every task from the rendered material with the test's OWN reading of
    the rules (parse the on-screen strings; do not import scenario internals)
    and compare with scenario.generate(seed).keys.
 2. Perfect attempt = 100; blank = 0; maxPoints = 100 on every seed.
 3. Each planted trap costs exactly its points; right item with a wrong
    reason earns half; each false flag costs the penalty.
 4. Every rapid item has exactly one right option; round totals are 10.
 5. Another seed's perfect answers average under 40.
 6. No key note and no computed key number appears in the candidate payload.
 7. validateSections returns no problems; one-at-a-time seconds sum to the
    section; every message with a stepId points at a real step.
 8. The scenario is in listScenarios() and getScenario(slug, 1) returns it.
 9. Each values step has four options, one right, and the right option's
    position varies across seeds.
Then build the scenario until they pass. Run:
  pnpm test:engine
  pnpm test:components      (the DOM leak test covers every scenario)
  pnpm lint
  pnpm exec tsc --noEmit
Preview: /dev/engine?scenario=<slug>&seed=abc&minute=0 (also minutes 6, 16,
22, 32, 38) with three different seeds. Read it as a candidate would.

=== 12. DOC AND REPORT ===
docs/<roleFamily>/<slug>.md in the format of
docs/paralegal/corporate-halyard-robotics.md: status "draft: practitioner
review pending", the facts table, setup and what is seeded, sections and
timing, every task with each trap, its expected answer and the rule behind
it, the wrong options, the values calls with their tags, the scoring table,
what the tests prove, and "Judgment calls for review".
Add one dated row to the history table in docs/10-progress.md.
Open a PR. Report back: what you built, test and lint results, every place
you were unsure of the domain, and any step type you wished for.

=== 13. DOMAIN ACCURACY ===
Practitioners will spot a wrong term in seconds. Look up each rule you rely
on from a primary or standard source before keying it, and cite it in the
doc. Anything that changes over time (rates, thresholds, limits, fees) is
handed to the candidate inside the scenario on a seeded "card" or policy
excerpt; they apply the card, they are never scored on this year's number.
Where practice varies by firm, make it this firm's written policy and say so.
Where you could not verify something, list it under "Judgment calls for
review" instead of guessing. All companies and people are fictional; use the
`.example` domain for any email address.
```

---

## Prompt 1 · Marketing coordinator / analyst

```text
SIMULATION `marketing-saltbox-launch`, roleFamily `marketing`,
title "Launch week at Saltbox: marketing coordinator".

SETTING
The candidate is a marketing coordinator at Saltbox Provisions (fictional
direct-to-consumer brand; seed the product line from a pool of five, such as
cookware, coffee gear, pet food, skincare, luggage). It is launch week for a
new product. Cast: the marketing manager (terse, wants the Friday report),
the paid media lead, the designer, the agency account executive, the finance
partner.

SEEDED CARDS (first messages, stay in the inbox)
- Launch sheet: product name with exact capitalisation, launch date and time,
  price, promo code and discount, the UTM campaign tag, suppressed audience
  segments, the required legal line for offers.
- Brand and claims guide: claims allowed and not allowed, the disclosure rule
  for paid partners, naming rules.
- Reporting rules: formulas the team uses (CTR = clicks / impressions,
  CPC = spend / clicks, CPA = spend / orders, ROAS = net revenue / spend, net
  revenue = revenue less refunds), "blended means from totals, never the
  average of channel ratios".
- Test plan: minimum sample per arm and minimum lift to ship a variant.
- Agency statement of work: rate card, monthly hours cap, what needs a
  change order.

STEPS
s-rapid-a  `rapid-metrics` (10). Exhibit: one channel's row. Easy kinds: CTR,
  CPC, CPA, conversion rate, CPM. Hard kinds: blended CPA across two
  channels, percent change vs last week, budget pacing (share spent vs share
  of days elapsed: ahead, on pace, behind). Wrong options: ratio inverted,
  percent as decimal, average of ratios, gross instead of net revenue.
s-work-1   `campaign-report` (spreadsheet, 20). Five channels x spend,
  impressions, clicks, orders, revenue, refunds. Inputs: net revenue, CPA and
  ROAS per channel (15 cells, 1 point each), total net revenue (1), blended
  CPA (2), blended ROAS (2). Traps: one campaign appears twice under the same
  campaign id and must be counted once (the manager's brief says the export
  double-counts relaunches); refunds must be netted; one channel has zero
  orders (CPA cell is left out of the key for that seed, not scored).
  Mid-task (minute 4): the paid lead revises one channel's spend.
s-rapid-b  `rapid-copy` (10). Exhibit: a short piece of copy plus the launch
  sheet line it must match. Choice: fine to publish, wrong price, wrong code,
  wrong product name, claim not allowed, missing legal line. Hard kinds:
  copy that breaks two rules (pick the option naming both), a date that is
  right but the weekday is wrong, a partner post without the disclosure.
s-work-2   `launch-qa` (document_review, 20). Rows: twelve assets (emails,
  landing page, paid ads, social posts, SMS) with columns asset, headline,
  price, code, link tag, send time, audience, legal line. Six findings x 3:
  promo code differs from the launch sheet; price differs; UTM campaign tag
  wrong or missing; scheduled before the launch time; audience includes a
  suppressed segment; required legal line missing. Decision (2): hold the
  flagged assets and send the list to the manager. Wrong decisions: approve
  all, fix them yourself in the live tools without telling anyone, cancel
  the launch. Clean look-alikes: a send time exactly at launch, a code in
  different letter case where the sheet says codes are not case sensitive, a
  tag in a different parameter order.
s-rapid-c  `rapid-budget` (10). Remaining budget, daily spend needed to land
  on budget, forecast orders at a CPA, agency fee as a percent of media, PO
  vs invoice difference. Hard: reallocating between two channels with the
  total fixed.
s-desk (720 s)
  `invoice-check` (document_review, 12, 270 s): agency invoice against the
    statement of work. Four findings x 2.5: hours above the monthly cap, a
    rate that isn't on the rate card, an out-of-scope line with no change
    order, an extension that doesn't multiply. Decision (2): return to the
    agency with the list, copy finance.
  `ab-readout` (multiple_choice, 4, 75 s): visitors and orders for A and B
    against the test plan: ship B, keep A, or keep running. Seed cases where
    the lift is large but the sample is below the plan's minimum.
  `ab-lift` (numeric, 4, 75 s): relative lift of B over A in percent, one
    decimal, half credit within a rounding slip.
  `values-integrity` (60 s): the manager asks for the board slide to show
    ROAS before refunds "because it looks cleaner".
  `values-candor` (60 s): the designer notices an email the candidate
    scheduled this morning carries last month's code.
  `values-client-care` (60 s): the agency asks for the full customer email
    list; the statement of work allows hashed lists only.
  `values-in-lane` (60 s): a partner wants the candidate to confirm the
    product is "clinically proven"; claims approval is legal's.
  `values-quality` (60 s): the paid lead suggests skipping link checks to hit
    the send time.

VERIFY AND CITE
FTC guidance on endorsement disclosures; CAN-SPAM opt-out handling; that
advertising claims need substantiation. Formulas, the test plan and the
suppression rules are Saltbox policy: say so.

FLAG FOR REVIEW
Whether a written task (a results summary to the manager) is worth a human
reviewed step in a later version; whether statistics beyond the test plan's
simple rule belong in an analyst-level sibling.
```

---

## Prompt 2 · Business / operations analyst

```text
SIMULATION `analyst-corvid-ops-review`, roleFamily `consulting`,
title "Corvid Lane: operations review analyst".

SETTING
The candidate is a first-year analyst at Corvid Lane Advisory (fictional) on
a cost review for a regional distribution client (seed the client and its
industry from a pool: grocery wholesale, auto parts, medical supplies,
building materials). The steering committee meets at 4. Cast: the engagement
manager, a senior consultant, the client's operations director, the client's
finance analyst.

SEEDED CARDS
- Engagement brief: scope, the sites in scope (one site closed mid-year and
  is out), the benchmark the team uses (median of in-scope sites), the
  one-time cost assumptions.
- Data notes from the client: units of each column, which site reports in
  thousands, which site has only some months of data.
- Firm standards: every number on a slide has a source; titles state only
  what the data shows; periods and units are labelled; client data stays in
  the engagement folder.

STEPS
s-rapid-a  `rapid-numbers` (10). Exhibit: two to four figures. Easy kinds:
  percent change, margin, share of total, unit cost, simple break-even. Hard
  kinds: percent of a percent, weighted average across two groups, mix
  effect (total margin falls though both segments rise), compound growth
  over three periods chosen from four close options. Wrong options: base
  swapped, percentage points vs percent, simple instead of weighted.
s-work-1   `site-analysis` (spreadsheet, 20). Eight sites x volume, labour
  hours, cost, months of data. Inputs per in-scope site: annualised cost per
  unit and units per labour hour (14 cells, 1 point each); the benchmark
  cost per unit (2); total annual saving if every site above the benchmark
  reaches it (4). Traps: the part-year site must be annualised; the site
  reporting in thousands must be scaled; a duplicated site row counts once;
  the closed site is excluded. Mid-task (minute 4): the client's analyst
  corrects one site's labour hours.
s-rapid-b  `rapid-evidence` (10). Exhibit: a small table or chart summary and
  one statement. Choice: supported, not supported, contradicted. Hard kinds:
  correlation presented as cause, a claim about a rate from counts with
  different bases, a trend claimed from two points, a subgroup result that
  reverses the total.
s-work-2   `deck-check` (document_review, 20). The senior's draft deck as
  rows (slide, title claim, figure cited, period, unit, source) with the data
  appendix as header fields. Six findings x 3: figure doesn't match the
  appendix; title claims more than the data shows; shares that don't add to
  100; fiscal year mixed with calendar year; thousands labelled as millions;
  a number with no source. Decision (2): send the list to the senior before
  the deck goes anywhere. Wrong: fix the numbers quietly, send the deck to
  the client contact who asked for a preview, leave it for the manager's
  review. Clean look-alikes: a rounded figure within the firm's rounding
  rule, shares that total 100 after rounding.
s-rapid-c  `rapid-sense` (10). "Is this figure plausible?" Exhibit gives the
  inputs; choose the right order of magnitude or the right next check. Hard:
  unit conversions and per-day vs per-year.
s-desk (720 s)
  `summary-order` (ordering, 8, 150 s): seven lines of the executive summary
    to put in order: the answer, three supporting findings ranked by seeded
    saving size, the risk, the ask, next steps. The key follows the firm
    standard "answer first, supports by size" from the card. Pairwise 5,
    position 3.
  `payback` (numeric, 6, 90 s): payback in months from the one-time cost and
    the monthly saving.
  `net-saving` (numeric, 6, 90 s): three-year net saving after the one-time
    cost and a seeded ramp (half the saving in year one).
  `values-integrity` (78 s): the manager says to call the saving "about
    $5M" on the title slide; the model says $4.3M (seed both).
  `values-candor` (78 s): the client's analyst points out a wrong figure in
    a table the candidate sent them yesterday.
  `values-client-care` (78 s): a friend at another firm asks which sites the
    client is closing.
  `values-in-lane` (78 s): the operations director asks the candidate
    directly whether the team will recommend layoffs.
  `values-teamwork` (78 s): the senior's analysis has an error and they
    present in thirty minutes.

VERIFY AND CITE
No statute here; cite the standard definitions used (weighted average,
payback) and state that the slide standards and confidentiality rule are
Corvid Lane policy.

FLAG FOR REVIEW
A calculator is assumed; note whether the rapid items stay fair without one.
Whether a corporate strategy-and-operations sibling should replace the
consulting frame for in-house buyers.
```

---

## Prompt 3 · HR / people operations coordinator

```text
SIMULATION `peopleops-fernhill-onboarding`, roleFamily `hr`,
title "Fernhill: people operations coordinator".

SETTING
The candidate is an HR coordinator at Fernhill Outdoor Co. (fictional, about
600 employees, one US state that follows the federal overtime rule; say so
on the card). A cohort of new hires started this week and payroll closes
tomorrow. Cast: the HR manager, a recruiter, a hiring manager who is in a
hurry, the payroll specialist, one new hire.

SEEDED CARDS
- Handbook excerpt: benefits start (first of the month after 30 days), PTO
  accrual per pay period, background check must clear before the start date,
  handbook acknowledgement due within a seeded number of days, who may see
  medical and leave information, how complaints are reported.
- Compliance card: employment eligibility form timing (section 1 by the
  first day of work, section 2 within three business days of the start),
  acceptable document combinations (one from List A, or one from List B plus
  one from List C), that the employer may not say which documents to bring;
  overtime at one and a half times over 40 hours in the workweek for
  non-exempt staff; family leave eligibility (12 months of service, 1,250
  hours, 50 employees within 75 miles). Put every figure on the card.
- Pay calendar: period dates, working days in the period, the company
  holidays.
Use the date helpers in scenarios/legal/dates.ts for business days; keep all
dates in 2026 to 2028.

STEPS
s-rapid-a  `rapid-dates` (10). Exhibit: a start date and the calendar strip.
  Easy kinds: section 2 due date, benefits start date, acknowledgement due
  date, PTO accrued after n periods. Hard kinds: a three-business-day count
  that crosses a federal holiday, a start on the last day of a month, family
  leave eligibility from seeded service and hours.
s-work-1   `onboarding-audit` (document_review, 20). Twelve new hires x start
  date, offer signed, section 1 date, section 2 date, documents presented,
  background check cleared, handbook acknowledgement. Six findings x 3:
  section 2 after the third business day; section 1 after the first day; two
  List B documents and no List C; started before the background check
  cleared; acknowledgement overdue; a note that the recruiter told the hire
  which documents to bring. Decision (2): report the list to the HR manager
  and correct forward with dated notes. Wrong: redate the forms, ask the
  hires to bring "the right" documents by name, do nothing because they have
  already started. Clean look-alikes: section 2 exactly on the third
  business day across a holiday, a single List A document, a check cleared
  on the start date. Mid-task (minute 4): the recruiter says one hire's
  start moved by a week.
s-rapid-b  `rapid-policy` (10). Exhibit: an employee card (status, hours,
  dates). Choice from the handbook and card: overtime due or not, who
  approves, which leave applies. Hard kinds: a week with a paid holiday that
  the card says does not count as hours worked; an exempt employee who
  worked 50 hours.
s-work-2   `pay-changes` (spreadsheet, 20). Eight employees with one change
  each. Inputs: gross pay for the period, 2.5 points each. Cases: a
  mid-period start (prorate by working days), a mid-period raise, overtime
  for a non-exempt employee, unpaid leave days, PTO payout on leaving,
  retroactive raise for one earlier period. Traps: holidays are working days
  for proration only if the pay calendar says so; overtime is over 40 in the
  week, not over 8 in a day; the raise takes effect on its effective date,
  not the approval date. Mid-task (minute 4): payroll corrects one effective
  date.
s-rapid-c  `rapid-screening` (10). Exhibit: a requisition's minimum
  qualifications and four candidate facts. Choice: meets, does not meet,
  need more information. Hard kinds: a tempting but irrelevant personal fact
  sits in the exhibit (age, family plans, a gap for medical leave); the
  right option never relies on it, and one wrong option does.
s-desk (720 s)
  `offer-check` (document_review, 12, 240 s): an offer letter against the
    approved requisition and pay band. Four findings x 2.5: salary differs
    from the approval, exempt status wrong for the role, start date before
    the check can clear, bonus percent not approved. Decision (2): hold the
    letter and return it to the recruiter.
  `hiring-metrics` (spreadsheet, 8, 150 s): from a small table enter
    turnover rate, average days to fill, offer acceptance rate, cost per
    hire (2 each).
  `values-client-care` (66 s): a manager asks why someone on their team is
    out for six weeks.
  `values-integrity` (66 s): the hiring manager asks to date a section 2
    form two days earlier.
  `values-candor` (66 s): the recruiter spots that an offer the candidate
    sent yesterday has the wrong salary.
  `values-in-lane` (66 s): an employee describes harassment and asks the
    candidate to keep it secret; the handbook says reports go to the HR
    manager.
  `values-quality` (66 s): the hiring manager wants a hire to start Monday
    though the background check hasn't cleared.

VERIFY AND CITE
Form I-9 timing, document lists and the rule against specifying documents
(USCIS employer handbook); overtime under the Fair Labor Standards Act;
family leave eligibility under the FMLA; confidentiality of employee medical
information under the ADA. State and local rules differ: the card says this
is a federal-rule state.

FLAG FOR REVIEW
US federal content only; needs legal review and a jurisdiction note before
use elsewhere. The screening round touches protected characteristics by
design: have the reviewer check its wording.
```

---

## Prompt 4 · Bank analyst programme: commercial credit

```text
SIMULATION `banking-stonebridge-renewal`, roleFamily `banking`,
title "Stonebridge Bank: credit analyst".

SETTING
The candidate is an analyst in the commercial banking programme at
Stonebridge Community Bank (fictional). Today: the annual renewal and a line
increase for an operating company (seed from a pool: HVAC contractor, food
manufacturer, regional distributor, dental group). Loan committee is Friday.
Cast: the relationship manager, the chief credit officer, the borrower's
controller, a loan operations specialist.

SEEDED CARDS
- Credit policy: minimum debt service coverage, maximum leverage, maximum
  loan-to-value by collateral, maximum age of financial statements and
  appraisals, borrowing base advance rates and ineligibles (receivables over
  90 days, concentration above a percent, affiliate accounts), the risk
  rating grid.
- Loan agreement excerpt: the covenants and test dates.
- Definitions the bank uses (EBITDA, cash available for debt service, debt
  service coverage, funded debt to EBITDA).
Statements must tie on every seed: assets = liabilities + equity, and net
income flows to equity.

STEPS
s-rapid-a  `rapid-ratios` (10). Exhibit: a statement snippet. Easy kinds:
  current ratio, debt to tangible net worth, days sales outstanding,
  loan-to-value, gross margin. Hard kinds: coverage including the current
  portion of long-term debt, leverage with an add-back, a ratio using
  average balances.
s-work-1   `spread` (spreadsheet, 20). Three years plus the interim period.
  Inputs per year: EBITDA, adjusted EBITDA, cash available for debt service,
  coverage ratio (12 cells, 1.25 each); pro forma coverage with the
  increase (3); leverage (2). Traps: a one-time gain inside other income;
  owner distributions; depreciation inside cost of goods sold; the new
  facility's debt service; an interim period annualised only where the
  policy says. Mid-task (minute 4): the controller sends a revised interim
  figure.
s-rapid-b  `rapid-covenants` (10). Exhibit: the covenant and the figures.
  Choice: in compliance, breach, not tested this period. Hard kinds: a
  covenant exactly at its threshold, a cure period, a ratio defined
  differently in the agreement than in the policy.
s-work-2   `package-review` (document_review, 20). The draft credit memo's
  checklist rows against the file. Six findings x 3: financials older than
  policy; appraisal older than policy; guarantor statement unsigned; a
  breach described as compliance; a prior lien on the equipment in the lien
  search; borrower's legal name differs from its organisational documents.
  Decision (2): return to the relationship manager with the list. Clean
  look-alikes: a covenant met with little room, a lien shown as released.
s-rapid-c  `rapid-base` (10). Exhibit: a short receivables aging. Enter or
  choose eligible receivables and availability. Hard kinds: a concentration
  cap, an affiliate account, a credit balance.
s-desk (720 s)
  `base-certificate` (spreadsheet, 10, 210 s): the borrower's certificate
    recomputed: eligible receivables, eligible inventory, availability,
    excess or shortfall against the outstanding balance (2.5 each).
  `risk-rating` (multiple_choice, 5, 75 s): rating from the grid.
  `lead-risk` (multiple_choice, 5, 75 s): the risk that goes first in the
    memo for this seed (the one the seeded figures make largest).
  `values-integrity` (72 s): the relationship manager asks to leave the
    covenant breach out "so it doesn't derail Friday".
  `values-candor` (72 s): loan operations finds an error in the spread the
    candidate already sent to the chief credit officer.
  `values-in-lane` (72 s): the controller asks whether the increase is
    approved so they can order equipment.
  `values-client-care` (72 s): another customer asks how the borrower is
    doing.
  `values-quality` (72 s): operations offers to book the renewal before the
    insurance certificate arrives.

VERIFY AND CITE
Standard ratio definitions (name the lending reference used); lien priority
under UCC Article 9; confidentiality of customer financial information under
the Gramm-Leach-Bliley Act. Thresholds and advance rates are bank policy.

FLAG FOR REVIEW
Whether global cash flow with the guarantor belongs here or in a senior
sibling; an operations-track sibling (payments exceptions, account
maintenance) for the same programme.
```

---

## Prompt 5 · Assistant buyer / merchandise planner

```text
SIMULATION `retail-wrenfield-trade`, roleFamily `retail`,
title "Wrenfield & Co.: assistant buyer".

SETTING
The candidate is an assistant buyer on a trainee scheme at Wrenfield & Co.
(fictional retailer; seed the department from a pool: homeware, outdoor
clothing, toys, small electricals, stationery). It is Monday: trade meeting
at 11, and the autumn range is on the water. Cast: the buyer, the
merchandiser, a supplier's account manager, the store operations lead.

SEEDED CARDS
- Trading rules: margin % = (selling price less cost) / selling price;
  sell-through % = units sold / (units sold + units on hand); weeks of cover
  = units on hand / average weekly units; the action thresholds (reorder
  below a cover, mark down below a sell-through after a number of weeks);
  open-to-buy = planned sales + planned markdowns + planned closing stock
  less opening stock less on order.
- Critical path for the range: launch date, latest delivery date to the
  distribution centre, carton sizes, the compliance test each product type
  needs before shipping.
- Supplier terms: agreed cost prices, payment terms, the gifts and
  hospitality policy.

STEPS
s-rapid-a  `rapid-retail-math` (10). Easy kinds: margin %, markup, selling
  price for a target margin, sell-through, weeks of cover. Hard kinds:
  margin after a promotional price with supplier funding, cover when weekly
  sales are trending (use the card's average rule), a markdown needed to
  reach a price point. Wrong options: markup given for margin, cover
  inverted, sell-through on received instead of the card's formula.
s-work-1   `trade-report` (spreadsheet, 20). Twelve lines x units received,
  sold, returned, on hand, weeks on sale, cost, price. Inputs: sell-through
  and weeks of cover for eight seeded lines (16 cells, 1 each), department
  margin % (2), department sell-through (2). Traps: returns go back to on
  hand; a line that launched mid-period has fewer weeks on sale; one line
  sold part of the period at a promotional price given in a note. Mid-task
  (minute 4): store operations sends a stock adjustment for one line.
s-rapid-b  `rapid-actions` (10). Exhibit: one line's cover, sell-through,
  weeks on sale and lead time. Choice from the thresholds: reorder, mark
  down, hold, cancel the open order. Hard kinds: lead time longer than
  cover, a line just inside a threshold, a best seller with an order already
  on the water.
s-work-2   `po-check` (document_review, 20). Twelve purchase orders against
  supplier confirmations. Six findings x 3: confirmed cost differs from the
  agreed cost; quantity differs; delivery after the latest date on the
  critical path; quantity not a multiple of the carton size; compliance test
  certificate missing for a product type that needs one; the same order
  raised twice. Decision (2): query the supplier in writing and tell the
  buyer which lines threaten launch. Clean look-alikes: delivery exactly on
  the latest date, a cost that differs only by currency rounding the terms
  allow.
s-rapid-c  `rapid-pricing` (10). Price ladders and promotions: new margin
  after a markdown, units needed at the lower price to keep cash margin,
  whether a three-for-two beats a percent off. Hard: funding split between
  retailer and supplier.
s-desk (720 s)
  `open-to-buy` (spreadsheet, 12, 240 s): three months; enter open-to-buy
    per month (3 each) and the quarter total (3).
  `critical-path` (ordering, 8, 150 s): eight steps from sample approval to
    on-shelf for the seeded product type (the compliance test sits before
    shipping). Pairwise 5, position 3.
  `values-integrity` (66 s): the supplier's account manager offers event
    tickets the week before the range review; the policy sets a gift limit.
  `values-candor` (66 s): the merchandiser finds a purchase order the
    candidate keyed with a zero too many.
  `values-client-care` (66 s): a supplier asks what a competing supplier
    quoted.
  `values-in-lane` (66 s): the supplier asks the candidate to agree a cost
    increase by phone "to keep production moving".
  `values-quality` (66 s): the buyer is travelling and the supplier wants to
    ship without the test certificate to make the launch.

VERIFY AND CITE
Standard retail maths definitions (name the reference); that consumer
products need the safety testing the card lists is scenario policy modelled
on real product safety rules: name the real rule for the seeded product type
where one exists and say what was simplified.

FLAG FOR REVIEW
Sales tax and VAT are left out; margins are on tax-exclusive prices. Whether
a merchandise-planner sibling (allocation, size curves) is the next build.
```

---

## Prompt 6 · Insurance claims representative trainee

```text
SIMULATION `claims-kestrel-auto-desk`, roleFamily `insurance`,
title "Kestrel Mutual: claims representative".

SETTING
The candidate is a claims representative in training at Kestrel Mutual
Insurance Company (fictional), on the personal auto desk with a small
pending list. Cast: the claims supervisor, a body shop estimator, a
policyholder, a claimant's lawyer who appears once, a fellow trainee.

SEEDED CARDS
- Policy excerpt and declarations format: policy period (starting 12:01 a.m.
  on the effective date), listed drivers and excluded drivers, listed
  vehicles, coverages bought with limits and deductibles, the newly acquired
  vehicle clause with its number of days, rental cover per day and maximum.
- Claims handling card: the trainee's payment authority, when a file goes to
  the supervisor (coverage questions, represented claimants, suspected
  fraud, total losses above a value), contact and acknowledgement deadlines
  in business days, the total-loss threshold as a percent of actual cash
  value, the approved labour rate, the parts policy.
Use the date helpers for business days; keep dates in 2026 to 2028.

STEPS
s-rapid-a  `rapid-coverage-math` (10). Easy kinds: payment after the
  deductible, payment capped at a limit, actual cash value = replacement
  cost less depreciation, rental owed for n days under the cap. Hard kinds:
  a loss above the limit with a deductible, total loss or repair from the
  threshold, two coverages on one loss.
s-work-1   `coverage-check` (document_review, 20). Twelve new claims x loss
  date and time, driver, vehicle, type of loss, policy period, coverages.
  Six findings x 3: loss outside the policy period; driver excluded on the
  policy; vehicle not on the policy and outside the newly acquired window;
  the coverage needed was not bought; policy lapsed and was reinstated after
  the loss; a claim already paid under another claim number. Decision (2):
  send the flagged files to the supervisor before any contact about payment.
  Wrong: deny them yourself, pay and sort it out later, ask the policyholder
  to change the loss date. Clean look-alikes: a loss at 12:30 a.m. on the
  effective date, a new vehicle inside the window, a permissive driver who
  isn't listed and isn't excluded. Mid-task (minute 4): the supervisor
  reports a reinstatement date for one policy.
s-rapid-b  `rapid-deadlines` (10). Exhibit: a claim's dates. Choice of the
  due date for acknowledgement, first contact or the status letter from the
  card. Hard kinds: counts that cross a holiday or start on a Friday.
s-work-2   `estimate-review` (spreadsheet, 20). A body shop estimate of ten
  lines. Inputs: the allowable amount for each line (10 x 1.5), the payable
  total after the deductible (3), the rental owed (2). Traps: labour above
  the approved rate; a part priced against the card's parts policy; a line
  for damage the photos note as prior; a duplicated line; rental days
  beyond the maximum. Mid-task (minute 4): the estimator sends a supplement
  that adds one legitimate line.
s-rapid-c  `rapid-statements` (10). Exhibit: two short statement excerpts
  and one file fact. Choice: consistent, inconsistent and refer to the
  supervisor, need one more fact (name it). The answer is evidence for a
  referral, never a denial. Hard kinds: times and places that conflict only
  after a unit or time-zone step.
s-desk (720 s)
  `total-loss` (spreadsheet, 8, 180 s): settlement from three comparable
    vehicles with mileage and condition adjustments on the card: adjusted
    value of each (1.5 each), the average (1.5), the payment after the
    deductible (2).
  `first-day` (ordering, 6, 120 s): six first-day actions on a new claim in
    the order the card requires (verify coverage before discussing payment).
    Pairwise 4, position 2.
  `authority` (multiple_choice, 6, 90 s): pay within authority, send to the
    supervisor, or ask for information, for a seeded payment.
  `values-integrity` (66 s): the body shop offers a referral fee and asks
    for two extra labour hours.
  `values-in-lane` (66 s): a letter arrives saying the claimant has a
    lawyer; the claimant then phones the candidate directly.
  `values-candor` (66 s): the fellow trainee notices the candidate quoted a
    policyholder the wrong deductible yesterday.
  `values-client-care` (66 s): a policyholder in distress asks "am I
    covered?" before coverage has been verified.
  `values-quality` (66 s): the supervisor's month-end push; a colleague
    suggests closing files without the required photos.

VERIFY AND CITE
Standard personal auto policy concepts (policy period, excluded driver,
newly acquired auto, actual cash value); that insurers deal with a
represented claimant through their lawyer; that deadlines come from state
unfair claims practices rules which vary, so they are on Kestrel's card.

FLAG FOR REVIEW
Comparative fault and injury claims are left for a senior sibling. State
rules vary widely: a practitioner should confirm the card reads like a
typical carrier's.
```

---

## Running the prompts

- Start in table order. One subagent per prompt on `feat/sim-<slug>`; subagents must not share helper files, so only the first simulation in a role family creates `scenarios/<roleFamily>/`.
- Every simulation lands as "draft: practitioner review pending" and is not published until someone who does the job has reviewed it, as with the accountant review pack.
- `pnpm scenarios:publish` has no draft gate (`10-progress.md`); don't run it while drafts are in code.
- For high-volume rounds, check completion rates in the first pilot: sections `s-rapid-a` and `s-work-1` (16 minutes, 30 points) are built to work as a shorter first-stage cut if 50 minutes proves too long for a pool of hundreds.
