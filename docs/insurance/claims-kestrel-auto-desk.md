# Insurance claims representative trainee: Kestrel Mutual auto desk

Status: **draft: practitioner review pending.** Version 1. Not published; it goes on the publish allowlist (`src/lib/scenarios/publishable.ts`) only after someone who handles personal auto claims has reviewed it.

| | |
| --- | --- |
| Slug | `claims-kestrel-auto-desk` v1 |
| Title | Kestrel Mutual: claims representative |
| Role family | `insurance` |
| Time | 50 minutes, six timed sections |
| Points | 100, all scored automatically (no reviewer step) |
| Code | `src/lib/engine/scenarios/claims-kestrel-auto-desk.ts` |
| Shared helpers | `src/lib/engine/scenarios/insurance/` (clock and month formatters, whole-dollar limits, policy and claim numbers, shops, roads, vehicles), plus business days from `src/lib/engine/scenarios/legal/dates.ts` |
| Tests | `tests/engine/claims-kestrel-auto-desk.test.ts` |

## Setup

The candidate is a claims representative in training at Kestrel Mutual Insurance Company (fictional), on the personal auto desk. New claims came in overnight and payments go out this afternoon.

Cast, each with a fixed role line and a seeded name:

| Role line | Voice | Appears in |
| --- | --- | --- |
| Your claims supervisor | Brisk, rule-first ("we don't talk payment until coverage is confirmed") | Welcome, coverage check and its correction, estimate brief, statements, total loss, first day, authority, month-end push |
| Body shop estimator | Friendly, pushy | Supplement on the estimate, the referral-fee offer |
| Policyholder | Distressed | "Am I covered?" |
| Claimant's attorney | Formal | One letter of representation |
| Fellow trainee | Chatty, helpful | Diary dates, the deductible slip, the photo shortcut |

Seeded per attempt: every person, shop, vehicle, claim and policy number, date and amount; the card's newly acquired window (14 or 30 days), labour rates, parts-policy age, rental cover, deadlines (acknowledge in 3 or 5 business days, first contact in 1 or 2, status letter at 30 or 45 calendar days), total-loss adjustments and payment authority; which claim, estimate line and item carries which trap; row, line and option order. Dates stay in 2026 to 2028, where the federal holiday tables are verified.

Continuity: the estimate (section 4) and the total loss (desk) are claims from the morning's coverage-check list, both clean rows, with the same deductibles. Each long task has a minute-4 message that changes the work: underwriting's reinstatement correction turns a clean-looking row into the lapse, and the shop's supplement changes the repair payment.

## Sections and timing

| # | Section | Minutes | Steps | Points |
| --- | --- | --- | --- | --- |
| 1 | `s-rapid-a` Rapid round: coverage math | 6 | `rapid-coverage-math` (15 × 20 s) | 10 |
| 2 | `s-work-1` Coverage check | 10 | `coverage-check` (`document_review`, 12 claims) | 20 |
| 3 | `s-rapid-b` Rapid round: claim deadlines | 6 | `rapid-deadlines` (15 × 20 s) | 10 |
| 4 | `s-work-2` Estimate review | 10 | `estimate-review` (`spreadsheet`, 10 lines) | 20 |
| 5 | `s-rapid-c` Rapid round: statements | 6 | `rapid-statements` (15 × 20 s) | 10 |
| 6 | `s-desk` Claims desk (one screen at a time) | 12 | `total-loss` 180 s, `first-day` 120 s, `authority` 90 s, five values calls 66 s each | 8 + 6 + 6 + 10 |

Rapid rounds: items 3, 6, 9, 12 and 15 are the harder kinds, worth 1; the other ten are worth ½. Every item is a choice of four with fixed ids (a to d); the seed decides which label sits where. Each exhibit has five rows; short ones are filled with file details (line of business, desk) that don't change the answer.

## Rapid round A: coverage math (10)

