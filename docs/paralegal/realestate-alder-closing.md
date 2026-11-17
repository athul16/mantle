# Real estate paralegal: closing on 418 Alder Lane

Status: **draft: team self-review pending.** Version 1. Published to the cloud library as v1 on 2026-11-17 for the team's own testing; fixes from the review ship as v2.

| | |
| --- | --- |
| Slug | `realestate-alder-closing` v1 |
| Role family | `legal` |
| Time | 50 minutes, six timed sections |
| Points | 100, all scored automatically (no reviewer step) |
| Code | `src/lib/engine/scenarios/realestate-alder-closing.ts` |
| Shared helpers | `src/lib/engine/scenarios/legal/` (dates, holidays, name pools, law firms), read only |
| Tests | `tests/engine/realestate-alder-closing.test.ts` |

## Setup

The candidate is a real estate paralegal at the settlement attorney's office (a seeded fictional firm) handling the sale of 418 Alder Lane, a duplex in the fictional State of Wexford. The sellers, a married couple, live in unit A and rent out unit B; the buyer takes the property subject to the tenant's lease and takes over the security deposit.

Seeded per attempt: every person, firm, lender, title company, city, county, subdivision, lot, block, plat book and page, every amount, rate and date, the proration convention (the buyer or the seller owns the day of closing), whether the year's property tax is paid, which title item and deed line carries which trap, what the lender changed, and where the right option sits. Closing dates fall in 2027 on business days (weekends and federal holidays excluded), never within two days of a month's ends, so every monthly proration has days on both sides.

The proration convention is stated in an exhibit on every proration item and on the settlement statement's data sheet: *365-day year for taxes and interest; rent and HOA dues by the actual days in the month; rent is prorated only if the seller collected it; the {buyer | seller} owns the day of closing; round once, to the cent, at the end.* The key rounds each amount once, to the nearest cent, and the statement accepts answers within $0.01.

## Sections and timing

| # | Section | Minutes | Steps | Points |
| --- | --- | --- | --- | --- |
| 1 | Rapid round: prorations | 6 | `rapid-prorations` (15 × 20 s) | 10 |
| 2 | Settlement statement | 11 | `settlement` (`spreadsheet`) | 20 |
| 3 | Rapid round: title terms | 6 | `rapid-title-terms` (15 × 20 s) | 10 |
| 4 | Title commitment | 11 | `title-review` (`document_review`, 12 items) | 20 |
| 5 | Rapid round: deed and recording checks | 6 | `rapid-recording` (15 × 20 s) | 10 |
| 6 | Deed review and inbox (one screen at a time) | 10 | `deed-review` 300 s, `inbox-lender` 150 s, `inbox-buyer` 150 s | 15 + 8 + 7 |

Rapid rounds: items 3, 6, 9, 12 and 15 are the harder kinds and worth 1 point; the other ten are worth ½. Messages from the attorney, the lender and the buyer arrive when their section opens.

## Rapid round A: prorations (10)

Each item shows a closing date, the convention and one fact; each has its own closing date. The candidate picks from four options ("Credit the buyer $X", "Credit the seller $X", or an amount).

| Kind | Tier | Per round | Rule | Tempting wrong options |
| --- | --- | --- | --- | --- |
| Calendar-year tax, unpaid | ½ | 2 | Seller credits the buyer for the seller's days (Jan 1 to closing, less the closing day if the buyer owns it) | Closing day given to the other side; credit to the wrong party; the buyer's share; a 360-day year |
| Calendar-year tax, paid by the seller | ½ | 2 | Buyer credits the seller for the buyer's days | Same family |
| Rent collected by the seller | ½ | 2 | Seller credits the buyer for the buyer's days of the month | Wrong closing-day owner; wrong party; seller's share; 30-day month; the whole month |
| HOA dues paid by the seller | ½ | 2 | Buyer credits the seller for the buyer's days of the month | Same family |
| Prepaid interest on the buyer's loan | ½ | 2 | Loan × rate ÷ 365 × days from closing through month end, both included | One day short or long; 360 or 366-day basis; a 30-day month |
| Seller's payoff interest | 1 | 2 | Principal × rate ÷ 365 × days from the day after the paid-through date through closing; a third of the time the paid-through date is two months back (a missed payment) | One day off either way; 360 or 366-day basis; counting from the 1st of the closing month only |
| Fiscal-year tax (July 1 to June 30) paid | 1 | 1 | Buyer credits the seller for the days from closing to June 30 | Treating it as a calendar year; the seller's days |
| Rent not collected | 1 | 1 | No credit: rent is prorated only if collected | Prorating it anyway |
| Rent plus deposit | 1 | 1 | Buyer's share of the rent plus the whole deposit, both to the buyer | Rent only; deposit only; credit to the seller |

## Section 2: settlement statement (20)

