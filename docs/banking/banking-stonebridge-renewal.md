# Commercial credit analyst: Stonebridge renewal

Status: **draft: practitioner review pending.** Version 1. Not on the publish allowlist (`src/lib/scenarios/publishable.ts`); it goes on after a commercial credit practitioner has reviewed it.

| | |
| --- | --- |
| Slug | `banking-stonebridge-renewal` v1 |
| Title | Stonebridge Bank: credit analyst |
| Role family | `banking` |
| Time | 50 minutes, six timed sections |
| Points | 100, all scored automatically (no reviewer step) |
| Code | `src/lib/engine/scenarios/banking-stonebridge-renewal.ts` |
| Shared helpers | `src/lib/engine/scenarios/legal/` (date helpers, name pools; imported, not changed) |
| Tests | `tests/engine/banking-stonebridge-renewal.test.ts` |

## Setup

The candidate is an analyst in the commercial banking programme at Stonebridge Community Bank (fictional). Today is the annual renewal and line increase for an operating company, an LLC owned by one guarantor. Loan committee meets Friday; the relationship manager wants the spread and a clean memo by Thursday.

Cast (role lines fixed, names seeded): the relationship manager, the chief credit officer, loan operations, the borrower's controller, and once, another bank customer.

Seeded per attempt: the industry (HVAC contractor, food manufacturer, regional distributor, dental group) and borrower, every person, lender, appraiser and CPA firm, every figure and date (committee in 2027 or 2028; fiscal years end Dec 31), the bank's policy limits (statement and appraisal ages, covenant levels, advance rates, grid thresholds, annualisation threshold), which period holds the one-time gain, which memo row carries which problem, which two errors the borrower's certificate has, and where every right option sits. All companies and people are fictional.

Statements are in $000s and tie on every seed: gross profit, operating income and net income add up; assets = liabilities + members' equity; equity rolls forward by net income less distributions; each year's scheduled principal is the prior year end's current portion of long-term debt.

## Sections and timing

| # | Section | Minutes | Steps | Points |
| --- | --- | --- | --- | --- |
| 1 | `s-rapid-a` Ratio flash | 6 | `rapid-ratios` (15 × 20 s) | 10 |
| 2 | `s-work-1` The spread | 10 | `spread` (spreadsheet) | 20 |
| 3 | `s-rapid-b` Covenant calls | 6 | `rapid-covenants` (15 × 20 s) | 10 |
| 4 | `s-work-2` Draft memo against the file | 10 | `package-review` (document_review, 12 rows) | 20 |
| 5 | `s-rapid-c` Borrowing base | 6 | `rapid-base` (15 × 20 s) | 10 |
| 6 | `s-desk` Desk, one screen at a time | 12 | `base-certificate` 210 s, `risk-rating` 75 s, `lead-risk` 75 s, five values calls 72 s each | 10 + 5 + 5 + 10 |

Rapid rounds: items 3, 6, 9, 12 and 15 are the harder kinds, worth 1; the other ten are worth ½. Every item is a choice of four with fixed option ids and a seeded right position. The controller's revision arrives four minutes into the spread.

## Rapid round A: ratio flash (10)

The bank's definitions are in the round's brief. Each item shows four lines of a statement snippet for a portfolio company.

| Kind | Tier | Rule | Wrong options |
| --- | --- | --- | --- |
| Current ratio | ½ | CA ÷ CL | inverted; quick ratio; CA ÷ total liabilities |
| Debt to tangible net worth | ½ | TL ÷ (NW − intangibles) | ignores intangibles; funded debt only; adds intangibles |
| Days sales outstanding | ½ | AR ÷ revenue × 365 | over cost of sales; 360-day year; payables days |
| Loan to value | ½ | loan ÷ appraised value | over purchase price; over assessed value; equity share |
| Gross margin | ½ | (revenue − cost of sales) ÷ revenue | markup on cost; cost ratio; after SG&A |
| Debt service coverage | 1 | (NI + interest + D&A) ÷ (prior-year CPLTD + interest) | drops interest from the denominator; interest only |
| Funded debt to EBITDA with add-back | 1 | funded debt ÷ (EBITDA + one-time expense) | no add-back; subtracts it; adds payables |
| DSO on average receivables | 1 | ((start + end) ÷ 2) ÷ revenue × 365 | ending or starting balance only; 360 days |

## Section 2: the spread (20)

One spreadsheet holds the income statements (FY1, FY2, FY3 and the interim), depreciation inside cost of sales, distributions, scheduled principal, three balance sheets, two notes, and the input rows. FY1 is for the trend only. The definitions (credit policy §4) are in the brief; the chief credit officer's email gives the annual debt service on the increase.

