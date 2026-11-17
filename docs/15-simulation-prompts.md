# 15 · Simulation authoring prompts for the next industries

Prompts for agents that build one simulation each, for the industries picked in `14-next-industries.md`. Give an agent the **shared brief** followed by **one industry prompt**. One agent, one simulation, one branch, one PR.

Every prompt follows the shape of the paralegal simulations already in code (`docs/paralegal/`): about 50 minutes, 100 points, timed sections, rapid rounds between the longer tasks, everything scored automatically.

| # | Prompt | Slug | Role family |
| --- | --- | --- | --- |
| 1 | Commercial insurance: associate underwriter | `underwriting-kestrel-submission` | `insurance` |
| 2 | Construction: project engineer | `construction-tamarack-mob` | `construction` |
| 3 | Wealth management: client service associate | `wealth-juniper-household` | `wealth` |
| 4 | Trade compliance: entry and classification analyst | `customs-fenwick-entry` | `trade` |
| 5 | Commercial banking: credit analyst | `credit-stonebridge-renewal` | `banking` |
| 6 | Financial crime: AML / KYC analyst | `aml-marlowe-alerts` | `compliance` |

---

## Shared brief (prepend to every industry prompt)

```text
You are building one job simulation for a hiring assessment platform. A candidate
gets an invite link and works through a timed, realistic slice of a day on the
job; the hiring company gets a scored report with evidence. Your job is the
scenario: story, materials, per-candidate variants, answer keys, tests and a
review doc. You are not changing the platform.

HOW TO WORK
- Don't ask before running commands, reading files or looking things up. Stay
  strictly on this task and read only what it needs. Finish through to an open
  PR and a short report. If something blocks you, say exactly what and stop.
- Commits: short, lowercase, one line, one per logical change. No AI or tool
  attribution anywhere: not in commits, the PR, comments or docs.
- Before creating files, list them and their directories.
- Never print .env.local or any key. Tests run only against the local setup;
  never point anything at the cloud database. Do not run `pnpm scenarios:publish`.

READ FIRST, IN THIS ORDER
1. CLAUDE.md, docs/00-overview.md, docs/06-assessment-engine.md (all of it:
   step types, scoring rules, sections, rapid rounds, leak tests).
2. One finished simulation end to end as your model:
   docs/paralegal/corporate-halyard-robotics.md,
   src/lib/engine/scenarios/corporate-halyard-robotics.ts,
   tests/engine/corporate-halyard-robotics.test.ts.
3. src/lib/engine/scenarios/legal/ for how shared helpers (dates, name pools)
   are organised, and docs/reviews/2026-11-accountant-review.md for what a
   reviewer needs from you.

HARD RULES
- Answer keys, scoring and the variant generator are server only. Nothing from
  a key may reach the candidate payload or the DOM. The existing leak tests
  must pass for your scenario.
- Use only the step types that exist: inbox_reply, spreadsheet, journal_entry,
  document_review, multiple_choice, numeric, ordering, rapid_round. If a task
  truly needs something else, do not special-case the attempt flow: describe
  the missing step type in your report and build the scenario without it.
- Score everything automatically. Use multiple_choice for inbox decisions
  instead of inbox_reply, so no attempt waits on a human reviewer.
- Nothing in the scenario rejects a candidate. It produces points and evidence.
- All companies, people, funds, carriers, banks and cases are fictional. Rules
  of law and industry practice you cite are real and public: name the source
  (statute, regulation, standard form, published guide) in the doc.
- Any rule that changes over time (rates, limits, thresholds, fee schedules)
  must be handed to the candidate inside the scenario as a document ("the
  rate sheet", "the limits card", "the underwriting guide") and seeded. The
  candidate applies the sheet; they are never scored on remembering this
  year's number, and the simulation never goes stale.

VARIANTS
- Everything the candidate could copy from someone else is seeded per attempt:
  names, firms, every number, every date, which document or row carries which
  trap, the order of rows and options, and where the right option sits.
- The generator returns { values, keys } from the same draws, so the key
  always ties to what the candidate sees.
- Every document with planted problems also has clean look-alikes on every
  seed: items that resemble a trap but are fine. False flags cost points.
- Another candidate's perfect answers, replayed on a different seed, should
  average under 40%.

SHAPE (unless the industry prompt says otherwise)
- 48 to 52 minutes, 100 points, six timed sections that add up to the limit.
- Three rapid rounds of 15 items x 20 seconds, 10 points each. Items 3, 6, 9,
  12 and 15 are the harder kinds worth 1 point, the other ten are worth half.
- Two long tasks (a spreadsheet and a document_review), 20 points each.
- A final "desk and inbox" section shown one screen at a time, about 30
  points: one or two shorter document checks and the judgment and values calls.

IMMERSION (this matters as much as correctness)
- It is one working day at one firm. Open with a message from a named
  supervisor that sets the stakes and a deadline inside the fiction ("the
  broker wants terms by 3"). Use a small recurring cast, three to five people,
  each with a recognisable voice: the terse boss, the friendly colleague who
  cuts corners, the client who pushes.
- Every task arrives as a message from one of them and reads like a real
  email or chat, not an exam question. No "Question 4". No "the candidate".
- Documents look like the real artefacts of the trade: the same fields, the
  same layout order, the same abbreviations a practitioner sees daily, with
  realistic noise (a line that is irrelevant, a note in the margin).
- The day has continuity. A fact from section 1 matters again in section 4. A
  message arrives mid-task that changes the work (a revised number, a voided
  item, a new instruction), using scheduled messages (arriveAtMinute).
- The engine does not branch. Anything that refers back to earlier work must
  be true whatever the candidate answered.
- Pressure is real but fair: the cast interrupts, the clock is visible, and
  the last section is rushed on purpose. Never hide information a real
  employee would have.

FAST-PACED SECTIONS (integrity by design)
- Alternate long tasks with rapid rounds so the candidate never has a long
  quiet stretch. Rapid items are server-timed, one at a time, 20 seconds.
- Every rapid item must need the exhibit on screen (seeded numbers, dates,
  names, a rule from this scenario's own guide). Nothing answerable from
  general knowledge alone, nothing a search or a pasted prompt could answer
  faster than a competent person reading the exhibit.
- Item order and option order are shuffled per seed. Each item has exactly one
  right option, and wrong options are the specific mistakes a weak candidate
  makes (list them in the doc).
- Use one-at-a-time screens with their own seconds in the final section.
- Calibrate so a competent practitioner finishes most items with a few seconds
  spare. Speed is evidence for the report, never a reason to reject.

VALUES SECTION (include unless the industry prompt says to skip)
- Part of the final section: four to six in-world judgment calls where the
  work pulls against doing the right thing. They are situations from this job,
  written as messages from the cast, not a personality questionnaire and never
  "which statement describes you".
- Each call is tagged with one value from this fixed library:
  integrity (won't alter records, backdate or hide a problem),
  candor (raises bad news early and plainly),
  ownership (finishes, follows up, admits own mistakes),
  client care (protects the client's interest and information),
  stays in lane (escalates what is above their authority instead of guessing),
  quality over speed (won't skip a control to hit a deadline),
  teamwork (handles a colleague's error without hiding it or humiliating them).
- Use at least four different values. Record the tag on each step (label or
  id prefix `values-`) so a company can see results per value later.
- Format: multiple_choice with four options, or `ordering` to rank responses
  from best to worst. The right answer must be defensible from a rule or duty
  you can cite, not from taste. Wrong options must be tempting: the helpful
  shortcut, the people-pleasing yes, the over-escalation that helps nobody.
- At least one call has the pressure coming from a superior or a client, and
  at least one involves the candidate's own earlier mistake.
- Keep it to about 10 of the 100 points, in its own clearly named steps.
  Whether values points should count in the total, and whether companies can
  choose their own values, are open product questions: list them under
  "Judgment calls for review", don't solve them.

TESTS FIRST
Write tests/engine/<slug>.test.ts before the scenario and commit it failing.
Across 200 seeds:
- solve every task from the rendered candidate material using the tests' own
  independent reading of the rules, and compare with the server key;
- a perfect attempt scores 100 and a blank one 0;
- each planted trap costs exactly its points (half for the right item with the
  wrong reason);
- every rapid item has exactly one right option;
- another seed's perfect answers average under 40;
- no key note or computed number appears in the candidate payload;
- sections validate against the time limit (validateSections).
Then build the scenario, register it in src/lib/engine/scenarios/index.ts and
src/app/dev/engine/scenarios.ts, and play it once in /dev/engine at several
minutes and seeds.

DELIVERABLES
- src/lib/engine/scenarios/<slug>.ts (and a shared helpers folder for the
  vertical, like scenarios/legal/, if two sims would reuse it).
- tests/engine/<slug>.test.ts.
- docs/<vertical>/<slug>.md in the format of
  docs/paralegal/corporate-halyard-robotics.md: status "draft: practitioner
  review pending", setup, what is seeded, sections and timing, every trap with
  its expected answer and the rule behind it, wrong options, scoring table,
  the values calls with their tags, and "Judgment calls for review".
- A row in docs/10-progress.md.
- `pnpm test:engine`, `pnpm test:components`, lint and typecheck pass.
- A PR from a feature branch. In your report: what you built, test results,
  every place you were unsure of the domain, and any step type you wished for.

DOMAIN ACCURACY
You are writing for practitioners who will spot a wrong term in seconds. Look
up each rule you rely on from a primary or standard source before you key it.
Where practice varies between firms, make it this firm's written policy inside
the scenario and say so in the doc. Where you could not verify something, say
so in "Judgment calls for review" instead of guessing.
```