A `spreadsheet` step. The top is a closing data sheet: closing date, convention, price, earnest money (held in our trust account), new loan, seller's credit toward the buyer's closing costs, the year's property tax with its status, monthly HOA dues and rent (both for the closing month), the tenant's security deposit, the seller's mortgage principal, rate and paid-through date, the commission rate, the transfer tax rate ($ per $1,000 of price) and four itemized buyer charges.

Below it, the statement has a pre-filled price row and eleven lines, each with four input cells (buyer debit, buyer credit, seller debit, seller credit), so the grid never tells the candidate which side an amount belongs on. Only the right cells are keyed; an amount on the wrong side scores 0 for that line and throws off the totals.

| Line | Right cells | Points |
| --- | --- | --- |
| Earnest money | Buyer credit | 1 |
| New loan | Buyer credit | 1 |
| Seller's credit for buyer's costs | Buyer credit, seller debit | ½ + ½ |
| Property tax, prorated | Unpaid: buyer credit + seller debit (seller's days). Paid: buyer debit + seller credit (buyer's days) | 1 + 1 |
| HOA dues, prorated | Buyer debit, seller credit (buyer's days) | ½ + ½ |
| Rent, prorated | Buyer credit, seller debit (buyer's days) | ½ + ½ |
| Security deposit | Buyer credit, seller debit | ½ + ½ |
| Payoff (principal + per diem interest) | Seller debit | 1 |
| Commission | Seller debit | 1 |
| Transfer tax | Seller debit | 1 |
| Buyer's lender and title charges (sum of four) | Buyer debit | 1 |
| Totals before cash (four columns) | | 4 × 1 |
| Cash due from the buyer (buyer credit column) | | 2 |
| Cash due to the seller (seller debit column) | | 2 |

Traps: the tax direction flips with its status; the closing-day owner moves every proration by a day; the security deposit is easy to forget; HOA dues run the other way from rent; the payoff needs interest on top of principal. Figures are drawn so that both cash amounts are positive.

## Rapid round B: title terms (10)

Fifteen four-option questions: ten from a pool of 14 easy definitions (Schedule A, B-I, B-II, easement, mechanic's lien, release of mortgage, lis pendens, chain of title, owner's and lender's policy amounts, payoff letter, HOA estoppel certificate, vesting, encumbrance) and five from a pool of 7 harder ones (clearing a similar-name judgment with a name affidavit, the gap and the updated search, race-notice priority, general vs special warranty deed, quitclaim deed, subordination agreement, first-recorded mortgage paid before a later judgment).

## Section 4: title commitment (20)

A 12-item commitment with columns No., Type, Recorded, Parties, Status per title search and Proposed handling, in a seeded order. Header fields: the property, the vesting (Schedule A), the sellers' address from their affidavit, the proposed insured, the contract's permitted exceptions (utility easements, the recorded plat, the HOA declaration, the year's taxes not yet due) and the effective date.

| Finding | Points | Expected flag | Why |
| --- | --- | --- | --- |
| Home equity line left on title | 4 | "Open lien: pay it off…" | Open, no release; the credit line also has to be frozen and closed |
| Mechanic's lien left on title | 3 | "Open lien" | Unpaid contractor's claim; pay or bond off and release |
| Delinquent taxes treated as a permitted exception | 3 | "Open lien" | Last year's taxes are delinquent, not "not yet due" |
| Judgment against a similar name set to be paid | 4 | "Not our seller: clear it with a name affidavit" | Same first and last name as a seller, different middle initial and a different address |
| Driveway easement for the neighbouring lot accepted | 4 | "Not a permitted exception" | Only utility easements are permitted; the buyer must approve it or title must remove it |
| Decision | 2 | Send the attorney a title memo before the closing is confirmed | Not "close as written", "pay everything to be safe" or "delete every exception" |

Look-alikes that are right as proposed: the first mortgage set to be paid off and released, an old mortgage already released, a judgment against a seller's exact name that is satisfied of record, the current year's taxes, the utility easement, the plat and the HOA declaration. A false flag costs 1.

## Rapid round C: deed and recording checks (10)

Each item shows the vested owner, the grantor on the deed, the legal description on the survey and on the deed, the acknowledgment, and the county's fee schedule with the page count and the check enclosed. Five fixed options: ready to record, grantor, legal description, acknowledgment, fee. Each deed has at most one problem.

| Kind | Tier | Per round |
| --- | --- | --- |
| Ready to record | ½ | 3 |
| Grantor: surname misspelled | ½ | 2 |
| Grantor: one co-owner left off | ½ | 1 |
| Legal description: lot or block differs | ½ | 2 |
| No notary block | ½ | 2 |
| Grantor: one middle initial differs | 1 | 1 |
| Legal description: plat page digits transposed | 1 | 1 |
| Notary's commission expired before the signing date | 1 | 1 |
| Fee short (additional pages not paid for) | 1 | 1 |
| Ready to record, 3–7 pages so the fee must be worked out | 1 | 1 |

## Section 6: deed review and inbox (30)

### Deed review (15)

Nine lines of the draft deed (grantor, grantee, address, legal description, tax parcel, consideration, deed type, acknowledgment, prepared by / return to), each next to the source it must match. Three traps, 5 points each, false flag 1:

- **Grantor vs vesting**: one co-owner left off, the surname misspelled, or a middle initial wrong.
- **Legal description vs survey**: the lot, the block or the plat page differs.
- **Missing notary block**: the signature page ends with the signature lines; the recording act needs each grantor's signature acknowledged.

### Inbox (15)

| Step | Points | Right answer |
| --- | --- | --- |
| `inbox-lender` (multi-select) | 8 | Always: update the statement and send the buyer the new cash to close; get the lender's revised closing instructions in writing. Then the waiting-period call: a new 3-business-day wait when the APR rises by more than 1/8 point or a prepayment penalty is added; otherwise a corrected Closing Disclosure with no new wait (a smaller APR change, or a lower loan amount with the same rate and APR). Wrong: close on the old figures, ask the seller to cover the difference, edit the loan documents yourself. Scored right/(right options) − wrong/(wrong options), floored at 0. |
| `inbox-buyer` (single) | 7 | The attorney handles it: a new date needs a written amendment signed by the buyer and the seller, and the prorations, payoff and rate lock are then updated. Wrong: change the date in the file because the buyer asked, say the date can never change, or move it without updating the figures. |

The prompt quotes a plain-language summary of the real rule (12 CFR 1026.19(f)(2)): corrected disclosure for any change; a new three-business-day wait only for an APR that becomes inaccurate (more than 1/8 point for a regular loan), a product change, or an added prepayment penalty. Each of the four lender changes (large APR rise, small APR rise, prepayment penalty, lower loan amount) comes up about a quarter of the time.

## Scoring table

| Step | Points |
| --- | --- |
| Rapid round A: prorations | 10 |
| Settlement statement | 20 |
| Rapid round B: title terms | 10 |
| Title commitment | 20 |
| Rapid round C: deed and recording checks | 10 |
| Deed review | 15 |
| Lender changes the loan | 8 |
| Buyer wants to move the closing | 7 |
| **Total** | **100** |

Tests (200 seeds): every task is solved from the rendered material with the tests' own reading of the convention and rules and compared with the server key; a perfect attempt scores 100, a blank 0; each title and deed trap costs exactly its points (half for the right item with the wrong reason); tax on the wrong side of the statement costs 2, a missing deposit 1, a wrong payoff 1; every rapid item has exactly one right option; another seed's perfect answer averages under 40; computed statement figures never appear in the candidate's payload.

## Judgment calls for review

1. **Proration convention per seed.** Who owns the closing day varies by seed (it varies by state and contract in practice); the 365-day year and actual-days-in-month rules are fixed and stated each time. Rounding is once, at the end, to the cent; the statement accepts ±$0.01.
2. **Leap years avoided.** Every closing is in 2027 and the fiscal-year items cover July 2026 to June 2027, so a 365-day year is always exact.
3. **Uncollected rent isn't prorated.** Stated in the convention; the buyer and seller settle it after closing. Tested in one hard proration item.
4. **Payoff interest runs through the closing date**, from the day after the paid-through date. Lenders differ (some charge through the day funds arrive); the data sheet states the rule.
5. **Prepaid interest includes the closing day and the last day of the month**, the usual lender practice; stated on the item.
6. **The statement uses four columns per line** (buyer and seller, debit and credit) rather than the CFPB Closing Disclosure layout, so the side is part of what is tested. The cash rows go in the balancing columns (cash from the buyer as a buyer credit, cash to the seller as a seller debit), HUD-1 style.
7. **Transfer tax and commission are the seller's** in this contract; that is stated on the data sheet, since local custom varies.
8. **Delinquent taxes are flagged as an open lien** ("pay off at closing"), the same reason as the mortgages, rather than a separate reason.
9. **The similar-name judgment** differs from the seller in middle initial and address, which is what a title examiner would see; the right move is a name (identity) affidavit, not payment.
10. **Inbox steps are multiple choice, not written replies,** so the whole simulation scores automatically.
11. **The notary trap in the deed review is always the missing block** (the brief's "missing notary block"); the expired-commission variant is tested in rapid round C instead.
12. Message senders are role lines ("Your supervising attorney", "Buyer's lender, closing department") because message `from` fields aren't template-filled; the bodies sign with the seeded names.
13. Recording-act citations are generic ("Wexford recording act") rather than invented section numbers. The CFPB rule is real and cited (12 CFR 1026.19(f)(2)).
14. Some notary signing dates in rapid round C fall on weekends (mobile notaries work weekends); not a trap.