Inputs: EBITDA, adjusted EBITDA, cash available for debt service and debt service coverage for FY2, FY3 and the interim (12 × 1.25, integers exact, ratios ±0.01); pro forma coverage (3, ±0.01); FY3 funded debt to adjusted EBITDA (2, ±0.01).

Traps, each checked to move at least one answer past its tolerance on every seed:

- **One-time gain** inside other income (note 2), in FY2, FY3 or the interim: out of adjusted EBITDA.
- **Distributions to members** reduce cash available.
- **Depreciation inside cost of sales** (note 1) is part of EBITDA.
- **New debt service** on the increase goes in the pro forma denominator.
- **Annualisation only where policy says:** the basis is the annualised interim when it covers at least the policy's months (6 or 9), otherwise FY3. Both cases occur.
- **Mid-task revision** (minute 4): the controller raises interim SG&A and restates interim net income; the interim cells (and pro forma, when annualised) change.

## Rapid round B: covenant calls (10)

Exhibit: covenant wording, test frequency, period, figures, cure provision. Options: in compliance; breach, event of default now; breach, still within the cure period; not tested this period. The agreement's words decide.

- Easy: clearly met (any cure clause is irrelevant), clearly breached with no cure, and an annual covenant shown for a quarter end (not tested, usually with a failing figure to tempt).
- Hard: **exactly at the threshold** ("not less than" is met, "greater than" is breached); **cure period** (inside or outside the days the agreement allows after the certificate is delivered); **definition differs** (the agreement's coverage includes or excludes distributions, and the policy's reading would land the other way).

## Section 4: draft memo against the file (20)

Twelve rows: item, what the draft memo says, what the file shows. The header carries the committee date, policy §§2.1, 3.1, 3.4, 3.6, 5.2 and the loan agreement's covenants. Six findings at 3 each (half for the right row with another reason), false flags cost 1, decision 2.

| Finding | Expected flag | Rule |
| --- | --- | --- |
| Interim statements stale | the memo's interim (a quarter older than the one in the spread) is over the policy's 60 or 90 days | policy §3.1 |
| Appraisal stale | real estate or equipment appraisal over 12, 18 or 24 months | policy §3.4 |
| Guarantor's PFS unsigned | signature line blank | policy §3.6 |
| Breach described as compliance | the certificate figure misses the agreement's minimum coverage or maximum leverage | loan agreement §6.1 |
| Prior lien | an active UCC-1 by another lender on the equipment; first to file ranks first | UCC §9-322(a)(1) |
| Legal name differs | memo says Inc., Holdings or Group; articles say the LLC's name | policy §2.1 |

Clean look-alikes on every seed: the FY3 annual statements, the other appraisal (in date), the signed guaranty, the other covenant met by 0.01x to 0.08x, a lien terminated by UCC-3, and the registered trade name.

Decision: **return it to the relationship manager with the list** (each item fixed or carried as an approved exception). Wrong: send as drafted; send and list exceptions yourself; edit the RM's memo yourself.

## Rapid round C: borrowing base (10)

Four-customer agings with an advance rate and a concentration cap. Ineligibles (bank policy, in the brief): over 90 days; every balance of an affiliate; an account with a credit balance counts as zero (not netted); the part of one customer's eligible balance above the cap, measured on eligible receivables after the other ineligibles.

- Easy: eligible after over-90s; availability = eligible × rate.
- Hard: concentration cap; affiliate account; credit balance.
- Wrong options: forgot the over-90s; excluded whole accounts with any over-90 balance; gave eligible for availability; netted the credit balance; applied the cap to gross receivables; excluded only part of the affiliate.

## Section 6: desk (30)

### Borrowing base certificate (10, 210 s)

The borrower's certificate beside a column for the bank's recompute; the aging summary, inventory listing and policy (advance rates, inventory cap, line commitment) are in loan operations' email. Inputs at 2.5 each (±$1): eligible receivables (total − over 90 − affiliate), eligible inventory (raw materials + finished goods; work in process and in transit excluded), availability (lesser of the base and the line), excess or shortfall. The borrower makes two of four errors per seed: affiliate not deducted, work in process counted, receivables advanced 5 points above policy, inventory cap not applied. Both excesses and shortfalls occur.

### Risk rating (5, 75 s)

The chief credit officer's worksheet: base-case coverage and leverage, a grid (credit policy §7) grading each 3 to 6, the rating is the worse of the two, then one grade worse for the unwaived covenant breach from the memo. The two grades always differ and no figure sits within 0.02x of a grid line. Wrong options include the un-notched grade and the better-of-two grade.

