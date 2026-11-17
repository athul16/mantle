# 14 · Paralegal simulations

The second vertical after accounting: six job simulations for paralegals and legal assistants, one per practice area. Each is a 50-minute timed workday in a fictional matter, scored automatically against a per-seed key. Detailed scenario docs live in `paralegal/`; the team's self-review checklist is `reviews/2026-11-paralegal-review.md`.

**Status: draft, team self-review pending, not published.** All six simulations are merged. None has been published (`pnpm scenarios:publish` not run), so no company can use them yet.

## Market

| | |
| --- | --- |
| Jobs (BLS, paralegals and legal assistants, 2025) | About 404,900 |
| Openings | About 40,800 a year, mostly replacing people who leave or change jobs |
| Growth | Flat over the decade |
| Median pay | $62,890 |
| Typical entry education | Associate degree (many hold a bachelor's or a paralegal certificate) |

High turnover on a large, flat base means steady hiring volume, and the work is concrete enough to simulate: calendar a deadline, review a privilege log, check a cap table, build a settlement statement.

**Buyers.**

- **Legal staffing agencies**, which place contract and temp-to-hire paralegals and need to vouch for candidates they haven't worked with.
- **eDiscovery and document review providers (ALSPs)**, which hire reviewers in batches for each project and need a fast first-pass screen.
- **Mid and large law firms**, hiring paralegals by practice group.
- **Corporate legal departments**, hiring corporate and contracts paralegals.
- **Paralegal programs**, as a capstone or placement-readiness check.

**Competitors.** EmployTest, eSkill, Criteria, Canditech and similar vendors mostly sell multiple-choice knowledge and aptitude tests for legal roles. None offers a realistic, proctored work sample in which the candidate does the job: finds the privileged email in a production, catches the overruled case, spots the unsigned consent. That gap is the product.

**The pitch: catch the AI-hallucinated citation.** Briefs drafted with AI tools now arrive with plausible cases that don't exist. The litigation cite-check plants one: a case with a real-looking name, court and holding that isn't in the research file. The right answer is "can't be verified, hold the filing", not "looks fine". It is a 20-second demo of the judgment firms are worried about, and a multiple-choice test can't show it.

## Common shape

Every paralegal simulation follows the same pattern (see `06-assessment-engine.md` for timed sections and rapid rounds):

- About 50 minutes, exactly 100 points, six timed sections.
- Three rapid rounds of 15 items × 20 seconds (date answers are a choice of four). In most of them items 3, 6, 9, 12 and 15 are the harder kinds.
- Three longer tasks built from existing step types, the last one followed by inbox questions from a partner, client or counterparty.
- Inbox questions are multiple choice, not written replies, so the whole simulation scores automatically with no reviewer step.
- Everything is generated per seed: people, firms, numbers, dates, which row carries which trap, and where the right option sits.
- Tests over 200 seeds solve every task from the rendered material and compare with the server key; a perfect attempt scores 100, a blank 0, each trap costs exactly its points, and no key value reaches the candidate's DOM.

## The simulations

| Simulation | Slug | Minutes | Points | Status | Doc |
| --- | --- | --- | --- | --- | --- |
| Litigation: Morrow v. Tidewater Freight | `litigation-morrow-tidewater` | 52 | 100 | Merged, draft | `paralegal/litigation-morrow-tidewater.md` |
| eDiscovery: Project Larch review batch | `ediscovery-larch-review` | 50 | 100 | Merged, draft | `paralegal/ediscovery-larch-review.md` |
| Corporate: Halyard Robotics Series A | `corporate-halyard-robotics` | 50 | 100 | Merged, draft | `paralegal/corporate-halyard-robotics.md` |
| Real estate: closing on 418 Alder Lane | `realestate-alder-closing` | 50 | 100 | Merged, draft | `paralegal/realestate-alder-closing.md` |
| Personal injury: Diaz, intake to demand | `pi-diaz-demand` | 50 | 100 | Merged, draft | `paralegal/pi-diaz-demand.md` |
| Immigration: H-1B petition packet | `immigration-h1b-packet` | 50 | 100 | Merged, draft | `paralegal/immigration-h1b-packet.md` |

### 1. Litigation: Morrow v. Tidewater Freight

**Setup.** Litigation paralegal at a plaintiff's firm on a cargo-damage case in the fictional U.S. District Court for the District of Wexford (appeals to the fictional Fourteenth Circuit). Deadlines use the real FRCP and federal holiday calendar; local rules and reporters are invented.

| # | Section | Minutes | Step types | Points |
| --- | --- | --- | --- | --- |
| 1 | Rapid round: deadlines (FRCP 6(a), 6(d) mail days, weekend and holiday rolls) | 6 | `rapid_round` | 10 |
| 2 | Privilege review of a 15-document production index | 11 | `document_review` | 20 |
| 3 | Rapid round: citation format against the firm's own guide | 6 | `rapid_round` | 10 |
| 4 | Cite-check of an AI-assisted brief's table of authorities | 11 | `document_review` | 20 |
| 5 | Rapid round: procedure | 6 | `rapid_round` | 10 |
| 6 | Exhibit list vs. binder, then inbox (e-filing by 5 pm, opposing paralegal, client asking for advice) | 12 | `document_review`, `multiple_choice` | 15 + 7 + 4 + 4 |

Doc: `paralegal/litigation-morrow-tidewater.md`.

### 2. eDiscovery: Project Larch review batch

**Setup.** Contract document reviewer at a firm defending a resin-supply dispute. The review protocol (period, issue tags, Larchmont's lawyers, custodians, foreign-language queue) arrives as the first inbox message and stays open; every answer follows from it.

| # | Section | Minutes | Step types | Points |
| --- | --- | --- | --- | --- |
| 1 | Protocol and QC review of a teammate's first-pass coding (20 rows) | 14 | `document_review` | 18 |
| 2 | Coding round 1 (responsive, privileged, issue tag) | 6 | `rapid_round` | 15 |
| 3 | Search string, review estimate, privilege log | 10 | `multiple_choice`, `spreadsheet`, `document_review` | 4 + 4 + 15 |
| 4 | Coding round 2 | 6 | `rapid_round` | 15 |
| 5 | Review inbox: hot document, foreign-language document, partial privilege | 8 | `multiple_choice` | 5 + 4 + 5 |
| 6 | Coding round 3 | 6 | `rapid_round` | 15 |

Doc: `paralegal/ediscovery-larch-review.md`.

### 3. Corporate: Halyard Robotics Series A

**Setup.** Corporate paralegal on a fictional Delaware startup closing its Series A. Filing rules (Rule 503, IRC §83(b), §16(a), Form 8-K, Rule 13d-1) and DGCL sections are real; the bylaws, charter, plan and NDA playbook are invented.

| # | Section | Minutes | Step types | Points |
| --- | --- | --- | --- | --- |
| 1 | Rapid round: ownership percentages and filing deadlines | 6 | `rapid_round` | 10 |
| 2 | Cap table after five transactions (round, pool top-up, grant, exercise, transfer) | 10 | `spreadsheet` | 20 |
| 3 | Rapid round: governance terms | 6 | `rapid_round` | 10 |
| 4 | Board actions vs. the bylaws and charter (9 actions) | 10 | `document_review` | 20 |
| 5 | Rapid round: contract terms | 6 | `rapid_round` | 10 |
| 6 | NDA vs. playbook, closing checklist, inbox (CEO asks to backdate, acquirer wants the cap table) | 12 | `document_review`, `multiple_choice` | 12 + 10 + 4 + 4 |

Doc: `paralegal/corporate-halyard-robotics.md`.

### 4. Real estate: closing on 418 Alder Lane

**Setup.** Paralegal at the settlement attorney's office on the sale of a duplex in the fictional State of Wexford, with a tenant and security deposit. The proration convention (who owns the closing day varies per seed) is stated on every item.

| # | Section | Minutes | Step types | Points |
| --- | --- | --- | --- | --- |
| 1 | Rapid round: prorations | 6 | `rapid_round` | 10 |
| 2 | Settlement statement (four columns per line, cash to close) | 11 | `spreadsheet` | 20 |
| 3 | Rapid round: title terms | 6 | `rapid_round` | 10 |
| 4 | Title commitment (12 items) | 11 | `document_review` | 20 |
| 5 | Rapid round: deed and recording checks | 6 | `rapid_round` | 10 |
| 6 | Deed review, inbox (lender changes the loan, buyer wants to move the closing) | 10 | `document_review`, `multiple_choice` | 15 + 8 + 7 |

Doc: `paralegal/realestate-alder-closing.md`.

### 5. Personal injury: Diaz, intake to demand

**Setup.** PI paralegal at a plaintiff's firm on a car-crash file in the fictional State of Calloway, whose limitations and collateral source rules are invented and stated. Bills use plain descriptions; no real billing code sets.

| # | Section | Minutes | Step types | Points |
| --- | --- | --- | --- | --- |
| 1 | Rapid round: limitations and damages | 6 | `rapid_round` | 10 |
| 2 | Medical chronology and treatment gaps | 10 | `ordering`, `document_review` | 10 + 10 |
| 3 | Rapid round: medical billing | 6 | `rapid_round` | 10 |
| 4 | Medical specials (ten invoices, liens, out of pocket) | 11 | `spreadsheet` | 20 |
| 5 | Rapid round: intake and ethics | 6 | `rapid_round` | 10 |
| 6 | Demand letter review, inbox (insurer is a firm client, client asks what the case is worth) | 11 | `document_review`, `multiple_choice` | 18 + 6 + 6 |

Doc: `paralegal/pi-diaz-demand.md`.

### 6. Immigration: H-1B petition packet

**Setup.** Immigration paralegal at a law firm working an H-1B extension of stay for a worker at a fictional employer. The agency and forms are fictional but modelled on the real process (Form P-129 petition, WA-9035 wage attestation, A-28 attorney appearance, AR-94 arrival record, N-797 notices); every rule is stated in the material, and the attorney, not the paralegal, gives legal advice.

| # | Section | Minutes | Step types | Points |
| --- | --- | --- | --- | --- |
| 1 | Rapid round: status and date math (filing window, arrival record, grace period, six-year limit) | 6 | `rapid_round` | 10 |
| 2 | Forms cross-check: petition, passport, job letter and wage attestation | 10 | `document_review` | 20 |
| 3 | Rapid round: document and process terms | 6 | `rapid_round` | 10 |
| 4 | Packet checklist: missing, unsigned, wrong fee, untranslated, not valid | 10 | `document_review` | 20 |
| 5 | Rapid round: deadlines (RFE, motion to reopen, posting, premium processing, courier) | 6 | `rapid_round` | 10 |
| 6 | Inbox: RFE response packet, backdating request, beneficiary's travel question | 12 | `multiple_choice` | 12 + 10 + 8 |

Doc: `paralegal/immigration-h1b-packet.md`.

## Shared legal helpers

`src/lib/engine/scenarios/legal/` (import from the folder's `index.ts`) holds what every legal scenario reuses. Scenario code reads it; changes to it go through their own PR.

| File | What it gives |
| --- | --- |
| `dates.ts` | ISO date arithmetic (`addDays`, `daysBetween`, `weekdayOf`), the federal holiday calendar with observed dates (`federalHolidays`, `isLegalHoliday`, verified for 2026 to 2028), court days (`isCourtDay`, `nextCourtDay`, `previousCourtDay`, `courtDaysAfter`, `holidaysBetween`), `computeDeadline` (FRCP 6(a) counting and rolling, 6(d) mail days after the roll) and `formatDate` |
| `citations.ts` | The fictional courts (`COURTS`: Fourteenth Circuit, District of Wexford, Supreme Court of Wexford), the firm's citation guide (`CITATION_GUIDE`, `citationGuideText`) and citation formatting (`formatCaseCitation`, `shortCaseCitation`, `citationParenthetical`) |
| `names.ts` | Name pools (`FIRST_NAMES`, `LAST_NAMES`), fictional `LAW_FIRMS`, `CASE_COMPANIES` and `CLIENT_COMPANIES`, seeded pickers (`pickDistinct`, `distinctPeople`, `personName`) and emails (`emailFor`, `companyDomain`) |

Tests: `tests/engine/legal-helpers.test.ts`.

## The `ordering` step type

Added for the paralegal work (first used by the PI medical chronology) and generic enough for any sequencing task. The candidate puts 6 to 12 items in order by drag handle, Up / Down buttons or the keyboard. Scoring has two parts, each optional: `positionPoints` for items in their exact place and `pairwisePoints` for pairs in the right relative order (Kendall-style, the forgiving part). The public config shows items in the authored order, so a generator must shuffle them per seed. The company side labels it "Ordering" and the answer-key view shows the expected order. Full spec in `06-assessment-engine.md`.

## Content rules

- **Fictional people, firms, courts, cases and states.** Courts are the District of Wexford, the Fourteenth Circuit and the Supreme Court of Wexford; states are Wexford and Calloway; reporters (N.F.R., N.F. Supp., Wex.) are invented, so no seeded citation can match a real case.
- **Real public rules are fine**: the FRCP and FRAP, the federal holiday calendar, DGCL sections, SEC filing rules, IRC §83(b), 12 CFR 1026.19(f)(2). Local rules, bylaws, playbooks and protocols are invented and stated in the material.
- **No Bluebook text.** Citation format comes from the firm's own short guide in `citations.ts`, not from any published citation manual.
- **No CPT codes** or other licensed billing code sets. Medical bills carry plain descriptions; the only real form name is UB-04.
- **Paralegal scope.** The right answer on any judgment call is the one a paralegal should take: flag it and escalate to the attorney, never give legal advice, never backdate or alter a signed record, never contact a represented party.
- Message senders are role lines ("Your supervising partner") because message `from` fields aren't template-filled; bodies sign with the seeded names.

## Status and next steps

| Item | Status |
| --- | --- |
| Six simulations | Merged, draft: team self-review pending |
| Self-review | Checklist in `reviews/2026-11-paralegal-review.md`, not yet done. There is no outside reviewer for now; the team signs off |
| Publishing | Not run. After sign-off, fixes (and a version bump where needed) land first, then `pnpm scenarios:publish` |
| Go-to-market | Not started for legal; `09-go-to-market.md` covers accounting only |