| Kind | Tier | Rule | Wrong options |
| --- | --- | --- | --- |
| Deductible | ½ | Agreed repair − collision deductible | Forgot the deductible; added it; took it twice; the deductible itself |
| Liability limit | ½ | Pay the property damage limit when damage exceeds it; no deductible on liability | The full damage; the excess over the limit; the midpoint |
| Actual cash value | ½ | Replacement cost × (1 − depreciation %) | Replacement cost; the depreciation amount; % read as dollars |
| Rental | ½ | min(days, max days) × min(rate, daily cover) | Uncapped invoice; max × cover; the other cap missed |
| Custom equipment | 1 | Deductible off the loss first, then the limit (stated on the exhibit as Kestrel's rule) | Limit − deductible; loss − deductible when capped; limit or loss |
| Repair or total loss | 1 | Estimate ≥ threshold % × ACV → ACV − deductible, else estimate − deductible. Never within 3% of the line | The other branch; ACV or estimate with no deductible |
| Two coverages | 1 | (Hail − comprehensive deductible) + rental owed | Uncapped rental; no deductible; rental left out |

## Section 2: coverage check (20)

Twelve claims: claim, date and time of loss, driver (with relationship), vehicle (with purchase date when not on the policy), loss, policy number and period, listed and excluded drivers, vehicles, coverages with deductibles and rental, policy status, prior claims. The header is Kestrel's policy excerpt and card.

| Finding | Points | Rule (header) | Expected flag |
| --- | --- | --- | --- |
| Loss outside the policy period | 3 | Coverage runs from 12:01 a.m. standard time on the effective date to 12:01 a.m. on the expiration date | The row: a loss late the evening before a new policy starts, or later on the day it expired unpaid |
| Excluded driver | 3 | Nothing is covered while a named excluded driver is driving | The row whose driver is on its own excluded list |
| Vehicle outside the newly acquired window | 3 | A vehicle bought in the policy period is covered automatically for N days, then only once added | The row whose unlisted vehicle was bought more than N + 2 days before the loss |
| Coverage not bought | 3 | Collision vs. comprehensive, defined in the header (hitting an animal and glass are comprehensive) | The row whose loss needs a coverage the policy doesn't carry |
| Loss during a lapse | 3 | Cancelled for non-payment and reinstated later: no cover in between unless reinstated with no lapse | The row named in the supervisor's minute-4 correction; the loss falls between cancellation and reinstatement |
| Loss already paid | 3 | One loss is paid once | The row whose prior claim has the same date, vehicle and loss |
| Decision | 2 | Coverage questions go to the supervisor before anyone discusses payment | "Send the flagged files to the supervisor before anyone talks to those policyholders about payment" |

Clean look-alikes on every seed: a loss between 12:05 and 12:55 a.m. on a new policy's effective date (covered); a vehicle bought inside the window and not yet added; a permissive driver (friend, neighbour or coworker) who is neither listed nor excluded; a reinstatement with no lapse (sometimes dated after the loss, exactly like the lapse row before the correction); a prior claim on the same vehicle on another date. Other rows sometimes name an excluded driver who isn't driving, or carry only the coverage their loss needs.

Wrong decisions: deny the flagged claims yourself, pay and sort out coverage afterwards, ask the policyholders whether the loss date could be moved inside the policy.

## Rapid round B: claim deadlines (10)

Each exhibit gives the notice date, the task, the card rule, what business days are, and the Kestrel (federal) holidays in the window. Easy (½): five business-day counts that start Monday to Thursday and cross no holiday, five calendar-day status letters (rolled forward off a weekend or holiday). Hard (1): business-day counts that start on a Friday or cross a federal holiday. Wrong options: forgot the holiday, counted calendar days, counted the notice day, one business day late, a week late; for status letters, the unrolled date, rolled backward, counted business days.

## Section 4: estimate review (20)

Ten estimate lines (line, operation, description, part type, quantity or hours, price or rate, shop amount); the candidate enters each line's allowable (1.5 each), the repair payment after the deductible (3) and the rental owed (2). The card is in the prompt.

| Line | Rule | Allowable |
| --- | --- | --- |
| Labour above the approved rate (body, refinish or mechanical, seeded) | Pay hours at the lower of the shop's and the approved rate | Hours × approved rate |
| OEM part with an A/M quote | On a vehicle more than N model years old, allow the A/M quote | The A/M quote |
| Prior damage | The photo notes say the panel's dent is old and rusted | 0 |
| Repeated line | Each operation is paid once; allow 0 on the repeat | 0 on the second copy |
| Look-alikes | OEM part with no A/M made; two labour lines at or below the rate; a repair on the panel the photos call fresh; sublet alignment; paint and materials; an A/M part | As billed (labour: hours × shop rate) |

Repair payment = allowed lines + the minute-4 supplement (an A/M bumper energy absorber) − the collision deductible from the declarations. Rental = min(invoice days, max days) × min(invoice rate, daily cover); the invoice always runs past the maximum, and its rate is sometimes above the daily cover.

## Rapid round C: statements (10)

Each exhibit has the policyholder's account, the other driver's or a witness's, and one file fact (police report, tow log, 911 record, or a phone GPS log in UTC). Options: consistent (carry on), inconsistent (note it and refer to the supervisor), need the time from the policyholder, need the place. The round's intro gives the tolerances: 30 minutes, half a mile, 1 mile = 1.609 km. A mismatch is evidence for a referral, never a denial; there is no "deny" option.

Easy (½): three consistent, three inconsistent (time 60 to 150 minutes off, date a day off, another landmark or 1.5+ miles off), two missing the time, two missing the place. Hard (1): the file fact needs a conversion: a UTC time with its offset, or kilometres. Consistent after converting (the raw numbers look wrong), or inconsistent after converting (the raw digits match: "4 km" against "4 miles", or a UTC clock that reads like the local time). Near-misses are kept out: times are within 20 minutes or at least 45 apart; distances within 0.05 miles or at least a mile apart.

## Section 6: claims desk (30)

**Total loss (8, 180 s).** Three comparables (price, miles, condition). Card: a dollar amount per 1,000 miles of difference (added when the comparable has more miles) and per condition grade (subtracted when the comparable is better). Adjusted values 1.5 each, the average to the cent 1.5, the payment after the collision deductible 2. Tax, title and fees are stated as paid separately.

**First day (6, 120 s, ordering).** Six actions on a new claim: open the file and search prior claims; confirm the policy was in force and carries the coverage; call the policyholder to acknowledge and take the statement; book the inspection; review the estimate; discuss payment within authority. The prompt states Kestrel's rules, which fix that order. Pairwise 4, position 2. The shown order is seeded and never the answer.

**Authority (6, 90 s).** A payment request with the file's facts on fixed lines (amount, authority, coverage, photos, claimant, fraud indicators). Right answer: send to the supervisor if over authority, represented, a fraud indicator or a coverage question; else ask for the missing photos; else pay. About a quarter each of pay, over-authority, referral and missing photos. Always-wrong option: split it into two payments under the authority.

### Values calls (2 each, 66 s each)

| Step | Tag | Situation | Right | Wrong (shortcut / people-pleasing / over-escalation) | Grounding |
| --- | --- | --- | --- | --- | --- |
| `values-integrity` | integrity | Estimator asks for two extra labour hours and offers a referral fee to a personal account | Decline the fee, allow only the hours the photos support, tell the supervisor today | Allow the hours but decline the fee; take the fee; cut off the shop and report it to the state fraud bureau yourself | Kickbacks and padding are insurance fraud; carriers route suspicions through the special investigations unit (Kestrel's card) |
| `values-in-lane` | in-lane | Letter of representation, then the claimant phones the candidate | Say politely you'll deal through their lawyer, note the call, tell the supervisor | Quote a figure; suggest settling without the lawyer; hang up and send the file to legal | Carrier practice: once represented, all contact goes through counsel; the letter asks for it |
| `values-candor` | candor | The fellow trainee heard the candidate quote the wrong (lower) deductible yesterday | Call the policyholder today, correct it, apologise, note the file, tell the supervisor | Leave it to the payment letter; pay with the wrong deductible; send correction letters to everyone this month | Misrepresenting policy terms is an unfair claims practice; fix it before the payment goes |
| `values-client-care` | client-care | Distressed policyholder asks "am I covered?" before coverage is verified | Promise a coverage answer today with a call-back time; help with the tow and getting home now | "Yes, you're covered"; "probably not"; "nothing until the supervisor reviews it" | No misrepresentation of coverage; prompt, fair handling of the policyholder |
| `values-quality` | quality | Supervisor's month-end push; the fellow trainee closes files without the required photos | Close only files with photos; request the rest; tell the supervisor which won't close | Close now, photos later; reuse another claim's photos; refuse the push and complain to the VP | Kestrel's card requires photos before closing; the push is from a superior |

Open product questions: whether values points should count in the 100 or sit beside it, and whether companies can pick their own values.

## Scoring

| Step | Points |
| --- | --- |
| Three rapid rounds | 10 each (30) |
| Coverage check | 6 × 3 + decision 2 = 20 (false flag −1) |
| Estimate review | 10 × 1.5 + 3 + 2 = 20 (money tolerance $0.01) |
| Total loss | 3 × 1.5 + 1.5 + 2 = 8 |
| First day | 4 pairwise + 2 position = 6 |
| Authority | 6 |
| Values calls | 5 × 2 = 10 |
| **Total** | **100** |

## What the tests prove (200 seeds)

- Every task is solved from the rendered screen with the test's own reading of the cards (dates parsed and weekday-checked, money parsed, the minute-4 messages applied) and matches the server key.
- Perfect attempt 100, blank 0, maximum 100 on every seed; another seed's perfect answers average under 40.
- Each coverage trap costs 3, half with the wrong reason; each clean look-alike flagged costs 1; each wrong decision costs 2. Each estimate trap paid as billed costs 1.5; the supplement left out costs 3; the uncapped rental 2. Total-loss, ordering, authority and values items cost their points.
- Every rapid item has exactly one right option; hard items sit in slots 3, 6, 9, 12, 15; the right option's place varies.
- No finding note and no computed allowable, payment or valuation appears in the payload in any form.
- Sections validate, desk screens sum to 720 s, every message points at a real step, the minute-4 messages arrive on time, the cast has five role lines and the lawyer writes once.

## Judgment calls for review

Domain sources relied on (from general references, not re-verified against a primary text for this draft; a practitioner should confirm):

1. **Policy period** at 12:01 a.m. standard time at the policyholder's address: ISO Personal Auto Policy (PP 00 01) declarations. Some carriers print the period differently.
2. **Collision vs. other than collision**: PAP Part D, where contact with a bird or animal and glass breakage are "other than collision". Glass sometimes pays under collision at the insured's option; not tested.
3. **Newly acquired vehicle**: the PAP's automatic period is 14 days (with different rules for physical damage when no other vehicle carries it). Kestrel's card simplifies to one window of 14 or 30 days. Confirm the simplification is acceptable.
4. **Named driver exclusions**: allowed in most states with varying wording and some states restrict them; here they're Kestrel's endorsement.
5. **Reinstatement with or without a lapse**: carrier and state practice; written as Kestrel's rule.
6. **Deadlines**: state unfair claims practices rules (NAIC Model Unfair Claims Settlement Practices Act and Regulation, e.g. 15 days to acknowledge) vary by state, so all deadlines are on Kestrel's card and are stricter internal standards. Federal holidays are used as Kestrel holidays.
7. **Total-loss threshold** (70 to 80% of ACV) and settlement from comparables with mileage and condition adjustments: state total-loss laws and valuation rules vary widely; tax, title and fees left out (stated as paid separately).
8. **Actual cash value as replacement cost less depreciation**: one of several measures (others: market value, broad evidence rule). Stated on the card.
9. **Aftermarket parts** for vehicles over a model-year age: several states regulate aftermarket parts and require disclosure; written as Kestrel's policy.
10. **Labour rates**: "approved rate" is a simplification of prevailing-rate surveys; some states restrict this.
11. **Custom equipment**: the deductible-then-limit rule is stated on the exhibit as Kestrel's; policy wording varies.
12. **Represented claimants**: the duty not to contact a represented person directly binds lawyers (ABA Model Rule 4.2); for adjusters it's carrier practice and some state rules. Framed as the lawyer's request plus Kestrel's card.
13. **Estimate layout** is simplified: each line is either a part, a labour operation, sublet or materials, rather than a part price plus labour hours on one line with category totals, as CCC or Mitchell print it. A practitioner may want the real layout.
14. Comparative fault and injury claims are left for a senior simulation.

Step types wished for: none required. A spreadsheet input that accepts a short text (a reason per estimate line) would let the report show why a candidate cut a line, not just the amount.