---

## Prompt 1 · Commercial insurance: associate underwriter

```text
SIMULATION: `underwriting-kestrel-submission`, role family `insurance`.

ROLE AND SETTING
The candidate is an associate underwriter in their first year at Kestrel
Mutual Insurance Company (fictional), on the middle-market commercial desk.
Today's account: a new-business commercial package (property and general
liability) for a regional manufacturer or contractor (seed the insured from a
pool of fictional businesses with different operations). Cast: the senior
underwriter they report to, a retail broker who wants terms today, an
underwriting assistant, and the insured's CFO who appears once.

MATERIALS TO BUILD (all seeded)
- Kestrel's underwriting guide excerpt: appetite by class (in, out, refer),
  the associate's authority letter (maximum limit, maximum total insured
  value, classes excluded, maximum credit they may apply), required
  submission items, how recent a loss run must be (for example valued within
  60, 90 or 120 days), and the rate sheet.
- An application in the layout of the standard commercial application forms
  (named insured, entity type, operations description, locations, prior
  carrier, requested limits and effective date).
- Statement of values (locations, construction, occupancy, protection,
  building, contents and business income values).
- Five years of loss runs from the prior carrier.
- Broker emails.

SECTIONS
1. Rapid round A, rating math (6 min, 10 pts). From the rate sheet on screen:
   premium = exposure / basis x rate (per $100 of payroll, per $1,000 of
   sales, per $100 of property value); pro rata return premium for a mid-term
   cancellation; loss ratio = incurred / earned premium; applying a schedule
   credit or debit. Hard items: a coinsurance penalty (carried / required x
   loss, less the deductible), earned premium part-way through a term, and a
   blended rate over two classes.
2. Submission review (10 min, 20 pts, document_review). The application and
   statement of values side by side. Planted findings, one per row, placed by
   seed: total on the statement of values doesn't match the application;
   operations description doesn't fit the class code used; a prior
   non-renewal or cancellation shown on the loss run but answered "no" on the
   application; requested effective date already past; a class or operation
   the guide lists as out of appetite or refer; loss run older than the guide
   allows. Clean look-alikes: a location with a different address format, a
   total that only differs by rounding, an in-appetite class with a similar
   name. Decision: quote within authority, refer to the senior, ask the broker
   for information, or decline; exactly one is right for the seed.
3. Rapid round B, coverage and forms (6 min, 10 pts). Short fact patterns with
   a policy excerpt on screen: occurrence vs claims-made trigger, additional
   insured vs certificate holder, waiver of subrogation, actual cash value vs
   replacement cost, per-occurrence vs aggregate, business income waiting
   period. Hard items apply two concepts to seeded dates or amounts.
4. Loss run analysis (10 min, 20 pts, spreadsheet). Enter for each year:
   incurred (paid plus outstanding reserve, less recoveries), claim count,
   loss ratio; then the five-year loss ratio and the largest loss capped at
   the guide's large-loss cap. Traps: an open claim whose reserve must be
   included, a subrogation recovery that must be netted, a claim that appears
   in two policy years' runs, a claim outside the five-year window. At a
   seeded minute the broker sends an updated loss run that changes one claim.
5. Rapid round C, authority (6 min, 10 pts). "Can you bind this yourself?"
   Each item gives limit, total insured value, class and credit requested;
   answer from the authority letter: within authority, refer, or not
   permitted. Hard items sit exactly on a limit or combine two conditions.
6. Desk and inbox, one screen at a time (12 min, 30 pts).
   - Quote vs bind request (document_review, 12): the broker's bind order
     against the quote. Findings: limit differs from the quote, named insured
     differs, a subjectivity still open (signed application, inspection,
     updated loss run), effective date moved earlier. Decision.
   - Renewal pricing check (numeric or short spreadsheet, 8): the indicated
     change from the loss ratio and the guide's table.
   - Values calls (10): see below.

VALUES CALLS
- integrity: the broker asks to make coverage effective two days ago; a later
  message shows a loss happened yesterday. Right: no backdating; refer.
- stays in lane: an account just over the candidate's authority, the senior is
  in a meeting, the broker says a competitor will win it in an hour.
- candor: the candidate notices their own rating error on a quote that went
  out this morning (make this true on every seed by having the assistant
  point it out).
- quality over speed: the assistant offers to mark the inspection subjectivity
  as received "because it always comes in".
- client care: the insured's CFO emails directly asking what a competitor's
  loss history looks like "since you write them too".

RULES TO VERIFY AND CITE
Coinsurance formula and coverage definitions from standard commercial
property and general liability forms; pro rata vs short-rate cancellation;
that backdating coverage after a known loss is misrepresentation. Authority,
appetite, loss-run freshness and the large-loss cap are Kestrel policy, not
law: say so.

JUDGMENT CALLS TO FLAG
Whether experience rating belongs here or in a workers' compensation sibling;
whether the sibling sim should be the claims adjuster (coverage verification,
reserve setting, a statement that doesn't match the police report).
```

