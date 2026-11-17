# Immigration paralegal: H-1B petition packet

Status: **draft: team self-review pending.** Version 1. Published to the cloud library as v1 on 2026-11-17 for the team's own testing; fixes from the review ship as v2.

| | |
| --- | --- |
| Slug | `immigration-h1b-packet` v1 |
| Role family | `legal` |
| Time | 50 minutes, six timed sections |
| Points | 100, all scored automatically (no reviewer step) |
| Code | `src/lib/engine/scenarios/immigration-h1b-packet.ts` |
| Shared helpers | `src/lib/engine/scenarios/legal/` (business days and federal holidays, name pools) |
| Tests | `tests/engine/immigration-h1b-packet.test.ts` |

## Setup

The candidate is an immigration paralegal at a law firm (seeded from the shared pool of fictional firms), working for an attorney on an H-1B extension of stay for a worker at a fictional employer. The agency and its forms are fictional but modelled on the real process: Form P-129 (the petition), Form WA-9035 (the certified wage attestation), Form A-28 (attorney appearance), the AR-94 arrival record and N-797 notices. Every rule the candidate applies is stated in the exhibit; the intro says the rules are the firm's working rules for the exercise and that the attorney, not the paralegal, gives legal advice.

Seeded per attempt: firm, employer, every person, citizenship and document language, job title, occupation code, wage level and wage, every date, the employee count (fee tier), which detail or tab carries which trap, the order of the packet tabs, which three items the RFE asks for, and where each right option sits.

## Sections and timing

| # | Section | Minutes | Steps | Points |
| --- | --- | --- | --- | --- |
| 1 | Rapid round: status and date math | 6 | `rapid-status` (15 × 20 s) | 10 |
| 2 | Forms cross-check | 10 | `forms-consistency` (`document_review`, 14 details × 4 documents) | 20 |
| 3 | Rapid round: document and process terms | 6 | `rapid-terms` (15 × 20 s) | 10 |
| 4 | Packet checklist | 10 | `packet-checklist` (`document_review`, 12 tabs) | 20 |
| 5 | Rapid round: deadlines | 6 | `rapid-deadlines` (15 × 20 s) | 10 |
| 6 | Inbox (one screen at a time) | 12 | `inbox-rfe` 300 s, `inbox-backdate` 210 s, `inbox-beneficiary` 210 s | 12 + 10 + 8 |

Rapid rounds: items 3, 6, 9, 12 and 15 are the harder kinds and worth 1 point; the other ten are worth ½.

## Rapid round A: status and date math (10)

Each item shows the rule, two facts and either four dates or a number field.

| Kind | Tier | Per round | Rule stated | Trap |
| --- | --- | --- | --- | --- |
| Filing window | ½ | 3 | File no earlier than 6 months before the start date (same day of the month) | 180 days, 3 or 5 months, off by a day |
| Arrival record | ½ | 3 | Approved end + 10 days, never past passport expiry | Forgetting the 10 days |
| Grace period | ½ | 2 | 60 days after the last day of work or until the arrival record ends, whichever first | 59 days, 30, 90 |
| Extension filing | ½ | 2 | Firm files no later than 45 days before the arrival record ends | Counting from the approved end date |
| Arrival record capped by passport | 1 | 1 | Same rule; the passport expires first | Adding 10 days anyway |
| Grace capped by the arrival record | 1 | 1 | Same rule; the record ends first | Adding 60 days anyway |
| Six-year limit | 1 | 1 | 6 years from the first start, plus one day per full day outside | Ignoring or subtracting recaptured days |
| Extension years (number, slot 6 or 12) | 1 | 1 | Whole years, up to 3, not past the six-year limit | Answer 1–3 |
| Recaptured days (number, slot 6 or 12) | 1 | 1 | Full days outside; departure and return days don't count | Answer 2–6 |

## Section 2: forms cross-check (20)

A grid of 14 details (names, date of birth, citizenship, passport number and expiry, job title, occupation code, wage level, wage, start, end, worksite, hours) across the petition, the passport, the job offer letter and the certified wage attestation. The footnote states the rules: identity details come from the passport; job details must match the certified attestation; the petition's period must sit inside the attestation's validity.

| Finding | Points | Where (seeded) | Expected reason |
| --- | --- | --- | --- |
| Identity | 4 | Family or given name with two letters swapped, date of birth or passport expiry with day and month swapped (or a year off), passport number with two digits swapped | Doesn't match the passport |
| Job | 3 | Job title or occupation code on the petition | Job title or code doesn't match the attestation |
| Wage | 4 | Lower wage on the petition or the letter, or another wage level on the petition | Wage or wage level doesn't match |
| Dates | 3 | Petition starts before, or ends after, the attestation's validity | Outside the validity period |
| Worksite | 4 | Petition or letter names an address the attestation doesn't cover | Worksite isn't on the attestation |
| Decision | 2 | "Hold the filing: send the attorney the list, get corrected documents from the employer through the attorney…" | |

Look-alikes that are right: the passport prints names and citizenship in capitals and dates day first (07 MAR 1994) while the petition is month first (03/07/1994); a petition start a few days after the attestation begins. Half points for the right row with another reason; −1 per false flag.

## Section 4: packet checklist (20)

Twelve tabs in a seeded order, each with the checklist item, the requirement and what's in the packet. Header fields give the employer, its U.S. employee count and the filing date.

