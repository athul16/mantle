# Corporate paralegal: Halyard Robotics entity work

Status: **draft: team self-review pending.** Version 1. Published to the cloud library as v1 on 2026-11-17 for the team's own testing; fixes from the review ship as v2.

| | |
| --- | --- |
| Slug | `corporate-halyard-robotics` v1 |
| Role family | `legal` |
| Time | 50 minutes, six timed sections |
| Points | 100, all scored automatically (no reviewer step) |
| Code | `src/lib/engine/scenarios/corporate-halyard-robotics.ts` |
| Shared helpers | `src/lib/engine/scenarios/legal/` (filing dates over the federal holiday calendar, name pools, firms) |
| Tests | `tests/engine/corporate-halyard-robotics.test.ts` |

## Setup

The candidate is a corporate paralegal at a law firm (seeded from the shared pool of fictional firms), working for a partner on Halyard Robotics, Inc., a fictional Delaware corporation that builds warehouse robots and is closing its Series A.

Seeded per attempt: the firm, every person (founders, CFO, employees, directors, the acquirer's contact), the three venture funds (seed fund, Series A lead, second investor), the NDA counterparty, every share count, the board size and notice period, the charter's authorized shares, the NDA playbook limits and draft terms, the closing date, which board action, clause and checklist item carries which trap, and where the right option sits. Funds and companies are fictional. Filing rules (Regulation D Rule 503, IRC §83(b), Exchange Act §16(a), Form 8-K, Rule 13d-1(a)) and the DGCL sections cited are real and public; the bylaws, charter, stock plan and NDA playbook are invented for the scenario.

## Sections and timing

| # | Section | Minutes | Steps | Points |
| --- | --- | --- | --- | --- |
| 1 | Rapid round: ownership and filing deadlines | 6 | `rapid-ownership` (15 × 20 s) | 10 |
| 2 | Cap table | 10 | `cap-table` (`spreadsheet`, 8 lines + total) | 20 |
| 3 | Rapid round: governance terms | 6 | `rapid-governance` (15 × 20 s) | 10 |
| 4 | Board actions | 10 | `board-consents` (`document_review`, 9 actions) | 20 |
| 5 | Rapid round: contract terms | 6 | `rapid-contracts` (15 × 20 s) | 10 |
| 6 | Deal desk and inbox (one screen at a time) | 12 | `nda-review` 270 s, `closing-checklist` 240 s, `inbox-founder` 105 s, `inbox-diligence` 105 s | 12 + 10 + 4 + 4 |

Rapid rounds: items 3, 6, 9, 12 and 15 are the harder kinds and worth 1 point; the other ten are worth ½. Every item is a choice of four. Messages from the partner, the CEO and the acquirer arrive when their section opens.

## Rapid round A: ownership and filing deadlines (10)

Ten easy items (½): five basic ownership percentages and five calendar-day filing deadlines. Five hard items (1): one fully diluted percentage, one post-money percentage and three business-day deadlines that always cross a federal holiday.

| Kind | Tier | Material | Rule |
| --- | --- | --- | --- |
| Basic % | ½ | Holder's shares, shares outstanding | shares ÷ outstanding, two decimals |
| Fully diluted % | 1 | Holder's shares and options; outstanding; options outstanding; pool available | (shares + options) ÷ (outstanding + options outstanding + pool) |
| Post-money % | 1 | Fully diluted shares before the round; new Series A shares | new ÷ (before + new) |
| Calendar deadline | ½ | Form D (15 days, Rule 503), 83(b) election (30 days, IRC §83(b)/§7503), Form 3 (10 days) | Don't count the event day; a weekend or federal holiday rolls to the next business day |
| Business-day deadline | 1 | Form 4 (2), Form 8-K (4), Schedule 13D (5 business days after crossing 5%) | Count weekdays that aren't federal holidays |

Each item lists the federal holidays in its window. Wrong options: denominators that add the holder twice or drop options or the pool, the unrolled date, rolling backward, counting the event day, counting business days for a calendar rule (and calendar days for a business rule), forgetting the holiday.

## Section 2: cap table (20)

The spreadsheet shows eight lines with shares before the round: the CEO and CTO (founders, Common), the CTO's family trust (0), an employee (Common, sometimes 0), the seed fund (Series Seed Preferred), the Series A lead (0), options outstanding and the pool available for grant, plus the fully diluted total. The partner's email lists five transactions, in order:

1. Series A: the lead buys new Series A Preferred.
2. Pool top-up: shares added to the pool.
3. New grant to a new hire, out of the pool (pool down, options outstanding up; the hire has no line of their own).
4. Option exercise by the employee (options outstanding down, employee's Common up).
5. Transfer from the CTO to the family trust.

The candidate enters shares after for each line (1 point each), the new fully diluted total (2) and each line's fully diluted percentage to two decimals (1.25 each, tolerance 0.01). Only the round and the pool top-up change the total; grant, exercise and transfer move shares between lines. Leaving out the transfer, the grant or the exercise costs exactly the two lines it touches (4.5).

## Rapid round B: governance terms (10)

Delaware housekeeping: charter vs. bylaws, quorum, who elects directors and appoints officers, registered agent, stock ledger, good standing and secretary's certificates, liquidation preference, ROFR, drag-along, minutes, what plan options buy, and a seeded outstanding-shares sum (issued − treasury). Hard: board written consent must be unanimous (§141(f)); stockholder written consent by the votes needed at a meeting, with prompt notice (§228); stockholder meeting notice 10–60 days (§222); attendance without objection waives notice (§229); ratification of defective acts (§204); a seeded quorum count on a board with vacancies (majority of the whole board, not of the filled seats).

## Section 4: board actions vs. the bylaws (20)

Nine board actions since the Series Seed, in date order: date, how the board acted (special meeting, regular meeting or unanimous written consent), notice date, directors present or signing, the action and the stock it touches. The header gives the directors (5 or 7 seats, all filled), quorum (majority of the whole board), special-meeting notice (2, 3, 5 or 7 days; regular meetings need none), the written-consent rule, the charter's authorized classes (Common and Series Seed Preferred only) and the stock plan (options over Common only).

| Finding | Points | Expected flag |
| --- | --- | --- |
| Meeting without a quorum (fewer than a majority of the whole board present) | 4.5 | That row, "No quorum" |
| Special meeting with fewer days' notice than the bylaws need, not every director present | 4.5 | That row, "Not enough notice" |
| Unanimous written consent missing one director's signature | 4.5 | That row, "Written consent not signed by every director" |
| Stock not allowed: options over Series Seed Preferred, Class B Common, or Series A Preferred before the restated charter | 4.5 | That row, "Stock the charter or the plan doesn't allow" |
| Decision | 2 | Send the partner the list first: the defects need an attorney's call, likely §204 ratification |

Clean look-alikes on every seed: a special meeting with exactly a quorum and enough notice, a regular meeting with no notice, a fully signed written consent (names in a different order), an option grant over Common and an authorized issuance or repurchase. Wrong decisions: send as is, fix the records yourself (redate, add signatures), strip the defective pages.

## Rapid round C: contract terms (10)

NDA and deal vocabulary: "Confidential Information" exclusions, governing law vs. venue, indemnity, limitation of liability, counterparts, integration, severability, evergreen renewal, non-solicitation, assignment, force majeure, survival. Hard: residuals clause, closing condition, bring-down, change of control, representation vs. covenant, MFN.

## Section 6: deal desk and inbox (30)

### NDA vs. playbook (12)

Eight clauses of the counterparty's draft mutual NDA, in a seeded order, with the playbook in the header.

| Finding | Points | Reason |
| --- | --- | --- |
| Liability cap below the playbook minimum ($1M, $2M or $5M; draft 5–50% of it) | 3 | Below the playbook minimum |
| Governing law of another state (playbook: Delaware only) | 3 | Not the playbook's required choice |
| Non-solicit 6–18 months longer than the playbook maximum (6 or 12) | 3 | Longer than the playbook allows |
| Automatic one-year renewals (playbook: fixed term only) | 3 | A term the playbook doesn't allow |

Clean: term at or under the maximum, survival at or over the minimum, Delaware venue, return-or-destroy with an archival copy.

### Closing checklist (10)

Nine items: six documents with the signatories needed and the pages received (SPA, Investors' Rights, Voting, ROFR and Co-Sale, board consent, stockholder consent) and three closing conditions (restated charter filed before closing; good standing certificate dated no more than 3 or 5 days before closing; compliance certificate signed by the CEO).

| Finding | Points |
| --- | --- |
| Two documents each missing one signatory's page | 2 + 2 |
| Two of the three conditions unmet (charter only sent for filing; good standing too old; certificate signed by the CFO) | 2 + 2 |
| Decision: hold the closing until the pages are in and each condition is met or waived in writing by the investors | 2 |

### Inbox (8)

| Step | Points | Right answer |
| --- | --- | --- |
| `inbox-founder` | 4 | The CEO asks to date the option-grant consent before the new valuation so the grant gets the old price. Don't backdate: the consent takes effect when the last director signs; pass the request to the partner. |
| `inbox-diligence` | 4 | A prospective acquirer asks for the full cap table before its NDA is signed. Send nothing until the NDA is signed and the partner approves what goes out. |

## Scoring table

| Step | Points |
| --- | --- |
| Rapid round A: ownership and filing deadlines | 10 |
| Cap table | 20 |
| Rapid round B: governance terms | 10 |
| Board actions | 20 |
| Rapid round C: contract terms | 10 |
| NDA vs. playbook | 12 |
| Closing checklist | 10 |
| CEO asks to backdate | 4 |
| Acquirer asks for the cap table | 4 |
| **Total** | **100** |

Tests (200 seeds): every task is solved from the rendered material with the tests' own reading of the rules and compared with the server key; a perfect attempt scores 100, a blank 0; each planted trap costs exactly its points (half for the right item with the wrong reason); each rapid item has exactly one right option; another seed's perfect answer averages under 40; no key note or computed cap table number appears in the candidate's payload.

## Judgment calls for review

1. **Rapid round A mixes Halyard with other clients.** Form 3, Form 4, Form 8-K and Schedule 13D don't apply to a private startup, so those items name "a public company client" or "a fund client"; Form D and the 83(b) election are Halyard's own.
2. **Business days skip federal holidays only**, matching SEC business days; the 83(b) item states the IRC §7503 weekend/holiday roll in its rule text so nobody needs to know the debate about it.
3. **Notice defects need an absent director.** A director who attends without objecting waives notice (DGCL §229), so the short-notice trap always has at least one director absent, and the governance round asks about §229.
4. **"Wrong share class" covers three versions**: options over preferred (the plan is Common only), an unauthorized Class B Common, and Series A Preferred issued before the restated charter. All take the same reason.
5. **The board decision is ratification by an attorney, not a fix.** Redating notices or adding signatures to signed records is a wrong option; §204 is named as the likely route, but the call is the partner's.
6. **Percentages are keyed to two decimals with a 0.01 tolerance**, so rounding the exact value either way scores. Share counts must be exact.
7. **Leak guard.** The shared DOM leak test reads key numbers in several forms (12.34, "1234" as cents). Share counts are always shown with commas and no decimals, so they can't match. A percentage could collide with a year or a rapid-round percentage by chance; the generator redraws the whole variant (deterministically, from the same seed) when it would.
8. **Inbox steps are multiple choice, not written replies,** so the whole simulation scores automatically.
9. Message senders are role lines ("Your supervising partner", "CEO, Halyard Robotics") because message `from` fields aren't template-filled; the bodies sign with the seeded names.
10. **Good standing freshness (3 or 5 days) is a deal-specific condition** in the checklist, not a rule of law.