---

## Prompt 2 · Construction: project engineer

```text
SIMULATION: `construction-tamarack-mob`, role family `construction`.

ROLE AND SETTING
The candidate is a project engineer at Tamarack Builders (fictional general
contractor) on a four-storey medical office building, mid-construction. Cast:
the project manager, the superintendent in the field, the architect's project
representative, and two subcontractor project managers (seed trades from
drywall, mechanical, electrical, doors and hardware, roofing).

MATERIALS TO BUILD (all seeded)
- Contract excerpt: order of precedence of documents, notice period for
  claims in days, allowed markup on changes (for example 10% on a
  subcontractor's own work, 5% on lower-tier work, nothing on markup),
  retainage percent, labour rate sheet, what a pay application must include.
- Spec section excerpts with the requirements that matter (ratings,
  gauges, required submittal items).
- Submittal log, RFI log, a subcontractor change order request, a
  subcontractor pay application with schedule of values, the
  superintendent's percent-complete walk, a two-week look-ahead schedule.

SECTIONS
1. Rapid round A, quantities (6 min, 10 pts). Dimensions on screen: concrete
   in cubic yards (cubic feet / 27), area and wall quantities with openings
   deducted, adding a waste factor, extending a unit price, markup vs margin.
   Hard items: a stepped footing, a quantity that needs a unit conversion, a
   takeoff where one dimension is in inches.
2. Submittal review (10 min, 20 pts, document_review). Submittal log rows
   against the spec excerpts. Findings: product rating below the spec (a
   60-minute door where 90 is required, a lighter gauge); a required item
   missing (shop drawings, sample, warranty); a substitution with no
   substitution request; lead time that lands after the look-ahead's
   needed-on-site date; submittal prepared against a superseded spec
   revision. Clean look-alikes: a product that exceeds the spec, a lead time
   that lands exactly on the date. Decision: return to the subcontractor,
   forward to the architect, or flag the schedule risk to the PM. Approving
   it yourself is a wrong option: design approval is the architect's.
3. Rapid round B, documents and money terms (6 min, 10 pts). With the contract
   excerpt on screen: RFI vs submittal vs change order vs construction change
   directive; which document governs under the order of precedence;
   conditional vs unconditional lien waiver; float on a small schedule
   fragment. Hard items compute a notice deadline from an event date or total
   float through three activities.
4. Change order pricing (10 min, 20 pts, spreadsheet). Enter the allowable
   amount per line and the total for a subcontractor's change request. Traps:
   labour billed above the contract rate sheet; markup applied on markup;
   arithmetic error in an extension; no credit taken for the work deleted by
   the same change; a tool or small-equipment charge the contract says is
   covered by overhead. At a seeded minute the superintendent messages that
   two of the claimed labour hours were on another task.
5. Rapid round C, pay applications and schedule (6 min, 10 pts). Earned value
   on a schedule-of-values line, retainage held, stored materials, percent
   billed vs percent walked, days of delay. Hard items combine a prior
   payment, retainage and a stored-material line.
6. Desk and inbox, one screen at a time (12 min, 30 pts).
   - Pay application review (document_review, 12): overbilling against the
     superintendent's walk, an unapproved change order billed, retainage
     miscalculated, lien waiver for the prior payment missing. Decision.
   - RFI process (ordering, 8): put the steps from a field conflict to a
     priced change in order (seed which conflict).
   - Values calls (10).

VALUES CALLS
- quality over speed: the superintendent wants to pour before the rebar
  inspection is signed off because the pump truck is on site.
- integrity: a subcontractor asks the candidate to sign time-and-material
  tickets for days the candidate was not on site.
- stays in lane: the owner's representative asks on site for an extra and
  says "just have them do it"; no written directive exists.
- candor: the candidate's own submittal-log error means a long-lead item was
  released late; the PM hasn't noticed.
- teamwork: a colleague's takeoff the candidate is checking is short, and the
  bid goes out today.

RULES TO VERIFY AND CITE
Roles of architect and contractor in submittal review and the change
directive process as described in the widely used standard general
conditions; lien waiver types; critical path float. Markup caps, notice
periods and retainage are this contract's terms: seed them and say so.

JUDGMENT CALLS TO FLAG
Drawings: the engine shows tables and text, not plan sheets, so takeoffs use
described dimensions; say what a drawing viewer step type would add. Sibling
sim: estimator on bid day (scope gaps between sub bids, levelling, a late
quote).
```