### Lead risk (5, 75 s)

Four risks with this file's figure and policy limit; lead with the least headroom (relative to the limit). The lead varies across all four and beats the next by at least 0.04.

### Values calls (2 each, 72 s)

| Step | Tag | Situation | Right option and why | Wrong options |
| --- | --- | --- | --- | --- |
| `values-integrity` | integrity | RM asks to leave the covenant breach out "so it doesn't derail Friday" (pressure from a superior) | keep it in, plainly, and help with the waiver request; the memo must disclose every covenant exception | leave it out this once; bury it in an appendix footnote; refuse and report the RM to the audit committee |
| `values-candor` | candor | Loan operations reports that the spread the candidate already sent double-counted depreciation | tell the CCO today with a corrected spread and a note | fix the file quietly; wait to see if anyone asks; pull the deal from the agenda |
| `values-in-lane` | in-lane | Controller asks if the increase is approved so they can order equipment | not approved until committee decides and a commitment letter issues; pass to the RM | say yes; say it's very likely; ignore and forward to legal |
| `values-client-care` | client-care | Another customer asks how the borrower is doing | decline: customer information is confidential (bank policy; Gramm-Leach-Bliley Act privacy rules) | share a general picture; confirm the request; report the customer to compliance |
| `values-quality` | quality | Operations offers to book before the insurance certificate naming the bank arrives | hold booking until it's in the file; ask the controller to chase the agent | book and chase after; book and log your own exception; cancel the renewal |

## Scoring table

| Step | Points |
| --- | --- |
| `rapid-ratios` | 10 |
| `spread` | 20 (12 × 1.25, pro forma 3, leverage 2) |
| `rapid-covenants` | 10 |
| `package-review` | 20 (6 × 3, decision 2) |
| `rapid-base` | 10 |
| `base-certificate` | 10 (4 × 2.5) |
| `risk-rating` | 5 |
| `lead-risk` | 5 |
| Five values calls | 10 (5 × 2) |
| **Total** | **100** |

## What the tests prove

Over 200 seeds, with the test's own reading of the screen and rules (no scenario internals): every rapid item has exactly one right option matching the key; the spread, memo, certificate, rating, lead risk and values keys match independent solutions; statements tie; a perfect attempt scores 100 and a blank one 0; each spreading trap costs exactly the cells it changes; each memo finding costs 3 (1.5 with the wrong reason), the wrong decision 2, a flag on a clean look-alike 1; copying the borrower's certificate costs 2.5 per wrong line; another seed's perfect answers average under 40; no reviewer note or computed answer appears in the candidate payload; sections validate, fill 50 minutes and run in order; one-at-a-time seconds sum to 720.

## Sources

- Ratio definitions follow the common commercial lending forms (RMA's *Annual Statement Studies* definitions; DSCR and funded debt to EBITDA as used in loan agreements). Stonebridge's own versions are stated on screen, so a candidate applies the card.
- Lien priority: UCC §9-322(a)(1), first to file or perfect; UCC-3 termination under §9-513.
- Customer confidentiality: Gramm-Leach-Bliley Act, 15 U.S.C. §6801 et seq. and Regulation P, plus the bank's own confidentiality policy.
- Thresholds, ages, advance rates, the ineligibles and the rating grid are Stonebridge policy, seeded per attempt.

## Judgment calls for review

- **Credit balances in an aging** count as zero and aren't netted. Practice varies (some banks add past-due credits back as an ineligible); this is stated as Stonebridge policy. Check the wording a reviewer expects.
- **No cross-aging rule** (an account with most of its balance over 90 days becoming wholly ineligible). Left out to keep rapid items readable; worth adding to a senior sibling.
- **Pro forma basis:** annualised interim against the last fiscal year's debt service plus the stress debt service on the increase. Banks differ (trailing twelve months is common); stated as policy.
- **Coverage in the ratio flash** uses (NI + interest + D&A) ÷ (prior-year CPLTD + interest), while the spread uses the policy's cash-available definition with distributions. Deliberate (two conventions a trainee meets), but a reviewer may prefer one.
- **Risk grades 3 to 7** use generic Pass / Special mention / Substandard names; check a regulator-aligned label set.
- **Global cash flow with the guarantor** is left for a senior sibling simulation.
- **Operations-track sibling** (payments exceptions, account maintenance) for the same programme is not built.
- **Values points** count in the total here; whether they should, and whether companies can pick their own values, are open product questions.
- Step type wished for: none was strictly needed. A numeric entry inside a document table (to enter the corrected covenant figure next to a flag) would make the memo review closer to real work.
