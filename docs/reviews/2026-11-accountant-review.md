# Accountant review pack, November 2026

Three accounting simulations are waiting for an accountant's sign-off before any company can use them:

1. **Harbor Lane Coffee: October bank reconciliation** (`harbor-lane-bank-rec`, 30 minutes)
2. **Calder & Finch: Bluestem Manufacturing year-end audit** (`audit-calder-bluestem`, 52 minutes)
3. **Ridgeway Outdoor Supply: AP payment run** (`corporate-ap-ridgeway`, 52 minutes)

## Note for the reviewer

**What the product is.** A hiring assessment for accounting roles. A candidate gets an invite link, works through a timed, realistic workday (emails from a manager, a workbook, documents to check, quick-fire rounds), and the hiring company gets a scored report. Most answers are marked automatically against an answer key. Written replies (emails) are marked by a person at the hiring company using the rubric in this pack.

**How variants work.** Every candidate gets a different version of the same simulation. The numbers differ (amounts, check and invoice numbers, dates, names, and which document holds which trap), but the rules, the traps and the expected treatment don't. The answer key is built from the same numbers the candidate sees, so it always ties. A "seed" is the code that fixes one candidate's version. This pack uses seed `abc` for every worked example, so you can follow one consistent set of numbers. If you approve a rule here, you approve it for every variant.

**What "draft: needs accountant review" means.** The simulations are built and tested (the numbers tie for hundreds of seeds, every trap scores as intended), but nobody with an accounting qualification has checked that the expected answers, the accounts used and the judgment calls are right. That check is this review. `docs/07-accounting-simulations.md` marks each one as a draft.

**v1 is already published for testing** (2026-11-17), so the team can take each simulation on the live site while reviewing. Published rows are frozen: anything marked "change" or "reject" is fixed in a new version, which is published after sign-off.

**How to review.** Each simulation below has the setup, the timeline, every trap with its expected answer and the rule behind it, the judgment calls the authors flagged, the scoring, and a sign-off table at the end. In the sign-off tables, write **approve**, **change** or **reject** in the middle column and anything you want changed in the note column. Where the expected answer is defensible but not the only acceptable one, say whether the alternative should also get credit.

**Two answers are being changed right now** (marked "changing in PR: switch to new step types"): the audit's pass/propose call becomes a multiple-choice question, and the AP clean match becomes a "Nothing wrong here" confirm. They are described here in their new form. The accounting answer doesn't change, only how the candidate gives it.

---

## 1. Harbor Lane Coffee: October bank reconciliation (30 minutes, 100 points)

### Setup

- **Role:** new staff accountant at Oakline CPA Group (an accounting firm).
- **Client:** Harbor Lane Coffee Co., operating account at Piedmont Community Bank, checking ending 4471.
- **Situation:** the senior, Dana Ruiz, needs the October bank reconciliation, the journal entries to fix the client's books, and a short reply before her 10 AM client call. September's rec was clean, so nothing carries over. At minute 12 Dana sends an update: a check in the books was voided.

### Timeline

This one has no timed sections and no rapid rounds. All three tasks are open for the whole 30 minutes.

| Minute | What arrives | What the candidate does |
| --- | --- | --- |
| 0 | Dana: "Harbor Lane: October bank rec" (greets the candidate by first name) | Fills in the reconciliation under a read-only bank statement and GL cash account; drafts journal entries; replies to Dana |
| 12 | Dana: "RE: Harbor Lane: one more thing". Check #2339 (seed `abc`) to Office Depot for $181.01 was voided; never mailed, still in the books, originally booked to Office Supplies Expense | Should add the check back on the book side and not list it as outstanding |
| 30 | Time ends | |

### Worked example (seed `abc`)

Bank statement ends at **$21,662.78**. GL cash (1010) ends at **$24,866.53**.

| Planted item | What the candidate sees | Expected answer | Rule it relies on |
| --- | --- | --- | --- |
| Deposit in transit | 10/31 GL deposit $3,997.67, not on the bank statement | Bank side, add $3,997.67 | Receipts recorded in the books but not yet credited by the bank are added to the bank balance |
| Outstanding check | Check #2341 Cardinal Linens $890.77 (10/30) in the GL, not on the bank statement | Bank side, less $890.77 | Checks issued but not yet cleared are deducted from the bank balance |
| Bank service fee | 10/31 "Monthly service fee" $37.28 on the bank statement only | Book side, less $37.28 | Bank charges the company hasn't recorded reduce book cash |
| NSF customer check | 10/24 "Returned item: NSF, Maple St. Bakery" $345.03 on the bank statement only. The check was in the 10/22 deposit | Book side, less $345.03 | A returned customer check reverses the cash receipt; the customer owes the money again |
| Interest earned | 10/31 "Interest earned" $14.45 on the bank statement only | Book side, add $14.45 | Interest credited by the bank and not yet recorded increases book cash |
| Check recorded at the wrong amount | Check #2336 Coastal Roasters cleared at $3,677.41, booked at $3,767.41 (hundreds and tens digits swapped) | Book side, add $90.00 (books overstated the payment) | A book error is corrected on the book side; a transposition difference is divisible by 9. In other seeds the books understate the check and the correction is a deduction |
| **Minute-12 update** | Check #2339 Office Depot $181.01 voided | Book side, add back $181.01; not an outstanding check | A voided check never left the company; the payment entry is reversed |