---

## Prompt 3 · Wealth management: client service associate / paraplanner

```text
SIMULATION: `wealth-juniper-household`, role family `wealth`.

ROLE AND SETTING
The candidate is a client service associate (with paraplanning duties) at
Juniper Row Wealth Partners (fictional registered investment adviser). Today:
onboarding a new household that is moving accounts over, a required minimum
distribution season task list, and prep for an afternoon review meeting.
Cast: the lead advisor, the operations manager, a client couple, and the
clients' adult child who appears once.

MATERIALS TO BUILD (all seeded)
- The firm's operations manual excerpt: money-movement policy (call the client
  back on the number on file before any wire or any change of bank
  instructions, never the number in the email), who may receive account
  information, trade error policy, paperwork checklist per account type.
- A "limits and tables card" for the year: contribution limits, the required
  minimum distribution starting age and the distribution-period table excerpt
  the candidate needs, the firm's fee schedule. Seed the limits so the
  candidate applies the card, not memory.
- New account forms and transfer forms for four accounts (joint, traditional
  IRA, Roth IRA, revocable trust), a trust certification, custodial position
  and tax-lot reports, a target allocation, a draft client review report.

SECTIONS
1. Rapid round A, account math (6 min, 10 pts). Required minimum distribution
   = prior year-end balance / divisor from the card; holding period (long-term
   means more than one year); gain or loss on a lot; advisory fee for a
   quarter from the schedule. Hard items: first-year distribution with a
   seeded birthday near the cutoff, a wash sale (repurchase within 30 days
   either side of a loss sale), a tiered fee.
2. Account paperwork review (10 min, 20 pts, document_review). Findings: trust
   account titled differently from the trust certification; joint account
   missing one owner's signature; beneficiary percentages that don't total
   100; a transfer form moving an IRA into a taxable account; a signature
   dated beyond the custodian's freshness window from the manual; tax ID on
   the form doesn't match the statement. Clean look-alikes: a middle initial
   present on one form only where the manual allows it, contingent
   beneficiaries that total 100 separately. Decision: submit, return to the
   client for correction, or ask the advisor.
3. Rapid round B, account types and rules (6 min, 10 pts). Short client facts
   with the card on screen: which account type, who can contribute, what a
   rollover is vs a transfer, the 60-day rollover window, beneficiary vs
   will. Hard items compute a deadline or an excess contribution.
4. Rebalance and cash raise (10 min, 20 pts, spreadsheet). Current positions,
   target allocation, and a seeded cash need. Enter the dollar trade per
   holding and the realised gain from the lots sold. Traps: the cash need
   must come out before computing targets; a lot bought under 30 days ago at
   a loss elsewhere (wash sale if repurchased); selling the high-basis lot is
   specified by the advisor's note; one holding is restricted (do not trade).
   Mid-task the advisor changes the cash need.
5. Rapid round C, money movement (6 min, 10 pts). Each item is a request
   (wire, journal, address change, new bank link) with who asked and how.
   Answer from the manual: process, call back first, needs another signature,
   or refuse. Hard items: a request from the right person through the wrong
   channel, or a third-party payee.
6. Desk and inbox, one screen at a time (12 min, 30 pts).
   - Review report check (document_review, 12): the draft meeting report
     against the custodial data: performance figure doesn't match, wrong fee
     tier, last year's distribution amount carried forward, a closed account
     still listed.
   - Distribution list (numeric or short spreadsheet, 8).
   - Values calls (10).

VALUES CALLS
- quality over speed: an email "from the client", urgent, boarding a flight,
  asks for a wire to a new third-party account. Right: call back on the
  number on file before anything else.
- client care: the clients' adult child calls asking for a parent's balance
  "to help with their taxes"; no authorisation is on file.
- integrity: the advisor asks to date a contribution form in the prior year
  after the deadline on the card has passed.
- candor: the candidate placed a trade in the wrong account this morning (the
  operations manager's message makes this true on every seed).
- stays in lane: a client asks on the phone whether they should sell a fund;
  the candidate is not the advisor.

RULES TO VERIFY AND CITE
Required minimum distribution mechanics, the 60-day rollover and wash sale
rules from IRS publications; privacy of client information under the SEC's
privacy rule for advisers; that verification call-backs are standard
custodian and firm policy against wire fraud. Limits and ages change by law:
they live on the seeded card.

JUDGMENT CALLS TO FLAG
How much tax content a service associate should be scored on versus a
paraplanner; whether to split into two sims by seniority.
```

