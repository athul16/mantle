# Personal injury paralegal: Diaz, intake to demand

Status: **draft: team self-review pending.** Version 1. Not published (`pnpm scenarios:publish` not run).

| | |
| --- | --- |
| Slug | `pi-diaz-demand` v1 |
| Role family | `legal` |
| Time | 50 minutes, six timed sections |
| Points | 100, all scored automatically (no reviewer step) |
| Code | `src/lib/engine/scenarios/pi-diaz-demand.ts` |
| Shared helpers | `src/lib/engine/scenarios/legal/` (court days, holidays, date formats, name pools) |
| Tests | `tests/engine/pi-diaz-demand.test.ts` |

## Setup

The candidate is a personal injury paralegal at a plaintiff's firm (seeded from the shared pool of fictional firms), working for a supervising attorney on the file of a client surnamed Diaz who was hurt in a car crash in the State of Calloway. Calloway, its limitations rules and its collateral source rule are invented and stated in the material. Calloway's court holidays are the real federal holidays, through the shared helper.

Seeded per attempt: the client's first name, every person, the firm, the at-fault driver's insurer, the health plan, each provider (from fictional pools), the date of loss, the course of treatment and its dates, every bill and payment, which two providers treat on a letter of protection, which bill is listed twice, which provider the demand letter leaves out, the wrong date in the letter, every rapid item and where each right option sits. No real billing code sets: bills carry plain descriptions. The only real form name is UB-04 (a public hospital claim form) in one rapid item.

## Sections and timing

| # | Section | Minutes | Steps | Points |
| --- | --- | --- | --- | --- |
| 1 | Rapid round: limitations and damages | 6 | `rapid-limitations` (15 × 20 s) | 10 |
| 2 | Medical chronology and gaps (one screen at a time) | 10 | `chronology` (`ordering`, 330 s), `treatment-gaps` (`document_review`, 270 s) | 10 + 10 |
| 3 | Rapid round: medical billing | 6 | `rapid-billing` (15 × 20 s) | 10 |
| 4 | Medical specials | 11 | `specials` (`spreadsheet`) | 20 |
| 5 | Rapid round: intake and ethics | 6 | `rapid-intake` (15 × 20 s) | 10 |
| 6 | Demand letter and inbox (one screen at a time) | 11 | `demand-review` (`document_review`, 420 s), `inbox-conflict` 120 s, `inbox-value` 120 s | 18 + 6 + 6 |

Every rapid round: items 3, 6, 9, 12 and 15 are the harder kinds worth 1, the other ten worth ½. Messages arrive when their section opens: the intake summary with the chronology, the bills note with the specials, the draft demand, the conflicts hit and the client's email with the last section.

## Rapid round A: limitations and damages (10)

The intro states the Calloway rules: personal injury 2 years, injury to property 3 years, a claim against a public entity presented within 180 days; years end on the same month and day; a minor's period in years starts on the 18th birthday; a last day on a weekend or court holiday moves to the next court day; modified comparative fault with a 51% bar.

Eight date items (choice of 4 dates) and seven amount items (to the cent), in fixed slots so a field's kind never hints at anything. Each date item shows the claim, the date of injury, the client's date of birth (so every item needs the age check), the rule, and the court holidays within 10 days of any option.

- Easy dates: plain 2-year personal injury (×2), 3-year property damage, a 2-year date on a weekend (×2).
- Hard dates: a minor (period starts on the 18th birthday), a public entity (180 days, not 6 months or 2 years), a last day moved by a holiday.
- Easy amounts: lost wages (hourly × hours × weeks, ×2), medical mileage, the total of three bills (×2).
- Hard amounts: comparative fault (sometimes the client is 55–65% at fault and recovers nothing), net to the client after fee, costs and the health plan lien.

Wrong dates are the mistakes a hurried calendar clerk makes: not rolling, rolling backward, the wrong period, ignoring a minor's tolling, 6 months instead of 180 days, rolling past a weekend but not the holiday.

## Section 2a: medical chronology (10)

The new `ordering` step: eight record sets (ED, primary care follow-up, MRI, orthopedic consult and follow-up, PT evaluation and discharge, and a pain management or neurology consult), each labelled with the provider and the record and a detail line "Received … · Date of service …". The course of treatment is a random order that respects real referral logic (ED first; consult before follow-up and before PT; PT evaluation before discharge; MRI before the orthopedic follow-up). Ordering shows items in config order, so the items are shuffled per seed; the tests check that neither the shown order nor the date-received order is ever the right one. The date of service comes in three formats (short, long, numeric). 5 points for items in place, 5 for pairs in order.

## Section 2b: treatment gaps (10)

A 16-row visit log (the eight visits above, seven PT sessions, and one visit before the date of loss) in date order. Rule in the prompt: flag a gap of more than 30 days between accident-related visits, and any visit that isn't accident treatment.

| Finding | Points | Reason |
| --- | --- | --- |
| First gap over 30 days (34–75 days) | 4 | gap |
| Second gap over 30 days | 4 | gap |
| Annual physical before the date of loss | 2 | pre_loss |