Expected reconciliation:

| | Amount |
| --- | --- |
| Balance per bank, Oct 31 | 21,662.78 |
| Add: deposit in transit | 3,997.67 |
| Less: outstanding check #2341 | (890.77) |
| **Adjusted bank balance** | **24,769.68** |
| Balance per books, Oct 31 | 24,866.53 |
| Add: interest earned | 14.45 |
| Add: voided check #2339 | 181.01 |
| Less: bank service charge | (37.28) |
| Less: NSF check, Maple St. Bakery | (345.03) |
| Add: correction, check #2336 | 90.00 |
| **Adjusted book balance** | **24,769.68** |

**Missed-update trap.** A candidate who ignores the minute-12 email lists #2339 as outstanding and leaves it out of the book side. Both sides then tie at **$24,588.67**, so the rec still balances. The scoring catches this: the "cancelled checks" cell is 10 points and the outstanding-checks cell is wrong too.

Expected journal entries (one per item, from a fixed chart of 10 accounts):

| Entry | Debit | Credit | Amount |
| --- | --- | --- | --- |
| Bank fee | 6200 Bank Service Charges | 1010 Cash | 37.28 |
| NSF check | 1200 Accounts Receivable (Maple St. Bakery) | 1010 Cash | 345.03 |
| Interest | 1010 Cash | 7100 Interest Income | 14.45 |
| Check #2336 error | 1010 Cash | 5100 Cost of Goods Sold (2000 Accounts Payable also accepted) | 90.00 |
| Voided check #2339 | 1010 Cash | 6100 Office Supplies Expense | 181.01 |

Net change to cash: −96.85 (24,866.53 to 24,769.68).

**Reply to Dana (human-reviewed, 40 points).** States $24,769.68 up front and that bank and book agree; flags the $345.03 NSF from Maple St. Bakery for follow-up and the $90.00 error on check #2336; confirms the voided check was reversed and isn't outstanding; under about 150 words; professional, with greeting and sign-off.

### Judgment calls

docs/07 has no separate judgment list for this example. These are the calls in its text and its "accepted for v1" notes:

- Accounts payable is accepted instead of Cost of Goods Sold for the check-error entry, without the candidate explaining that the check paid a booked invoice (the journal step can't read a memo).
- The reconciliation template has a fixed row per item type (interest, cancelled checks, fees, NSF, book errors), so the row labels hint at what to look for.
- Cells score all-or-nothing: a candidate who misses the update loses both the 10-point voided-check cell and the 5-point outstanding-checks cell (25 of 45 on the rec).
- The NSF check goes back to Accounts Receivable (not bad debt or a separate returned-checks account).
- The voided check is reversed to the account it was originally booked to (Office Supplies Expense), in October.

### Scoring (100 points)

| Part | What earns points | Points | Marked by |
| --- | --- | --- | --- |
| Reconciliation: deposit in transit, outstanding checks | 5 each | 10 | Automatic |
| Reconciliation: interest, fee, NSF, book error | 5 each | 20 | Automatic |
| Reconciliation: voided check added back (the update) | | 10 | Automatic |
| Reconciliation: adjusted bank and adjusted book balance | 2.5 each | 5 | Automatic |
| Journal entries | 5 entries × 3, correct accounts, amounts, balanced | 15 | Automatic |
| Reply: states the adjusted balance up front | | 10 | Reviewer |
| Reply: flags the NSF and the check error | | 10 | Reviewer |
| Reply: confirms the voided check was handled | | 5 | Reviewer |
| Reply: short and organized (under ~150 words) | | 10 | Reviewer |
| Reply: professional, friendly tone | | 5 | Reviewer |
| **Total** | 60 automatic, 40 reviewer | **100** | |

The "bank errors" and "difference" rows are in the template but not scored.

### Sign-off: Harbor Lane

| Item | Approve / change / reject | Reviewer note |
| --- | --- | --- |
| Deposit in transit added to the bank side | | |
| Outstanding check deducted from the bank side | | |
| Bank fee deducted on the book side; entry Dr Bank Service Charges / Cr Cash | | |
| NSF check deducted on the book side; entry Dr Accounts Receivable / Cr Cash | | |
| Interest added on the book side; entry Dr Cash / Cr Interest Income | | |
| Transposed check corrected on the book side, either direction; entry against COGS | | |
| Judgment: Accounts Payable also accepted for the check-error entry, no explanation needed | | |
| Minute-12 update: voided check added back to books, not outstanding; entry Dr Cash / Cr Office Supplies Expense | | |
| Missed-update trap scoring (loses 15 of 45 on the rec) | | |
| Judgment: row labels on the rec template hint at the item types | | |
| Reply rubric (40 points, five criteria) and the 150-word guide | | |
| Timing: 30 minutes in all, update at minute 12 | | |

---

## 2. Calder & Finch: Bluestem Manufacturing year-end audit (52 minutes, 100 points)

### Setup

- **Role:** audit intern at Calder & Finch LLP (external audit firm).
- **Client:** Bluestem Manufacturing, year-end December 31, 2025. Fieldwork week.
- **Situation:** the senior, Marcus Avery, sends work through the session; the client's controller, Renee Okafor, gets in touch too. Six timed parts, three of them quick-fire rounds. Once a part ends the candidate can't go back to it.

### Timeline

| # | Section | Minutes | What the candidate sees | Message on arrival |
| --- | --- | --- | --- | --- |
| 1 | Rapid round A: tick and tie | 6 | 15 items × 20 s: a schedule line next to its source document | Marcus: warm-up while he pulls the sample |
| 2 | Expense vouching | 12 | Four screens, 3 minutes each, two sampled GL entries per screen with their support; conclusion on the sample after the last pair | Marcus: vouch the sample of 8 |
| 3 | Rapid round B: cutoff | 6 | 15 items × 20 s: a shipment near year-end with FOB terms and dates | Marcus: cutoff testing |
| 4 | Inbox | 10 | One screen at a time: reply to the controller (4 min), number of exceptions (1.5 min), total misstatement (1.5 min), bank confirmation (3 min) | Renee: "Can we skip this one?"; Marcus: how many exceptions, and the total; Marcus: bank confirmation is back, a difference |
| 5 | Rapid round C: sample selection | 6 | 15 items × 20 s: apply a selection rule, or find a missing check number | Marcus: sample selection |
| 6 | Summary and adjusting entries | 12 | Summary of misstatements with the pass/propose call, adjusting entries, email to Marcus | Marcus: materiality memo; draft the entries; summary for partner review |

Total 52 minutes. A rapid round's 15 items take 5 minutes inside its 6-minute section. The overall timer never pauses.

### Rapid rounds (30 points)

Each round is 15 items at 20 seconds each, with pick-one answers only. Items 1 to 5 are worth 0.5 and items 6 to 15 are worth 0.75, so each round is exactly 10 points. Where an item has two answers, each is half the item.

**A. Tick and tie.** Kinds, five of each: AP subledger vs vendor invoice, cash lead schedule vs bank confirmation, inventory receipts log vs receiving report. Answers: Agrees / Exception, and a reason (amount or quantity, date or cutoff, vendor or bank name, no support, N/A: agrees). Each candidate gets 5 that agree, 3 amount differences, 3 January-dated documents against a December schedule line, 2 lookalike names (Midland vs Midway Fastener) and 2 with the document "Not on file". Each exception differs in one row only.

- Seed `abc`, item 1: AP subledger INV-16963, Cascade Steel Supply, 12/10/2025, $2,394.83; invoice "Not on file". Expected: Exception, No support.
- Seed `abc`, item 2: inventory receipts log RR-4903, 1,766 units; receiving report RR-4903, 1,823 units. Expected: Exception, Amount or quantity.

**B. Cutoff.** A sale or purchase with FOB shipping point or FOB destination, and ship, delivery, invoice and GL dates between late December 2025 and early January 2026. Answers: which year it belongs to (2025 / 2026) and whether it was recorded in the right year (Yes / No). Rule: ownership passes at shipment under FOB shipping point and at delivery under FOB destination; the same rule is used for Bluestem's purchases. The invoice date is often in the other year as a distractor.

- Seed `abc`, item 1: sale to Dakota Rail Parts, FOB shipping point, shipped 01/04/2026, delivered 01/08/2026, invoiced 01/06/2026, recorded 01/08/2026. Expected: 2026, Yes.
- Seed `abc`, item 2: sale to Dakota Rail Parts, FOB destination, shipped 01/01/2026, delivered 01/04/2026, invoiced 01/01/2026, recorded 12/31/2025. Expected: 2026, No.

**C. Sample selection.** Three kinds, five each, alternating:

- *Which line:* a five-line population excerpt and the rule "select every item over $T, plus every kth item number starting at #s". Exactly one line is selected. Seed `abc`, item 1: over $5,000, every 5th from #8760; lines #8774 $4,801.88, #8775 $3,500.97, #8779 $3,277.55, #8783 $2,689.20, #8786 $1,864.46. Expected: line B (#8775 is on the interval; #8774 is just under the threshold).
- *How many:* five consecutive item numbers, same rule; answer 1 to 4. Seed `abc`, item 2: over $25,000, every 3rd from #7126; #7128 to #7132, the highest $24,965.53. Expected: 2 (#7129 and #7132 on the interval, none over the threshold).
- *Missing check:* a six-line December check register with one number missing; pick it from four. Seed `abc`, item 3: #4295 to #4301 without #4299. Expected: #4299.

### Part 1: Expense vouching (25 points)

Eight sampled GL entries in four pairs. Each item shows the GL line and the client's support. One trap per pair; which pair and which position is seeded. The candidate flags the GL line of each exception with a reason.

Seed `abc`:

| Item | GL (ref, date, payee, account, amount) | Support | Expected | Misstatement |
| --- | --- | --- | --- | --- |
| #1 | AP-4133, 12/28/2025, Apex Industrial Services, preventive maintenance CNC line 2, 6100 Repairs & maintenance, $5,877.84 | Invoice INV-1178 dated 01/03/2026, "work performed January 2–3, 2026" | **Cutoff**: "Wrong period (cutoff)" | 5,877.84 |
| #2 | AP-6986, Midland Fastener Co., shop consumables, $4,019.56 | Invoice agrees | Clean | 0 |
| #3 | CC-2487, Prairie Oak Steakhouse, client entertainment, $465.69 | Card receipt: dinner for 7, attendees named (Tom Brandt and 6 from Fenwick Tractor), business purpose stated | Clean (a real client dinner, so "entertainment" alone isn't the tell) | 0 |
| #4 | JE-392, 12/31/2025, Oakridge Strategy LLC, "Year-end accrual: Q4 consulting services", 6200 Professional fees, $11,700.00 | None. Client: the CEO agreed it by phone; no invoice, contract or engagement letter | **No support** | 11,700.00 |
| #5 | AP-2116, Northstar Travel Agency, airfare, $1,596.84 | Invoice agrees | Clean | 0 |
| #6 | CC-5111, 12/07/2025, Bayview Marina, "Client entertainment", 6300 Meals & entertainment, $2,182.61 | Card receipt: winter storage and shrink-wrap, private boat; cardholder Tom Brandt (CEO); no attendees or business purpose | **Personal**: "Not a business expense" | 2,182.61 |
| #7 | AP-1507, OfficeWorks Direct, toner and paper, $332.90 | Invoice agrees (dated one day before the GL posting) | Clean | 0 |
| #8 | AP-2372, Bridger Machine Repair, hydraulic press repair, 6100, $3,319.09 | Invoice INV-2446 $3,139.09 | **Amount**: "Amount doesn't agree to support" (hundreds and tens digits swapped, GL higher) | 180.00 |

Rules relied on: expenses are recorded in the period the goods or services are received (cutoff); every recorded expense needs support; a personal expense of an officer isn't a company expense; the GL must agree to the invoice.

**Conclusion on the sample** (after the last pair): "Exceptions noted: document them and work out the adjustment". Wrong options: "no exceptions", "replace those items with new sample items", "ask the client to fix them; nothing to document".

### Part 2: Inbox under pressure (15 points)

- **Reply to the controller (human-reviewed, 5).** Renee asks to skip item #4 (the $11,700 Oakridge accrual) and pick a different entry. Expected: politely declines to drop or swap a sampled item (2); asks for other evidence, such as the engagement letter or contract, emails agreeing the fee, evidence the work was done, or the invoice when it arrives (2); courteous, no promises the item will clear (1).
- **Number of exceptions (automatic, 2).** Always 4.
- **Total misstatement (automatic, 3).** 180.00 + 5,877.84 + 2,182.61 + 11,700.00 = **$19,940.45**. Asked after the vouching section has closed, so the candidate answers from their own notes.
- **Bank confirmation (automatic, 5).** Cedar Valley Bank, operating account ending 2076: confirmed $505,513.51, cash lead schedule $511,032.13, difference ($5,518.62). Payroll account ending 1328 agrees at $51,552.86 (a false-flag trap). Expected: flag the confirmed balance, lead balance or difference as "Balances don't agree" (2); next step **"Get the client's December 31 bank reconciliation, agree the confirmed balance to it and vouch the reconciling items"** (3). Wrong: propose an entry to change cash to the confirmed balance; note it as immaterial; ask the client to have the bank correct the confirmation. Rule: a confirmation that differs from the books is usually explained by reconciling items (outstanding checks, deposits in transit), which the auditor tests before concluding.

### Part 3: Proposed adjustment (30 points)

Marcus's materiality memo (seed `abc`): overall materiality $210,000.00, performance materiality $157,500.00 (75%), clearly trivial $10,500.00 (5%). His rule: add up the known misstatements (no projection; he handles that). Below clearly trivial, pass (note on the summary of unadjusted differences). At or above, propose the entries. The threshold is seeded so about half of candidates should pass and half propose.

- **Summary of misstatements (automatic, 14).** One row per sampled item. The four exception amounts (2 each), the total $19,940.45 (2), and the call. Seed `abc`: $19,940.45 is at or above $10,500.00, so **propose** (4). The call is a multiple-choice question: Propose / Pass (changing in PR: switch to new step types; today it is a number cell, 1 = propose, 0 = pass).
- **Adjusting entries (automatic, 4 × 2).** Drafted whether the call is pass or propose:

| Exception | Debit | Credit | Amount (seed `abc`) |
| --- | --- | --- | --- |
| Amount | Accounts payable (Cash also accepted) | The expense account booked (6100 Repairs & maintenance) | 180.00 |
| Cutoff | Accounts payable (Accrued liabilities also accepted) | 6100 Repairs & maintenance | 5,877.84 |
| Personal | 1250 Due from officer | 6300 Meals & entertainment | 2,182.61 |
| No support | 2100 Accrued liabilities | 6200 Professional fees | 11,700.00 |

- **Summary to Marcus (human-reviewed, 8).** Count, total and the pass/propose call against the threshold (3); one line on each exception (3); short, organized, greeting and sign-off, about 150 words or fewer (2).

### Judgment calls (from docs/07, "For the accountant reviewing this draft")

- The whole unsupported accrual is treated as a known misstatement and reversed against Accrued liabilities.
- The personal expense is debited to Due from officer, not officer compensation.
- The cutoff entry is against Accounts payable or Accrued liabilities.
- The engagement rule "pass below clearly trivial, propose at or above", with clearly trivial at 5% and performance materiality at 75% of overall. A real team would also weigh a 4-of-8 exception rate (projection, control findings); Marcus says he handles projection.
- The bank confirmation's expected next step (get the bank rec and vouch the reconciling items).
- Rapid round A: a January-dated document against a December schedule line counts as "date or cutoff" whatever the document type, including a bank confirmation dated in January.
- Rapid round B: FOB terms decide the year for purchases as well as sales; the invoice date never does. "Recorded in GL" is the posting date.
- Rapid round C: the selection rule ("every item over $T, plus every kth item number starting at #s") and the reading that the interval runs over item numbers, key items included. The seeding avoids any line where the two readings would differ.
- Section lengths: 3 minutes per vouching pair, 4 minutes for the controller reply.

### Scoring (100 points)

| Part | What earns points | Points | Marked by |
| --- | --- | --- | --- |
| Rapid round A: tick and tie | 15 items, 2 answers each | 10 | Automatic |
| Vouching: four exceptions | 5 each; half for the right item with the wrong reason; −1 per false flag (never below 0 on that screen) | 20 | Automatic |
| Vouching: conclusion on the sample | | 5 | Automatic |
| Rapid round B: cutoff | 15 items, 2 answers each | 10 | Automatic |
| Reply to the controller | Rubric | 5 | Reviewer |
| Number of exceptions / total misstatement | 2 / 3 | 5 | Automatic |
| Bank confirmation: flag / next step | 2 / 3 | 5 | Automatic |
| Rapid round C: sample selection | 15 items, 1 answer each | 10 | Automatic |
| Summary of misstatements | 4 items × 2, total 2, pass or propose 4 | 14 | Automatic |
| Adjusting entries | 4 × 2 | 8 | Automatic |
| Summary to Marcus | Rubric | 8 | Reviewer |
| **Total** | 87 automatic, 13 reviewer | **100** | |

The rapid rounds also report the median response time (0 points).

### Sign-off: Calder & Finch audit

| Item | Approve / change / reject | Reviewer note |
| --- | --- | --- |
| Trap: amount (GL above invoice, transposed digits); reason "Amount doesn't agree to support" | | |
| Trap: cutoff (January 3 invoice for January work, booked in late December); full amount is the misstatement | | |
| Trap: personal expense on the officer's card booked as client entertainment | | |
| Trap: round-number year-end accrual with no support | | |
| Clean client dinner with attendees and purpose is not an exception | | |
| Conclusion on the sample: "document them and work out the adjustment" | | |
| Controller reply rubric: decline to skip, ask for alternative evidence | | |
| Exception count (4) and total misstatement | | |
| Bank confirmation: flag the difference; payroll account agrees (false-flag trap) | | |
| Summary of misstatements: four amounts, total, and the call | | |
| Pass/propose as a multiple-choice question (changing in PR: switch to new step types) | | |
| Entry: amount, Dr Accounts payable (Cash accepted) / Cr expense booked | | |
| Judgment: cutoff entry, Dr Accounts payable or Accrued liabilities / Cr Repairs & maintenance | | |
| Judgment: personal expense, Dr Due from officer (not officer compensation) | | |
| Judgment: whole unsupported accrual is a known misstatement, Dr Accrued liabilities / Cr Professional fees | | |
| Judgment: pass below clearly trivial, propose at or above; clearly trivial 5%, performance materiality 75% | | |
| Judgment: no projection of the 4-of-8 exception rate (Marcus handles it) | | |
| Judgment: bank confirmation next step is the client's bank rec and vouching the reconciling items | | |
| Rapid A rule: January-dated document against a December line is "date or cutoff", bank confirmations included | | |
| Rapid A: lookalike names, missing documents and quantity differences | | |
| Rapid B rule: FOB terms decide the year for sales and purchases; invoice date never does; "recorded" is the posting date | | |
| Rapid C rule: over $T plus every kth item number from #s, interval over item numbers including key items | | |
| Rapid C: missing check number in a six-line register | | |
| Rapid rounds: 15 items × 20 s, 0.5 / 0.75 points, 10 per round | | |
| Summary to Marcus rubric | | |
| Judgment: section lengths, 3 minutes per vouching pair and 4 minutes for the controller reply | | |
| Timing: 52 minutes in all, six sections (6 / 12 / 6 / 10 / 6 / 12) | | |

---

## 3. Ridgeway Outdoor Supply: AP payment run (52 minutes, 100 points)

### Setup

- **Role:** accounts payable intern in the in-house finance team.
- **Company:** Ridgeway Outdoor Supply, an outdoor gear retailer.
- **Situation:** mid-month payment run day; the run closes at 2 PM. The manager is Priya Desai, AP lead. Her policy, stated in her first email: pay an invoice only when the PO, receiving report and invoice agree on quantity and price and it hasn't been paid before; any difference, however small, goes on hold.

### Timeline

| # | Section | Minutes | What the candidate sees | Message on arrival |
| --- | --- | --- | --- | --- |
| 1 | Rapid round A: journal entries | 6 | 15 items × 20 s: a one-line transaction; pick the debit and credit | (intro on screen) |
| 2 | Three-way match | 12 | Four match screens, 2.5 minutes each, then posting the approved invoice (2 minutes) | Priya: match queue, the AP policy, two bills she approved yesterday that are already in the run |
| 3 | Rapid round B: pay or hold | 6 | 15 items × 20 s: an invoice and one fact | (rules on screen) |
| 4 | AP inbox | 10 | One screen at a time: reply to a vendor (3 min), run total (3 min), bank-details change email (4 min) | Vendor AR clerk chasing the held invoice; Priya forwards "Updated remittance details"; Priya: "Total approved for today's run? Number only." |
| 5 | Rapid round C: cash application | 6 | 15 items × 20 s: a customer payment and three open invoices | (intro on screen) |
| 6 | Vendor statement | 12 | Statement vs AP subledger reconciliation, then a note to Priya | Priya: statement doesn't agree (minute 0); Priya: send a short note, under 120 words (minute 1) |

Total 52 minutes. A rapid round's 15 items take 5 minutes inside its 6-minute section. The overall timer never pauses.

### Rapid rounds (30 points)

Each round is 15 items at 20 seconds each, two pick-one answers per item, each half the item. Items 3, 6, 9, 12 and 15 hold the harder kinds and are worth 1 point; the other ten are worth ½, so each round is exactly 10.

**A. Journal entry flash.** A one-line transaction with a seeded amount; debit and credit from a short chart of 13 accounts (Cash, Accounts receivable, Supplies, Prepaid insurance, Equipment, Accounts payable, Wages payable, Unearned revenue, Service revenue, Wages expense, Utilities expense, Supplies expense, Insurance expense).

| Tier | Transactions |
| --- | --- |
| ½ point (10 of these 12) | 12 months of insurance paid in advance (Prepaid insurance / Cash); customer pays on account (Cash / AR); supplies bought on credit (Supplies / AP); pay a recorded bill (AP / Cash); pay this week's wages (Wages expense / Cash); bill a customer for ski tuning (AR / Service revenue); cash for bike repairs (Cash / Service revenue); pay the electricity bill (Utilities expense / Cash); receive the electricity bill, pay next month (Utilities expense / AP); supplies bought for cash (Supplies / Cash); display rack for cash (Equipment / Cash); display rack on account (Equipment / AP) |
| 1 point (all 5) | Customer pays in advance for a repair (Cash / Unearned revenue); a month of prepaid insurance expires (Insurance expense / Prepaid insurance); prepaid repair work finished (Unearned revenue / Service revenue); wages earned, paid next month (Wages expense / Wages payable); supplies used up (Supplies expense / Supplies) |

Seed `abc`: item 1 "Bought $365.64 of store supplies on credit." Expected Supplies / Accounts payable. Item 3 "Finished $553.91 of repair work the customer had paid for in advance." Expected Unearned revenue / Service revenue.

**B. Pay or hold.** Rules on screen: pay only against a PO; over $5,000 needs Priya's approval; bank details changed by email are verified by phone first; never pay the same bill twice. Answers: Pay / Hold, and the reason. Only one thing is wrong with any invoice; only over-limit invoices are over $5,000.

| Tier | Cases per candidate | Expected |
| --- | --- | --- |
| ½ | 3 × vendor's bank details changed yesterday by email | Hold, bank details |
| ½ | 3 × PO "None" (ordered by phone) | Hold, no purchase order |
| ½ | 4 × "Goods received in full; the PO and the invoice agree" | Pay, nothing wrong |
| 1 | 2 × last payment to this vendor: another invoice number, same amount, same date, paid | Hold, already paid |
| 1 | 2 × $5,001 to $9,800 with a clean fact | Hold, over the limit |
| 1 | 1 × last payment to this vendor for a different amount and date (looks like a duplicate) | Pay, nothing wrong |

Seed `abc`: item 1, Summit Ridge Apparel SRA-82196, $3,324.82, PO 4565, goods received in full. Expected Pay, Nothing wrong. Item 3, Willamette Electric WE-57641, Nov 5, $3,141.01; last payment was invoice WE-56758 for $3,141.01 dated Nov 5, paid Nov 9. Expected Hold, Same as an invoice already paid.

**C. Cash application** (covering the receivables desk). A customer payment, its remittance advice and three open invoices. Answers: which invoices to apply it to (three offered sets, or "None of these: hold it as unapplied cash") and what's left (Nothing / Short-pay: leave the shortfall open / Unapplied cash: hold it and ask the customer). Every combination of the three invoices adds up to a different amount.

| Tier | Cases per candidate | Expected |
| --- | --- | --- |
| ½ | 3 × remittance names one invoice, payment equals it | That invoice; nothing left |
| ½ | 3 × no remittance, payment equals exactly one invoice | That invoice; nothing left |
| ½ | 4 × remittance names two invoices, payment equals both | Both; nothing left |
| 1 | 3 × remittance names one invoice "less $X for damaged items", payment = invoice − X (3 to 12%, at least $5) | That invoice; short-pay |
| 1 | 2 × no remittance, payment more than 15% away from every combination | None; unapplied cash |

Seed `abc`: item 1, Cascade Outdoor School pays $1,717.26, remittance "Paying invoice ROS-26174" ($1,717.26). Expected ROS-26174, nothing left. Item 3, Riverside Parks & Recreation pays $1,761.09 with no remittance; open invoices $2,123.04, $238.59 and $1,057.10. Expected None, unapplied cash.

### Part 1: Three-way match (25 points)

Four screens, one per vendor: PO (number, date), receiving report (number, date), invoice (number, date, Net 30), the last payment to that vendor, and a line table (PO qty, PO unit price, received qty, invoiced qty, invoice unit price, amount). Each invoice has two merchandise lines and one store-use line. The candidate flags what breaks the match with a reason, then chooses Pay or Hold. Every screen shows a last payment, so its presence gives nothing away.

Seed `abc`:

| Trap | What the document shows | Expected | Rule |
| --- | --- | --- | --- |
| Short shipment | Timberline Packs TP-26323, $1,392.23: fleece pullovers ordered 14, received 11, billed 14 ($75.93 not received) | Flag the line (or the total), "Billed for more than we received"; **Hold** | Pay only for goods received; policy holds the whole invoice |
| Price above PO | Granite Peak Footwear GPF-50236, $977.07: water bottles billed $12.77 a unit, PO $11.40 ($45.21 over) | Flag the line (or the total), "Price is higher than the PO"; **Hold** | Policy: no price tolerance |
| Already paid | High Desert Hydration HDH-31099, $1,622.85, dated Oct 7; "Last payment to this vendor: Invoice HDH-31099 · $1,622.85 · paid Oct 15" | Flag the invoice number (or the last-payment row), "Duplicate: already paid"; **Hold** | Never pay the same invoice twice |
| Clean match | Lakeshore Lantern Co. LLC-35748, $1,069.56: everything agrees, not paid before | The "Nothing wrong here" confirm; **Pay** (changing in PR: switch to new step types; today it is a flag on the "Three-way match" row with "All three agree") | |

**Posting (automatic, 5).** Post the approved (clean) invoice only: Dr 1300 Merchandise Inventory $764.70 (the two merchandise lines), Dr 6100 Store Supplies Expense $304.86 (the store-use line) / Cr 2000 Accounts Payable $1,069.56. One debit line per account. Rule: perpetual inventory, so merchandise for resale goes to inventory; items the store uses itself are expensed.

### Part 2: Inbox under pressure (15 points)

- **Vendor chasing the held invoice (human-reviewed, 5).** Omar Haddad of Timberline Packs asks if TP-26323 for $1,392.23 is in today's run. The screen shows the match record (fleece pullovers, invoiced 14, received 11). Expected: explains the hold with the facts (2); asks for a corrected invoice or credit memo (or for the balance to be shipped and billed then), paid once it matches (2); courteous, no promised date (1).
- **Run total (automatic, 4).** Priya's two pre-approved bills plus the clean invoice: Northwest Shelving Systems $2,674.06 + Columbia Basin Freight $1,278.43 + Lakeshore Lantern $1,069.56 = **$5,022.05**. No partial credit; including any held invoice is wrong. The email lists all four queue invoices without saying which was approved.
- **Bank-details change (automatic, 6).** An email "from" Lakeshore Lantern Co. (the vendor being paid today) at `lakeshorelantern-remit.com`, against `lakeshorelantern.com` on file; asks to switch remittance to a new account at Harborview National Bank before today's run, says the old account closes this week, and gives a new phone number, (541) 555-0179, against (503) 555-0175 on file. Expected findings: lookalike domain (1.5); unverified bank change (1.5); pressure or new contact number (1). False flags cost 0.5. Decision (2): **change nothing; call the vendor on the number on file and tell Priya**. Wrong: update the bank details; reply to the email to confirm; call the number in the email. Rule: vendor bank changes are verified independently through contact details already on file (payment-diversion fraud).

### Part 3: Vendor statement reconciliation (30 points)

Northfork Paddle Works' statement (as of Nov 12) and our AP subledger for them, both opening at October's agreed balance of $5,868.71.

| Seed `abc` | Amount | Rule |
| --- | --- | --- |
| Balance per vendor statement, Nov 12 | 8,669.02 | |
| Less: our ACH payment of 11/13, not on the statement (in transit) | (1,520.04) | Timing difference; no entry |
| **Adjusted vendor balance** | **7,148.98** | |
| Balance per AP subledger | 5,120.41 | |
| Add: invoice NPW-47229 on the statement, never received | 2,160.47 | We owe it once received and approved |
| Less: credit memo CM-1706 (returned goods) not booked | (311.90) | The vendor has credited us; we haven't recorded it |
| Add: invoice NPW-47154 keyed at 3,130.41, billed 3,310.41 (transposition) | 180.00 | Book error corrected on our side; in other seeds we over-keyed and it is a deduction |
| **Adjusted AP balance** | **7,148.98** | |

**Note to Priya (human-reviewed, 10), under about 120 words.** States the balance we owe, $7,148.98, and that the difference is explained (3); asks the vendor for a copy of invoice NPW-47229 (and checks the goods arrived before booking it) and of credit memo CM-1706 (3); names the entries: book the credit memo (Dr Accounts Payable / Cr Merchandise Inventory $311.90), correct the keyed invoice (Dr Merchandise Inventory / Cr Accounts Payable $180.00), record the missing invoice once received and approved; no entry for the payment in transit (2); brief and ready to forward (2).

### Judgment calls (from docs/07, "Judgment calls for the accountant review")

- Policy is strict: no price tolerance, and the whole invoice is held on a short shipment. Many companies short-pay the received quantity or allow a small price tolerance; Priya's email states the strict policy so the key is unambiguous.
- The clean match was answered by flagging a "Three-way match" row with "All three agree", which read oddly next to the red Flag buttons. This is the item now changing to a "Nothing wrong here" confirm (changing in PR: switch to new step types).
- Posting a held invoice as well isn't penalised (extra entries score 0 and are listed for the reviewer).
- Merchandise goes to inventory (perpetual system), store-use items to Store Supplies Expense. One debit line per account, because splitting inventory over two lines costs the leftover-line penalty.
- The unreceived invoice is added on our side of the rec, and the credit memo is booked against Merchandise Inventory. An accountant may prefer a purchase returns account, or to leave the unreceived invoice as a vendor-side item until it's verified.
- The phishing email is auto-scored as a document review rather than a written reply. A candidate who would also forward it to IT or security gets no extra credit.
- Time: the sections add up to 52 minutes, not 50, to keep 6-minute rapid rounds and 12-minute match and statement sections. The match screens are 2.5 minutes each (not 3) so the posting step gets 2 minutes.
- The JE flash uses its own short chart, where supplies bought are an asset (Supplies) and expensed when used. The three-way match posts store-use items straight to Store Supplies Expense. Both are common; a reviewer may want one treatment across the whole test.
- JE flash revenue items (ski tuning, bike repairs) give a retailer a service-revenue line; the round is about debit/credit mechanics, not Ridgeway's revenue mix.
- Pay or hold: the "near miss" (a prior payment to the same vendor for a different amount and date) is a Pay. Over-limit invoices are held, not paid "pending approval". A bank-details change is held even when the invoice is otherwise fine.
- Cash application sits in an AP scenario (covering the receivables desk). A short-pay is applied to the invoice with the shortfall left open; an unidentifiable payment is held as unapplied cash, not applied to the oldest invoice. Some teams apply on-account cash oldest-first.
- The rapid rounds weight the harder kinds (accruals and deferrals; duplicates, over-limit and the near miss; short-pays and unapplied cash) at 1 point and the rest at ½.
- Sections close their screens, so the inbox shows the held invoice's match record in the vendor-reply prompt and the four queue invoices in the run-total email. The run total still depends on the candidate's own match decisions.

### Scoring (100 points)

| Part | What earns points | Points | Marked by |
| --- | --- | --- | --- |
| Rapid A: JE flash | Debit and credit, half the item each | 10 | Automatic |
| Three-way match | Per document: right flag and reason 3 (half for the right item with another reason), Pay / Hold 2; × 4; −1 per false flag | 20 | Automatic |
| Posting | Clean invoice to Inventory, Supplies Expense and AP | 5 | Automatic |
| Rapid B: pay or hold | Decision and reason, half the item each | 10 | Automatic |
| Vendor reply | Rubric | 5 | Reviewer |
| Run total | Pre-approved bills + clean invoice, exact | 4 | Automatic |
| Bank-change email | Domain 1.5, bank change 1.5, pressure / new contact 1, decision 2; −0.5 per false flag | 6 | Automatic |
| Rapid C: cash application | Invoices and what's left, half the item each | 10 | Automatic |
| Statement rec | Four planted items 4 each, both adjusted balances 2 each | 20 | Automatic |
| Note to Priya | Rubric | 10 | Reviewer |
| **Total** | 85 automatic, 15 reviewer | **100** | |

Each trap answered wrongly costs exactly its own points: paying the duplicate, the short shipment or the price variance costs that document's 5; holding the clean invoice costs 5; updating the bank details without flags costs 6. A run total that includes a held invoice loses the 4 numeric points.

### Sign-off: Ridgeway AP

| Item | Approve / change / reject | Reviewer note |
| --- | --- | --- |
| Trap: short shipment, hold the whole invoice | | |
| Trap: price above PO, hold (no tolerance) | | |
| Trap: invoice already paid, hold | | |
| Clean match answered with "Nothing wrong here", then Pay (changing in PR: switch to new step types) | | |
| Judgment: strict policy (no price tolerance, no short-pay of received quantity) | | |
| Posting: Dr Merchandise Inventory and Store Supplies Expense / Cr AP, one line per account | | |
| Judgment: perpetual inventory for merchandise, store-use items expensed | | |
| Judgment: posting a held invoice too isn't penalised | | |
| Vendor reply rubric | | |
| Run total: pre-approved bills plus the clean invoice, no partial credit | | |
| Bank-details change: three warning signs and "change nothing; call the number on file; tell Priya" | | |
| Judgment: phishing scored as a document review; no credit for forwarding to IT | | |
| Statement rec: payment in transit on the vendor side, no entry | | |
| Statement rec: unreceived invoice added on our side | | |
| Judgment: credit memo booked against Merchandise Inventory (vs a purchase returns account) | | |
| Statement rec: transposition corrected on our side, either direction | | |
| Note to Priya rubric and the 120-word guide | | |
| Rapid A: JE flash transactions and expected entries | | |
| Judgment: JE flash treats supplies as an asset, the match expenses store supplies | | |
| Judgment: service revenue lines in a retailer's JE flash | | |
| Rapid B: pay-or-hold rules and expected answers | | |
| Judgment: near miss is Pay; over-limit is Hold, not "pay pending approval"; bank change held even if otherwise fine | | |
| Rapid C: cash application cases and expected answers | | |
| Judgment: short-pay left open on the invoice; unidentified payment held as unapplied (not oldest-first) | | |
| Judgment: cash application in an AP scenario | | |
| Rapid rounds: 15 items × 20 s, ½ / 1 point, 10 per round | | |
| Judgment: inbox carries the match record and the queue list because match screens are closed | | |
| Timing: 52 minutes in all, six sections (6 / 12 / 6 / 10 / 6 / 12), match screens 2.5 minutes, posting 2 minutes | | |

---

## After sign-off

1. Every "change" is made in the scenario code and in `docs/07-accounting-simulations.md`.
2. Athul publishes the new versions of anything that changed (see `docs/12-pilot-runbook.md`, step 4).
3. `docs/10-progress.md` records the review and the publish.

Reviewer name: ____________________ Date: ____________ Signature: ____________________