---

## Prompt 4 · Trade compliance: entry and classification analyst

```text
SIMULATION: `customs-fenwick-entry`, role family `trade`.

ROLE AND SETTING
The candidate is an import entry analyst at Fenwick & Shore Customs Brokers
(fictional), working under a licensed customs broker. Today: clear two
shipments for an importer of consumer and industrial goods (seed the product
family from a pool: hand tools, kitchenware, luggage, light fixtures,
bicycle parts). Cast: the licensed broker, the importer's logistics manager,
the overseas supplier's export clerk, a colleague on the next desk.

MATERIALS TO BUILD (all seeded)
- A "tariff schedule excerpt for this exercise": eight to twelve fictional
  heading and subheading lines written like real ones, with seeded duty rates,
  plus the text of the General Rules of Interpretation in short form. Real
  rule logic, fictional rates and numbers, so nothing goes stale when tariffs
  change. State this at the top of the excerpt.
- The firm's fee and rule card: merchandise processing fee rate with its
  minimum and maximum, harbor maintenance fee rate and that it applies to
  ocean shipments only, any additional duty that applies to a seeded origin,
  deadlines the firm works to.
- Commercial invoice, packing list, bill of lading or air waybill, the
  importer's product sheet, a draft entry summary prepared by a colleague.

SECTIONS
1. Rapid round A, duty math (6 min, 10 pts). Entered value and duty from an
   invoice line and the excerpt; fees from the card. Hard items: invoice
   terms that include international freight and insurance which must come
   out; a fee that hits its minimum or maximum; an air shipment where the
   harbor fee does not apply.
2. Entry packet check (10 min, 20 pts, document_review). The draft entry
   summary against invoice, packing list and transport document. Findings:
   quantity on the entry differs from the packing list; invoice in a foreign
   currency entered without conversion; country of origin on the entry
   differs from the invoice and marking; importer number doesn't match the
   power of attorney; value omits an assist (tooling the importer supplied
   free to the factory, mentioned in the product sheet); freight not deducted
   under the invoice terms. Clean look-alikes: gross vs net weight difference,
   a carton count that differs from unit count correctly. Decision: file,
   correct and file, or hold for the licensed broker.
3. Rapid round B, classification (6 min, 10 pts). A product description and
   three or four candidate lines from the excerpt; pick the line. Easy items
   turn on the heading text (rule 1). Hard items: a retail set classified by
   essential character, an unassembled article, a part vs an accessory, a
   fitted case entered with its article.
4. Valuation worksheet (10 min, 20 pts, spreadsheet). Build the transaction
   value for the second shipment: price paid, plus selling commission, plus
   the assist apportioned over the production run, plus royalty paid as a
   condition of sale, plus packing; less international freight and insurance
   where separately stated; exclude a buying commission and post-import
   delivery. Then duty and fees. Mid-task the supplier sends a corrected
   invoice.
5. Rapid round C, deadlines and duties of the broker (6 min, 10 pts). Using
   the shared date helpers and the card: entry summary due date counted in
   working days from release, record retention period, protest window from
   liquidation, importer security filing timing for ocean cargo. Hard items
   cross a federal holiday.
6. Desk and inbox, one screen at a time (12 min, 30 pts).
   - Second packet spot check (document_review, 12) with different traps.
   - Entry lifecycle (ordering, 8): from arrival notice to liquidation.
   - Values calls (10).

VALUES CALLS
- integrity: the importer asks to use a lower-duty line "like our last broker
  did"; the product sheet clearly fits the higher one.
- stays in lane: the candidate finds the same misclassification on last
  year's entries. Right: take it to the licensed broker (a prior disclosure
  decision is the broker's and the importer's), not fix quietly or ignore.
- client care: a competitor importer's employee asks what volumes the client
  brings in.
- candor: the candidate's own draft entry went out with the wrong value and
  has already been released.
- quality over speed: a colleague suggests filing now and "fixing it on a
  post-summary correction" to make the cutoff.

RULES TO VERIFY AND CITE
The General Rules of Interpretation; transaction value additions and
exclusions under the customs valuation statute (19 U.S.C. 1401a); broker
responsibilities and recordkeeping under 19 CFR Part 111 and Part 163; the
current statutory deadlines used in round C. Verify each deadline against
the regulation before keying it. All rates and fee amounts are on the seeded
card.

JUDGMENT CALLS TO FLAG
The fictional schedule excerpt (realism vs staleness); whether additional
duties by origin should appear at all given how often they changed in 2026.
```