| Finding | Points | Where (seeded) | Expected reason |
| --- | --- | --- | --- |
| Missing | 4 | Arrival record, credential evaluation, pay statements or prior approval notices: "Not in the packet" | Missing from the packet |
| Unsigned | 4 | Form A-28 employer line, Form P-129 or the support letter | Not signed |
| Fee | 4 | One check that uses the wrong training-fee tier, omits the anti-fraud fee or omits the training fee ($780 + $500 + $750 or $1,500 at 26+ employees) | Wrong fee amount |
| Translation | 3 | Degree or experience letters in the beneficiary's language with no certified translation (the other one is in English or translated) | Needs a certified English translation |
| Not valid | 3 | Wage attestation "certification pending", or a copy of a previous, expired passport | Expired, pending or not valid on the filing date |
| Decision | 2 | "Hold the packet: send the attorney the list, get the missing and corrected items…" | |

## Rapid round B: document and process terms (10)

Thirteen easy kinds (½ each, ten drawn): petitioner, beneficiary, receipt notice, RFE, certified translation, credential evaluation, prevailing wage, Form A-28, arrival record, premium processing, specialty occupation, approval notice, consular processing. Six hard kinds (1 each, five drawn): worksite move needs a new attestation and amended petition, public access file, extension of stay, passport expiring before the end date limits the stay, cap-subject, a late RFE response lets the agency decide on the record.

## Rapid round C: deadlines (10)

Each entry gives the event, its date, the rule and the federal holidays in the window (shared calendar). Business days exclude weekends and federal holidays.

| Kind | Tier | Per round | Rule |
| --- | --- | --- | --- |
| RFE response, plain | ½ | 4 | 87 days after a mailed notice, 84 after an online one; must arrive by then |
| RFE response, weekend | ½ | 3 | A due date on a weekend doesn't move: the last business day before it |
| Motion to reopen, plain | ½ | 2 | 33 days after a mailed decision |
| Posting, plain | ½ | 1 | 10 business days, the first day counts as day 1 |
| RFE response, holiday | 1 | 1 | Rolling back passes a holiday |
| Motion to reopen, rolled | 1 | 1 | Last day on a weekend or holiday moves forward (the opposite direction to the RFE rule) |
| Posting with a holiday inside | 1 | 1 | The holiday isn't a business day |
| Premium processing | 1 | 1 | 15 business days after receipt, with a holiday in the span |
| Courier | 1 | 1 | 2 business days before the due date, across a weekend or holiday |

## Section 6: inbox (30)

| Step | Points | Right answer |
| --- | --- | --- |
| `inbox-rfe` (multi-select) | 12 | The attorney's email lists the three items the RFE asks for (seeded from six). Right: the cover letter indexing each item to its tab, the RFE notice on top, and the one document that answers each requested item. Wrong: documents for items not asked for, the whole client file, the beneficiary's bank statements. Scored right/(right options) − wrong/(wrong options), floored at 0. |
| `inbox-backdate` | 10 | The HR manager asks for the job letter redone with an earlier date "so it looks like the offer went out before we filed", kept between them. Right: don't prepare it, tell HR you can't put a false date on a document, forward the request to the attorney right away. |
| `inbox-beneficiary` | 8 | The beneficiary asks whether to travel home while the extension is pending and what you'd do. Right: say you can't give legal advice, the attorney will reply, pass the question on today. |

## Scoring table

| Step | Points |
| --- | --- |
| Rapid round A: status and date math | 10 |
| Forms cross-check | 20 |
| Rapid round B: document and process terms | 10 |
| Packet checklist | 20 |
| Rapid round C: deadlines | 10 |
| RFE response packet | 12 |
| Backdating request | 10 |
| Beneficiary's question | 8 |
| **Total** | **100** |

Tests (200 seeds): every task is solved from the rendered material with the tests' own reading of the stated rules and compared with the server key; a perfect attempt scores 100, a blank 0; each planted trap costs exactly its points (half for the right item with the wrong reason); each rapid item has exactly one right option; another seed's perfect answer averages under 40; no real form names (I-129, I-94, G-28, I-797, ETA-9035) or agency names appear on screen.

## Judgment calls for review

1. **Fictional forms, real-looking fees.** Form names are invented, but the fee schedule ($780 base, $500 anti-fraud, $750 / $1,500 training fee by employer size) mirrors the public schedule so the arithmetic feels real. It is stated in the checklist, so nobody needs to know it.
2. **Rules are stated, not recalled.** Grace period, 10-day arrival record, filing window and six-year recapture are simplified versions of the real rules, given on each item. The candidate is tested on applying a rule, not on immigration law.
3. **RFE due dates roll back, motions roll forward.** The RFE rule ("must arrive by; the date doesn't move") and the motion rule (next business day) are deliberately opposite, and each item states which applies. Reviewers may prefer a single direction.
4. **Firm practice deadlines** (extension 45 days before the record ends, courier 2 business days ahead) are the fictional firm's own.
5. **Inbox is multiple choice,** so the whole simulation scores automatically. The backdating step could later be an `inbox_reply` scored by rubric.
6. **Packet tabs are shuffled per seed** so the fee trap (always on the fee tab) isn't in the same place for everyone.
7. **The passport trap in the packet is a copy of a previous passport,** so the packet never contradicts the passport expiry shown in the forms cross-check.
8. **Number answers are single digits** (extension years 1–3, recaptured days 2–6), because the shared leak test also reads key numbers as cents.
9. Message senders are role lines ("Your supervising attorney", "HR manager at the employer", "The beneficiary") because message `from` fields aren't template-filled; bodies sign with the seeded names.