The flag may sit on either visit of a gap. Look-alikes: one near miss of 24–30 days (often exactly 30, which isn't "more than 30"), and the big jump from the pre-loss physical to the ED visit, which isn't a gap in treatment. The gaps never start at the ED visit and none of the three spans share a visit. False flags cost 1 each.

## Section 4: medical specials (20)

The worksheet lists ten invoices (invoice number, provider, date of service, description, billed, adjustment, plan paid, patient paid, source) and five cells to fill. The prompt states Calloway's (fictional) collateral source rule: the demand presents the full billed amount for accident treatment, each bill once.

| Cell | Points | Right answer |
| --- | --- | --- |
| Medical specials | 6 | Sum billed on the eight accident bills, each once |
| Health plan lien | 4 | Sum the plan paid on those bills |
| Letter-of-protection balances | 4 | Sum of billed − adjustment − plan paid − patient paid (non-zero only at the two LOP providers) |
| Out of pocket | 4 | Sum the client paid on those bills |
| Total liens | 2 | Health plan lien + LOP balances |

Traps and what each costs (tested over 40 seeds): the duplicate (the same invoice from the provider's statement and the plan's EOB, plan-paid with no copay) counted twice costs 12 (specials, plan lien, total liens); the self-paid annual physical from before the loss costs 10 (specials, out of pocket); using allowed amounts (billed − adjustment) instead of billed costs 6. Answers within half a cent count.

## Rapid round B: medical billing (10)

Ten of thirteen easy terms (billed charges, contractual adjustment, EOB, subrogation, letter of protection, ledger, HIPAA authorization, date of service, medical specials, balance billing, med-pay, records custodian affidavit, UB-04) and five of six harder items: three with seeded amounts (an account balance, a plan's reimbursement claim that excludes an unrelated checkup, the billed amount under the collateral source rule) and three judgment calls (who accepts a reduction, a duplicate counts once, a pre-loss bill stays out unless the attorney says otherwise).

## Rapid round C: intake and ethics (10)

Ten of eleven easy calls (only an attorney accepts a case or signs the fee agreement or the demand; no recorded statement to the adjuster; no contact with a represented driver; confidentiality with providers; preserving social media evidence; a signature that shows "Paralegal"; settlement checks go to the attorney for the trust account; no referral fees; what to collect at intake) and five of six harder ones (conflicts check for the other driver in the same crash; rent advances are for the attorney; conflicting dates of loss; never leave records out; runner solicitation; an adjuster's offer goes to the attorney).

## Section 6: demand letter and inbox (30)

### Demand letter review (18)

A draft policy-limits demand to the insurer's adjuster: addressee, claim number, insured, client, date of loss, location, enclosures, six provider rows (dates of treatment, billed) and totals (medical specials, lost wages, demand). The prompt lists the bills in the file by provider (accident-related, each once) with no grand total.

| Finding | Points | Reason |
| --- | --- | --- |
| Date of loss 1–9 days off the intake summary | 5 | wrong_date |
| Specials total doesn't add up: the listed rows plus the duplicate bill again | 5 | math |
| A provider left out of the rows and the enclosures | 5 | missing (on the enclosures field) |
| Decision: hold it and send the attorney the problems and a corrected draft | 3 | |

Look-alikes that are right: every listed amount matches the bills, the lost wages match the intake, the claim number and parties match. The other decisions (send today, fix and sign it yourself, send without the bills) score 0. False flags cost 1.

### Inbox (6 + 6)

- Conflicts check: the at-fault driver's insurer, which would pay any settlement, is a current client of the firm. Right: stop and take it to the attorney, who decides whether the firm can act against a current client and with whose consent. Wrong: no conflict since the insurer isn't a named party; send the demand and copy the insurance defense group (a confidentiality breach too); ask the insurer whether it minds.
- The client asks what the case is worth. Right: you can't give a value (legal advice) and you set up a call with the attorney. Wrong: three times the bills, the cousin's amount, the policy limits.

## Scoring table

| Step | Points |
| --- | --- |
| `rapid-limitations` | 10 |
| `chronology` | 10 |
| `treatment-gaps` | 10 |
| `rapid-billing` | 10 |
| `specials` | 20 |
| `rapid-intake` | 10 |
| `demand-review` | 18 |
| `inbox-conflict` | 6 |
| `inbox-value` | 6 |
| **Total** | **100** |

The tests solve every task over 200 seeds from the rendered material (the candidate's screen, messages and rapid items) and compare with the key; a perfect answer scores 100 and a blank one 0; each trap costs its points; the candidate's DOM never holds a key value or note.

## Judgment calls for review

- **Collateral source rule.** Calloway's rule (full billed amounts in the demand) is stated, not assumed; real states differ (billed vs paid). A buyer in a paid-amount state may want a variant.
- **"Medical specials" excludes the pre-loss physical outright.** In practice the attorney may decide some pre-loss treatment is related (aggravation). The prompt and the rapid item both say it stays out unless the attorney decides otherwise.
- **The duplicate bill's cost is 12 of 20.** Counting a bill twice moves three linked cells; scoring is per cell, so the trap is expensive. Lower the specials cell or make total liens 0 points if that feels too heavy.
- **Ordering points split 5/5** between exact positions and pairwise order, so sorting by date received earns a little from chance pairs, and one swap of neighbours costs about 1.4.
- **Gap rule "more than 30 days".** The near miss is often exactly 30 days. Some firms use 30 days or more; the rule is stated in the prompt.
- **The conflict scenario** treats an insurer that will pay the settlement as a party whose interests are adverse, so it needs an attorney's decision. Whether it's a true conflict depends on the jurisdiction and the engagement; the question is about escalation, not the answer to the conflict.
- **Lost wages and policy limits** are shown but not tested, as look-alikes.
- **R1 dates.** Injury dates are drawn so every last day falls in 2026–2028, the years whose holiday tables the legal helpers verify.
