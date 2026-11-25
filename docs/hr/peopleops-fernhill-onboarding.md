# People operations coordinator: Fernhill onboarding week

Status: **draft: practitioner review pending.** Version 1. Not on the publish allowlist (`src/lib/scenarios/publishable.ts`); it goes on after an HR practitioner (and employment counsel, see below) signs it off.

| | |
| --- | --- |
| Slug | `peopleops-fernhill-onboarding` v1 |
| Role family | `hr` |
| Time | 50 minutes, six timed sections |
| Points | 100, all scored automatically (no reviewer step) |
| Code | `src/lib/engine/scenarios/peopleops-fernhill-onboarding.ts` |
| Shared helpers | `src/lib/engine/scenarios/hr/names.ts` (48 + 48 fictional names); business days and federal holidays from `src/lib/engine/scenarios/legal/dates.ts` |
| Tests | `tests/engine/peopleops-fernhill-onboarding.test.ts` |

## Setup

The candidate is the people operations coordinator at Fernhill Outdoor Co., a fictional outdoor gear retailer with about 600 employees across its stores and a distribution center, in one U.S. state that follows the federal overtime rule (stated in the intro and on every timecard). Twelve people started in the last three weeks, payroll for the period that ended Saturday closes tomorrow, and offers are going out.

Cast (role lines fixed, names seeded): the HR manager (briefs, metrics; signs every policy), a recruiter (tracker fix, offer letter, spots the candidate's own error), a hiring manager in a hurry (store manager; asks about a leave, a backdate and an early start), the payroll specialist (change list and correction), and one new hire (a benefits question, then a harassment report made in confidence).

Seeded per attempt: every person, the store, the pay period and its holiday (a real federal holiday in 2026 to 2028), whether the holiday counts as a working day for proration, the handbook acknowledgement window (5, 7, 10 or 14 days), the PTO accrual rate, every salary, rate, hour and date, which hire, pay line and offer term carries which trap, the row order, and where the right option sits. Fernhill's handbook rules (benefits start, acknowledgement window, approvals, leave types, background check rule, proration, metric definitions) are invented and printed on each task; the federal rules are real.

## Sections and timing

| # | Section id | Section | Minutes | Steps | Points |
| --- | --- | --- | --- | --- | --- |
| 1 | `s-rapid-a` | Rapid round: onboarding dates | 6 | `rapid-dates` (15 × 20 s) | 10 |
| 2 | `s-work-1` | Onboarding file audit | 10 | `onboarding-audit` (`document_review`, 12 hires) | 20 |
| 3 | `s-rapid-b` | Rapid round: policy calls | 6 | `rapid-policy` (15 × 20 s) | 10 |
| 4 | `s-work-2` | Pay changes | 10 | `pay-changes` (`spreadsheet`, 8 lines) | 20 |
| 5 | `s-rapid-c` | Rapid round: applicant screening | 6 | `rapid-screening` (15 × 20 s) | 10 |
| 6 | `s-desk` | Desk, one screen at a time | 12 | `offer-check` 240 s, `hiring-metrics` 150 s, five values calls 66 s each | 12 + 8 + 10 |

Rapid rounds: items 3, 6, 9, 12 and 15 are the harder kinds and worth 1; the other ten are worth ½. Every item is a choice of four with a seeded exhibit. Mid-task messages arrive at minute 4 of sections 2 and 4.

## Rapid round A: onboarding dates (10)

| Kind | Tier | Exhibit | Rule | Wrong options |
| --- | --- | --- | --- | --- |
| Section 2 due | ½ ×3 | First day, closures | 3 business days after the first day (Mon → Thu) | calendar days, counting the first day, 4 business days, a week late |
| Benefits start | ½ ×3 | First day | 1st of the month after day 30 (first day = day 1) | 1st after the start, day 30 itself, day 31 |
| Handbook acknowledgement | ½ ×2 | First day, window | first day + N calendar days | ±1 day, N business days, a week late |
| PTO balance | ½ ×2 | Rate, periods, used | rate × periods − used | one period off, used added or ignored, half |
| Section 2 across a holiday | 1 ×2 | Closures list a federal holiday in the window | skip the closure | forgot the holiday (the main trap) |
| Benefits, start on a month's last day | 1 | First day on the 28th–31st | e.g. Jan 31 → day 30 is Mar 1 → Apr 1 | Mar 1 (treating day 30 as the start), Feb 1 |
| FMLA eligibility | 1 ×2 | Hire date, leave date, hours, employees within 75 miles | 12 months, 1,250 hours, 50 within 75 miles; at most one fails | the other three answers |

## Section 2: onboarding file audit (20)

Twelve hires, sorted by tracker start date: offer signed, start, Section 1, Section 2, documents (as recorded in the List A / List B / List C slots), background check cleared, handbook acknowledgement, notes. The header carries today's date, the I-9 timing, the closures, the acceptable documents excerpt, "employees choose their documents", the background check rule (clears on or before the start) and the acknowledgement window.

| Finding | Points | Expected flag |
| --- | --- | --- |
| Section 2 completed 4 to 6 business days after the start | 3 | "Section 2 later than 3 business days" |
| Section 1 signed the business day after the start | 3 | "Section 1 signed after the first day of work" |
| A List B document recorded in the List C slot (two List B, no List C) | 3 | "Not an acceptable document combination" |
| Background check cleared 1 to 5 days after the start | 3 | "Started before the background check cleared" |
| Acknowledgement received late, or still missing after the window | 3 | "Handbook acknowledgement overdue" |
| Note: the recruiter's welcome email asked the hire to bring named documents | 3 | "Hire was told which documents to bring" |
| Decision | 2 | Send the HR manager the list today and correct forward with signed, dated notes |

Clean look-alikes on every seed: Section 2 exactly on the third business day across the period's holiday; a single List A document; a check that cleared on the start date; an acknowledgement not yet due ("Not received"); a note that the recruiter sent the full list and the hire chose; and the hire whose start moved.

Mid-task (minute 4), the recruiter says one hire's start moved back a week and the tracker wasn't updated. Against the tracker's date that hire looks like a late Section 2 and a late check; against the real date the row is clean. Flagging it costs the false-flag penalty.

Wrong decisions: redate the late entries; email the hires asking for a U.S. passport (specifying documents again); leave the files because everyone has started.

## Rapid round B: policy calls (10)

| Kind | Tier | Right answer |
| --- | --- | --- |
| Overtime hours, non-exempt timecard with a 9 to 11 hour day | ½ ×3 | hours worked over 40 in the workweek; daily excess over 8 is the wrong option |
| Approvals matrix (seeded roles and PTO threshold) | ½ ×3 | the role on the matching row; "up to k days" includes k |
| Which leave applies (bereavement family list seeded) | ½ ×4 | bereavement only for a listed relative, else PTO; jury duty; FMLA for a serious health condition or a new child (employee shown eligible) |
| Holiday week | 1 ×2 | worked hours only: 8 holiday hours aren't hours worked |
| Exempt employee, 46 to 56 hours | 1 ×2 | 0 hours |
| Two-week pay period, one week over 40, total ≤ 80 | 1 | week 1 hours over 40; "over 80 in the period" gives 0 and is wrong |

## Section 4: pay changes (20)

Eight lines, one change each, in a seeded order; each line's gross pay is worth 2.5 (tolerance 2 cents). The sheet gives the period, the pay date, the holiday, and whether the holiday counts as a working day for proration (10 or 9 working days). Salaried staff are shown by annual salary; a period is 1/26 of it.

| Change | Expected gross |
| --- | --- |
| New hire (salaried), first day mid-period before the holiday | period salary × working days from the real first day ÷ working days. **Continuity:** the new hire is the one whose start moved in section 2; the change list still shows the tracker's date |
| Raise mid-period (salaried) | old rate for days before the effective date, new rate from it. Traps: the approval date, and the change list's effective date, which payroll corrects at minute 4 |
| Overtime (hourly) | hours × rate + 8 holiday hours + ½ rate × hours over 40 in each week; one 10+ hour day makes daily overtime wrong |
| Holiday week overtime (hourly) | the holiday week has 33 to 44 worked hours; holiday hours don't count toward 40 |
| Unpaid FMLA leave, 2 to 4 full days (salaried exempt) | period salary × (working days − leave days) ÷ working days (29 CFR 541.602(b)(7)) |
| Leaving, PTO payout (hourly) | hours to the last day + holiday pay only if employed on the holiday + PTO hours × rate (Fernhill pays out unused PTO) |
| Retroactive raise for the previous period (hourly) | this period at the new rate + (new − old) × last period's hours |
| Exempt employee who worked 48 to 56 hours | the period salary; no overtime |

## Rapid round C: applicant screening (10)

Each item: a requisition with three minimum qualifications (experience months, weekends, forklift certification with a date, driver's license, high school diploma or GED, register months) and four notes. Options: meets, does not meet, need more information, and a fourth "Does not meet: …" that relies on something that isn't a qualification. Any failed qualification → does not meet; otherwise any qualification with no note → need more information; else meets.

Easy items (10): the fourth option relies on a lawful but irrelevant fact (no college degree, commute distance). Hard items (5): a note carries a protected personal fact (plans to start a family, age 58 to 66, a gap for medical leave), and the fourth option relies on it. The right option never does.

## Section 6: desk (30)

### Offer letter vs. the approved requisition (12, 240 s)

Nine terms, seeded order, with the pay band, the background check order date and vendor turnaround in business days, and the handbook PTO and benefits rules in the header.

| Finding | Points | Reason |
| --- | --- | --- |
| Salary differs from the approval (always inside the band) | 2.5 | Doesn't match the approved requisition ("Outside the pay band" earns half) |
| FLSA status the opposite of the requisition's | 2.5 | Doesn't match the approved requisition |
| Start date before the check can clear (order date + N business days) | 2.5 | Starts before the background check can clear |
| Bonus target not approved | 2.5 | Doesn't match the approved requisition |
| Decision | 2 | Hold the letter and return it to the recruiter |

Clean: position, location, reports to, PTO (different wording, same hours), benefits. Wrong decisions: send it as is; fix it yourself and send; send now and correct after acceptance.

### Hiring metrics (8, 150 s)

Turnover rate (separations ÷ average of start and end headcount), average days to fill (five filled requisitions; a sixth is still open and is excluded), offer acceptance rate, cost per hire (four recruiting cost lines ÷ hires; orientation after the start date is excluded). 2 points each; percentages and days to one decimal, cost to the cent. Definitions are Fernhill's, printed on the sheet, following the usual SHRM formulas.

### Values calls (2 each, 66 s each)

| Step | Tag | From | Situation | Right answer and its basis |
| --- | --- | --- | --- | --- |
| `values-client-care` | client-care | Hiring manager | Asks why a team member is out six weeks | Only that they're on approved leave until a date, and help plan cover; the reason stays in the confidential file (ADA 42 U.S.C. 12112(d), 29 CFR 1630.14; FMLA 29 CFR 825.500(g); Fernhill's welcome note) |
| `values-integrity` | integrity | Hiring manager (pressure from a superior) | Date a Section 2 two days earlier | Don't backdate; keep the real date, attach a signed, dated note, tell the HR manager (USCIS M-274, correcting Form I-9) |
| `values-candor` | candor | Recruiter | Spots that the offer the candidate sent yesterday has the wrong salary | Own it: tell the HR manager today and work with the recruiter on a corrected, approved letter before signing |
| `values-in-lane` | in-lane | New hire | Harassment report, asks for secrecy | Can't promise secrecy; need-to-know only; take it to the HR manager today (Fernhill policy in the welcome note) |
| `values-quality` | quality | Hiring manager (pressure) | Start Monday before the check clears | Hold the start until it clears, tell the manager, chase the vendor (handbook §2.3) |

Wrong options in each: the helpful shortcut (hint it's medical, keep a private note, quietly resend, investigate yourself, paperwork-only shifts), the people-pleasing yes (share the details, change the date, wait and see, promise secrecy, agree to Monday) and the over-escalation (outside lawyers, report to immigration authorities, withdraw the offer, call the police, cancel the hire).

Open product questions: should values points count in the 100, or be reported separately? Should a company be able to choose its own five values tags?

## Scoring table

| Step | Points |
| --- | --- |
| Rapid round A: onboarding dates | 10 |
| Onboarding file audit | 20 |
| Rapid round B: policy calls | 10 |
| Pay changes | 20 |
| Rapid round C: applicant screening | 10 |
| Offer letter check | 12 |
| Hiring metrics | 8 |
| Five values calls | 10 |
| **Total** | **100** |

## What the tests prove (200 seeds)

Every task is solved from the rendered screen with the tests' own reading of the rules (their own business-day count over the listed closures, their own pay arithmetic, their own screening logic) and compared with the server key; a perfect attempt scores 100 and a blank 0 on every seed; each planted trap costs exactly its points, the right item with another reason earns half, and each false flag (including the moved hire and the same-day check) costs 1; every rapid item has exactly one right option and the hard slots are the hard kinds; each values call has four options with one right, in all four places across seeds; another seed's perfect answer averages under 40; no key note or computed pay or metric figure appears in the candidate's payload; sections validate and the one-at-a-time screens add up to 12 minutes; every date shown is in 2026 to 2028.

## Sources

- Form I-9 timing, acceptable documents and corrections: USCIS, *Handbook for Employers* (M-274), sections 2 to 4 and 13; 8 CFR 274a.2(b).
- Not specifying documents: 8 U.S.C. 1324b(a)(6) (document abuse); M-274 section 4.
- Overtime: FLSA, 29 U.S.C. 207(a); holiday and PTO pay aren't hours worked, 29 CFR 778.218–778.219; exempt salary deductions for FMLA leave, 29 CFR 541.602(b)(7).
- FMLA eligibility: 29 U.S.C. 2611(2); 29 CFR 825.110.
- Confidentiality of medical information: ADA, 42 U.S.C. 12112(d)(3)–(4); 29 CFR 1630.14(c); FMLA records, 29 CFR 825.500(g).
- Screening: Title VII and the Pregnancy Discrimination Act (42 U.S.C. 2000e(k)); ADEA (29 U.S.C. 623, 40 and over); ADA (42 U.S.C. 12112).
- Metric formulas: SHRM turnover and ANSI/SHRM cost-per-hire definitions, adapted as Fernhill's own definitions.

## Judgment calls for review

1. **U.S. federal content only.** The state is unnamed and follows the federal overtime rule; no daily overtime, no state paid leave, no state final-pay or PTO payout law. Needs employment counsel review and a jurisdiction note before any use elsewhere.
2. **Business days for Section 2.** USCIS counts days the employer is open for business. Fernhill's HR office is defined as open Monday to Friday and closed on the federal holidays, so stores open on weekends don't change the count. A reviewer should confirm this firm-policy framing reads naturally.
3. **Benefits rule wording.** "The 1st of the month after the employee completes 30 days (first day = day 1)" is Fernhill's; plans differ on whether day 30 or day 31 is the trigger. The hard item (start on a month's last day) depends on this wording.
4. **Section 1 after the first day** is keyed as a finding. Real files also see Section 1 on the first day itself (fine) and before it (fine once the offer is accepted); both appear as clean rows.
5. **List C slot holding a List B document** is how the "two List B" error is shown; a reviewer may prefer a different representation of the form.
6. **The recruiter's note** ("asked the hire to bring a U.S. passport") is keyed as a document-abuse risk even though the hire then brought an acceptable document. That's the point: the request itself is the problem.
7. **Proration by working days**, including the seeded rule for whether the holiday counts, is Fernhill policy. Many employers prorate by calendar days or by hours; the sheet states the rule.
8. **Holiday pay for hourly staff** (8 hours if employed on the holiday) and **PTO payout on leaving** are Fernhill policy, not federal law.
9. **Unpaid FMLA days for an exempt employee** are deducted by full days, which 29 CFR 541.602(b)(7) allows; the reviewer should confirm the wording "Unpaid FMLA leave: N full days".
10. **Screening round touches protected characteristics by design.** The notes are written as things an interviewer might record; a reviewer must check the wording, and whether showing them at all is acceptable in a hiring test.
11. **Salaried pay shown as annual only**, so the exempt employee's answer (one period's salary) never appears on screen; the leak guard requires it.
12. **Values calls are multiple choice**, so the whole simulation scores automatically; no `inbox_reply`.
13. Message senders are role lines because `from` isn't template-filled; bodies sign with seeded names.

## Step types wished for

None strictly needed. Two would help: a "date" answer field in `rapid_round` (so a date item could be typed instead of picked from four), and a per-variant `findings` subset in `document_review` (so the offer letter's traps could vary across seeds instead of always being salary, status, start and bonus).