---

## Prompt 5 · Commercial banking: credit analyst

```text
SIMULATION: `credit-stonebridge-renewal`, role family `banking`.

ROLE AND SETTING
The candidate is a commercial credit analyst at Stonebridge Community Bank
(fictional). Today: underwrite the annual renewal and a line increase for an
operating company (seed from a pool: HVAC contractor, craft food
manufacturer, regional distributor, dental group). Cast: the relationship
manager who wants it at Friday's loan committee, the chief credit officer,
the borrower's controller, a loan operations specialist.

MATERIALS TO BUILD (all seeded)
- Credit policy excerpt: minimum debt service coverage, maximum leverage,
  maximum loan-to-value by collateral type, how old financial statements and
  appraisals may be, borrowing base advance rates and ineligibles (receivables
  over 90 days, concentration over a percent, affiliate and foreign accounts),
  the risk rating grid.
- Three years of income statements and balance sheets, the interim period, an
  accounts receivable aging, the existing loan agreement's covenants, the
  guarantor's personal financial statement, a lien search summary, the draft
  credit memo.
- Reuse the accounting helpers where they fit; keep statements tying on every
  seed (assets = liabilities + equity, net income flows to equity).

SECTIONS
1. Rapid round A, ratio flash (6 min, 10 pts). From a statement snippet:
   current ratio, debt to tangible net worth, days sales outstanding,
   loan-to-value. Hard items: debt service coverage with the current portion
   of long-term debt, funded debt to EBITDA with an add-back, a ratio that
   needs average balances.
2. Financial spreading (10 min, 20 pts, spreadsheet). Enter EBITDA for each
   year, adjusted EBITDA, cash available for debt service, total debt
   service, coverage ratio, leverage. Traps: a one-time gain on an asset sale
   inside other income; owner distributions that reduce cash available; a
   depreciation figure buried in cost of goods sold; new debt service from
   the requested increase; an interim period that must be annualised only
   where the policy says so. Mid-task the controller sends a revised interim
   statement.
3. Rapid round B, structure and covenants (6 min, 10 pts). With the loan
   agreement on screen: is this covenant met, which covenant is tested when,
   what a cross-default does, secured vs guaranteed, first vs second lien.
   Hard items test a covenant exactly at its threshold or with a seeded cure
   period.
4. Loan package review (10 min, 20 pts, document_review). The draft credit
   memo against the file. Findings: financial statements older than policy
   allows; appraisal older than policy; guarantor's statement unsigned; a
   covenant breach the memo calls "in compliance"; the lien search shows a
   prior lien on the equipment; borrower's legal name in the memo differs
   from the organisational documents. Clean look-alikes: a covenant met with
   little room, a released lien. Decision: send to committee, return to the
   relationship manager, or send with a documented policy exception.
5. Rapid round C, borrowing base (6 min, 10 pts). Eligible receivables and
   availability from a small aging and the policy. Hard items apply a
   concentration cap or exclude an affiliate account.
6. Desk and inbox, one screen at a time (12 min, 30 pts).
   - Borrowing base certificate check (short spreadsheet, 10).
   - Risk rating (multiple_choice, 10 in two or three steps): rating from the
     grid and the single biggest risk to put first in the memo.
   - Values calls (10).

VALUES CALLS
- integrity: the relationship manager asks to leave the covenant breach out
  of the memo "so it doesn't derail Friday".
- candor: the candidate's own spread, already sent to the chief credit
  officer, has an error that flatters coverage.
- stays in lane: the borrower's controller asks whether the increase is
  approved so they can order equipment.
- client care: another customer's owner, friendly with the borrower, asks how
  the borrower is doing.
- quality over speed: loan operations offers to book the renewal before the
  insurance certificate arrives.

RULES TO VERIFY AND CITE
Standard definitions of the ratios (cite the commercial lending reference
you used); lien priority basics under UCC Article 9; that customer financial
information is confidential under federal privacy law. Thresholds, ages and
advance rates are Stonebridge policy: seed them and say so.

JUDGMENT CALLS TO FLAG
Global cash flow with the guarantor (include or leave for a senior-analyst
sim); tax-return-based spreading as a sibling sim for small-business lending.
```

---

## Prompt 6 · Financial crime: AML / KYC analyst

```text
SIMULATION: `aml-marlowe-alerts`, role family `compliance`.

ROLE AND SETTING
The candidate is a financial crime analyst at Marlowe Federal Bank
(fictional), splitting the day between the onboarding review queue and
transaction monitoring alerts. Cast: the team lead, the bank's BSA officer, a
relationship manager who wants a customer onboarded, a fellow analyst.

MATERIALS TO BUILD (all seeded)
- The bank's procedures excerpt: customer identification elements required,
  the ownership threshold for identifying beneficial owners and the
  requirement for one control person, when enhanced due diligence applies,
  the alert disposition options (close with rationale, escalate to
  investigation, request information), internal deadlines, and the hard rule
  that nobody outside the financial crime team is told about an alert or a
  suspicious activity report.
- A regulatory card with the reporting thresholds and filing deadlines the
  bank works to. Seed nothing that is fixed by regulation; do put the
  regulation's figures on the card so the candidate applies them from the
  page.
- An onboarding file for a limited liability company with a two-layer
  ownership chart, identity documents, expected activity profile; 90 days of
  account transactions for two alert subjects; sanctions screening hits.

SECTIONS
1. Rapid round A, cash reporting calls (6 min, 10 pts). A day's cash
   transactions for a customer: is a currency transaction report required
   (multiple transactions aggregate), by when, and does the pattern suggest
   structuring. Hard items: deposits across two branches, a mix of cash and
   non-cash, a deadline that crosses a weekend.
2. Onboarding file review (10 min, 20 pts, document_review). Findings: an
   indirect owner whose share through the holding company reaches the
   threshold but is not listed; no control person named; an expired identity
   document; a business address that is a registered agent or mail drop where
   procedures require a physical address; stated activity doesn't fit the
   industry code; expected monthly volume inconsistent with the stated
   revenue. Clean look-alikes: an owner just under the threshold, a document
   that expires next month. Decision: approve, return for information, or
   refer for enhanced due diligence.
3. Rapid round B, sanctions screening (6 min, 10 pts). A hit with the
   customer's details beside the list entry (name, date of birth, country,
   identifiers). True match, false positive, or needs more information. Hard
   items: transliterated names, a matching name with a different birth year,
   an entity owned by a listed party.
4. Transaction review (10 min, 20 pts, spreadsheet). For alert subject one,
   enter: total cash in, count of deposits just under the reporting
   threshold, share of incoming funds sent out within two days, largest
   counterparty share, variance from the expected profile. Traps: a reversed
   transaction, an internal transfer between the customer's own accounts,
   the review period's boundary dates. Mid-task the team lead adds a linked
   account.
5. Rapid round C, typologies (6 min, 10 pts). A three-line fact pattern; pick
   the red flag it shows or "no red flag": structuring, funnel account, rapid
   movement, trade mispricing, elder exploitation. Include clean patterns.
6. Desk and inbox, one screen at a time (12 min, 30 pts).
   - Disposition for alert two (multiple_choice plus a rationale choice, 10):
     the answer and the reason that supports it.
   - Narrative order (ordering, 10): arrange the facts of the escalation in
     the order a suspicious activity narrative needs (who, what, when, where,
     why, how).
   - Values calls (10).

VALUES CALLS
- integrity: the relationship manager asks why their customer's wire is held
  and whether "compliance has a problem with them". Right: no tipping off;
  refer them to the team lead's standard response.
- quality over speed: the team lead mentions the backlog target and a
  colleague shows how they close alerts with a pasted rationale.
- stays in lane: the candidate thinks an account should be closed; that is
  the BSA officer's decision.
- candor: the candidate closed an alert last week on the first subject's
  linked account (the team lead's message makes this true on every seed).
- teamwork: the candidate finds a colleague's closed alert that clearly
  needed escalation.

RULES TO VERIFY AND CITE
Currency transaction report threshold, aggregation and filing deadline;
suspicious activity report thresholds, deadlines and the confidentiality
rule; customer identification program elements; the beneficial ownership
rule for bank customers. These are in the Bank Secrecy Act regulations (31
CFR Chapter X). Check the current status of the beneficial ownership
requirement before relying on it, and whatever you find, express it as the
bank's procedure in the scenario.

JUDGMENT CALLS TO FLAG
Whether a written rationale (inbox_reply, human review) is worth breaking
the "all automatic" rule for this role, since writing is the job; sibling
sims for fraud operations and sanctions specialists.
```

---

## Running the prompts

- One agent per prompt, each on its own branch (`feat/sim-<slug>`). Two agents must not share helper files: only the first simulation in a vertical creates `scenarios/<vertical>/`.
- Every simulation lands as "draft: practitioner review pending". Nothing is published until a practitioner in that field has reviewed it, as with the accountant review pack.
- `pnpm scenarios:publish` still has no draft gate (`10-progress.md`); don't run it while drafts are in code.
