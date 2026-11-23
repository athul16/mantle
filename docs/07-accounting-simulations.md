# 07 · Accounting simulations

Worked examples. Numbers shown are one variant; real candidates get generated numbers (see `06-assessment-engine.md`). Every scenario needs review by a working accountant before launch.

## Example 1: Month-end close at a small CPA firm (~40 min)

**Setup:** "You're an intern at Mason & Reed CPAs. Your client is Hartwell Landscaping. It's November 3, and your senior, Dana, needs help closing October."

### Task 1 · 9:00 · Bank reconciliation (`spreadsheet` + `journal_entry`)

Email from Dana with the bank statement and cash ledger attached. Planted items:

- Bank balance $21,120; book balance $19,150
- Outstanding checks #1043 $1,800 and #1047 $1,400
- Deposit in transit $1,050
- Unrecorded bank fee $35
- Unrecorded NSF customer check $415
- Check #1045 cleared at $250 but booked at $520 (transposition)

Expected reconciliation:

| | Amount |
| --- | --- |
| Bank balance | 21,120 |
| + Deposit in transit | 1,050 |
| − Outstanding checks | (3,200) |
| **Adjusted bank** | **18,970** |
| Book balance | 19,150 |
| − Bank fee | (35) |
| − NSF check | (415) |
| + Correction, check #1045 | 270 |
| **Adjusted book** | **18,970** |

Expected entries:

- Bank service charge expense 35 / Cash 35
- Accounts receivable 415 / Cash 415
- Cash 270 / (expense account check #1045 was charged to) 270

Scoring: both sides tie; each item on the correct side; entries correct.

### Task 2 · 9:20 · Interruption (`inbox_reply`, process signal)

Manager: "Client call in 10 minutes. What's the reconciled cash balance? Just the number." Strong: quick reply with $18,970 or "not final yet," then back to work. Scored on response and timing.

### Task 3 · 9:30 · Adjusting entries (`journal_entry`)

- Accrue estimated October utilities: Utilities expense 1,200 / Accrued liabilities 1,200
- $6,000 12-month policy paid Oct 1, all expensed: Prepaid insurance 5,500 / Insurance expense 5,500

### Task 4 · 9:45 · Invoice review (`document_review`)

Mulch invoice: 40 bags × $12.50 billed as $550 (should be $500), and the invoice number was already paid in September. Flag both; choose approve / reject / ask vendor. Partial credit for one.

### Task 5 · 9:55 · Client communication (`inbox_reply`)

Owner: "My bank app says $21k but your report says $19k. Where did my money go?"

Rubric:
1. Explains timing differences (uncashed checks, deposit in transit)
2. Mentions the bounced customer check and to follow up with that customer
3. Plain language, professional tone
4. Accurate; makes no wrong promises

## Example 2: Audit intern, vouching expenses (~20 min, `document_review`)

8 ledger entries with scanned receipts/invoices. Planted: amount mismatch, cutoff error (Nov 2 invoice booked in October), personal expense booked as client entertainment, an entry with no support. Mark each supported or flagged with reason. Fully auto-scored.

## Example 3: Receivables aging (~15 min, `spreadsheet`)

30 unpaid invoices with dates. Bucket into current, 31–60, 61–90, 90+; apply the firm's bad-debt rates per bucket (given in the email); compute the allowance and adjusting entry. Scored on key cell values.

## Example 4: Bank rec with a mid-task update (~30 min)

A short, single-task version of Example 1 for the first build. It tests whether the candidate notices and acts on new information while working. Numbers shown are one variant.

**Setup:** "You're a new staff accountant at Oakline CPA Group. Your client is Harbor Lane Coffee Co. Your senior, Dana Ruiz, needs the October bank reconciliation for checking ending 4471 before a 10 AM client call."

### Messages

**Minute 0 · Dana · "Harbor Lane: October bank rec"** (attachment: workbook)

> Hi {first_name},
>
> Welcome aboard! First assignment: Harbor Lane Coffee Co. needs their October bank reconciliation for their operating account (checking ending 4471).
>
> The attached workbook has four tabs: Bank Statement, GL Cash, and two blank templates, Reconciliation and Journal Entries, for you to fill in.
>
> Please:
> 1. Reconcile the bank balance to the book balance as of October 31.
> 2. Draft any journal entries the client needs to fix their books.
> 3. Reply to me with the adjusted cash balance and a short summary of anything the client should know about.
>
> September's reconciliation was clean, so nothing carries over from last month. I need this before my 10 AM call with the client.
>
> Thanks!
> Dana Ruiz
> Senior Associate, Oakline CPA Group

**Minute 12 · Dana · "RE: Harbor Lane: one more thing"**

> Quick update: Marcus (Harbor Lane's owner) just told me check #1046 to Office Depot for $300.00 was voided. The order was cancelled and the check was never mailed, but it's still in their books. It was originally booked to Office Supplies Expense. Please factor that into your rec.
>
> Dana

### Workbook (`spreadsheet` + `journal_entry`)

Tabs 1 and 2 are read-only; tabs 3 and 4 are answered.

**Tab 1 · Bank Statement** (Piedmont Community Bank, checking ending 4471, Oct 1–31)

| Date | Description | Debit | Credit | Balance |
| --- | --- | --- | --- | --- |
| 10/01 | Opening balance | | | 24,500.00 |
| 10/02 | Deposit | | 5,200.00 | 29,700.00 |
| 10/05 | Check #1041 | 3,150.00 | | 26,550.00 |
| 10/08 | Check #1042 | 875.00 | | 25,675.00 |
| 10/12 | Deposit | | 4,760.00 | 30,435.00 |
| 10/14 | Check #1043 | 2,610.00 | | 27,825.00 |
| 10/18 | Check #1044 | 1,920.00 | | 25,905.00 |
| 10/22 | Deposit | | 6,035.00 | 31,940.00 |
| 10/24 | Returned item: NSF, Maple St. Bakery | 480.00 | | 31,460.00 |
| 10/25 | Check #1045 | 4,400.00 | | 27,060.00 |
| 10/27 | Check #1047 | 1,140.00 | | 25,920.00 |
| 10/31 | Monthly service fee | 35.00 | | 25,885.00 |
| 10/31 | Interest earned | | 12.50 | 25,897.50 |

**Tab 2 · GL Cash** (account 1010 Cash, Operating)

| Date | Ref | Description | Debit | Credit | Balance |
| --- | --- | --- | --- | --- | --- |
| 10/01 | | Beginning balance | | | 24,500.00 |
| 10/02 | DEP | Daily sales deposit | 5,200.00 | | 29,700.00 |
| 10/05 | 1041 | Coastal Roasters, coffee beans | | 3,150.00 | 26,550.00 |
| 10/08 | 1042 | Piedmont Dairy | | 875.00 | 25,675.00 |
| 10/12 | DEP | Daily sales deposit | 4,760.00 | | 30,435.00 |
| 10/14 | 1043 | Coastal Roasters, coffee beans | | 2,160.00 | 28,275.00 |
| 10/18 | 1044 | Bull City Equipment Repair | | 1,920.00 | 26,355.00 |
| 10/22 | DEP | Sales deposit incl. Maple St. Bakery wholesale check | 6,035.00 | | 32,390.00 |
| 10/25 | 1045 | Triangle Property Mgmt, rent | | 4,400.00 | 27,990.00 |
| 10/26 | 1046 | Office Depot, office supplies | | 300.00 | 27,690.00 |
| 10/27 | 1047 | City Utilities | | 1,140.00 | 26,550.00 |
| 10/30 | 1048 | Cardinal Linens | | 1,250.00 | 25,300.00 |
| 10/31 | DEP | Daily sales deposit | 3,420.00 | | 28,720.00 |

**Tab 3 · Reconciliation:** fixed labels (balance per bank; add deposits in transit; less outstanding checks; bank errors; adjusted bank; balance per books; add; less; book errors; adjusted book; difference). Candidate fills amounts and may insert rows.

**Tab 4 · Journal Entries:** columns Entry #, Date, Account, Debit, Credit, Description. Account is a dropdown: 1010 Cash, 1200 Accounts Receivable, 2000 Accounts Payable, 5100 Cost of Goods Sold, 6100 Office Supplies Expense, 6200 Bank Service Charges, 6300 Rent Expense, 6400 Utilities Expense, 6500 Repairs Expense, 7100 Interest Income.

### Planted items

- Deposit in transit $3,420 (10/31)
- Outstanding check #1048 $1,250
- Unrecorded bank fee $35
- Unrecorded NSF customer check $480 (Maple St. Bakery)
- Unrecorded interest $12.50
- Check #1043 cleared at $2,610 but booked at $2,160 (transposition, $450)
- **Update at minute 12:** check #1046 $300 voided; add back to books, do not list as outstanding

### Expected reconciliation (after the update)

| | Amount |
| --- | --- |
| Bank balance | 25,897.50 |
| + Deposit in transit | 3,420.00 |
| − Outstanding check #1048 | (1,250.00) |
| **Adjusted bank** | **28,067.50** |
| Book balance | 28,720.00 |
| + Interest earned | 12.50 |
| + Voided check #1046 | 300.00 |
| − Bank fee | (35.00) |
| − NSF check | (480.00) |
| − Correction, check #1043 | (450.00) |
| **Adjusted book** | **28,067.50** |

Missed-update trap: a candidate who ignores the minute-12 message lists #1046 as outstanding and both sides tie at **27,767.50**. Scoring must check for this case specifically, since the rec still balances.

### Expected entries

- Bank service charges 35 / Cash 35
- Accounts receivable (Maple St. Bakery) 480 / Cash 480
- Cash 12.50 / Interest income 12.50
- Cost of goods sold 450 / Cash 450 (accept Accounts payable if the candidate explains the check paid a booked invoice)
- Cash 300 / Office supplies expense 300

Net change to Cash: −652.50 (28,720.00 → 28,067.50).

### Scoring (100 points)

| Area | What earns points | Points |
| --- | --- | --- |
| Reconciliation | Each of the 6 planted items on the correct side and amount (5 each) | 30 |
| Update | #1046 removed from outstanding and added back to books | 10 |
| Final balance | Both sides equal 28,067.50 | 5 |
| Journal entries | Each of the 5 entries balanced with correct accounts and amounts (3 each) | 15 |
| Reply · answer | States 28,067.50 up front | 10 |
| Reply · client issues | Flags the $480 NSF for follow-up and the $450 error on #1043 | 10 |
| Reply · update | Confirms the voided check was handled | 5 |
| Reply · clarity | Under ~150 words, organized | 10 |
| Reply · tone | Professional and friendly, greeting and sign-off | 5 |

Strong reply (rubric reference, never shown to candidates):

> Hi Dana,
>
> October is reconciled. Adjusted cash is $28,067.50 on both the bank and book side, and the workbook has five journal entries ready for the client.
>
> Two things to raise on your call: Maple St. Bakery's $480 check bounced, so that's back in receivables and needs follow-up. Check #1043 to Coastal Roasters was recorded as $2,160 but cleared at $2,610, a $450 entry error now corrected.
>
> I also reversed voided check #1046 per your note.
>
> Thanks,
> {first_name}

Process signals worth reporting: time from the minute-12 message arriving to it being opened, and whether the reconciliation changed afterward.

### Build status (`harbor-lane-bank-rec` v1)

Built in `src/lib/engine/scenarios/harbor-lane-bank-rec.ts`; every amount and check number is seeded per candidate. Decision D10 (2026-11-10): fix the cheap gaps, accept the rest, publish after an accountant's review.

Fixed:

- **First-name greeting.** Dana's first email opens "Hi {first_name}," using the first word of the name the candidate gave when verifying, or "Hi there," if none. Any scenario can use `{{first_name}}`.
- **Date order.** The NSF return now comes after the deposit that held the bakery's check (deposit 10/22, return 10/24). This example used to date the return 10/20, two days before the deposit.

Accepted for v1 (forced by the current step types):

- One spreadsheet grid instead of four tabs; bank statement and GL are read-only sections above the reconciliation, journal entries are their own step, and candidates can't insert rows.
- The reconciliation has a fixed row per item type (interest, cancelled checks, fees, NSF, book errors) so each item scores on its own. The row names hint at what to look for.
- Cells score all-or-nothing, so a candidate who misses the update scores 25 of 45 on the reconciliation, not 30. The report shows the trap balance next to the expected one.
- The reply needs a human reviewer (no AI scorer in the scoring path), so a perfect attempt shows 60 automatic points until it is marked.
- Accounts payable is accepted for the check-error entry without the explanation, because the journal step can't read the memo.
- Process signals come from attempt events, not the scenario.

## Example 5: Audit intern, year-end fieldwork at Calder & Finch (52 min, 100 points)

**Status: draft: needs accountant review.** Built as `audit-calder-bluestem` v1 in `src/lib/engine/scenarios/audit-calder-bluestem.ts`, tests in `tests/engine/audit-calder-bluestem.test.ts`. Extends Example 2 (vouching) into a full session with the Example 4 message pattern, in six timed sections with three rapid rounds. Numbers below describe the structure; every amount, payee, officer, date, document number, rapid-round exhibit, and which item in which pair holds which trap is seeded per candidate. Published to the cloud library as v1 on 2026-11-17 for the team's own testing; review fixes ship as v2.

**Setup:** "You're an audit intern at Calder & Finch LLP. It's fieldwork week on the December 31, 2025 year-end audit of Bluestem Manufacturing. Your senior, Marcus Avery, will send you work through the session, and the client's team will be in touch too. The session runs in six timed parts, three of them quick-fire rounds; once a part ends you can't go back to it."

### Sections (52 minutes)

Sections run back to back (docs/06 "Timed sections and rapid rounds"); a finished section can't be reopened. Every message is linked to a step and arrives when that step's section starts, so each brief is there when its section opens.

| # | Section | Minutes | Steps | Messages on arrival |
| --- | --- | --- | --- | --- |
| 1 | Rapid round A: tick and tie | 6 | `rapid-tick` (15 × 20 s) | Marcus: warm-up while he pulls the sample |
| 2 | Expense vouching, one screen at a time | 12 | `vouch-1` … `vouch-4`, 2¾ min each, then `vouch-conclusion` 1 min | Marcus: vouch the sample of 8 |
| 3 | Rapid round B: cutoff | 6 | `rapid-cutoff` (15 × 20 s) | Marcus: cutoff testing |
| 4 | Inbox, one screen at a time | 10 | `controller-reply` 4 min, `exception-count` 1.5 min, `exception-total` 1.5 min, `bank-confirm` 3 min | Renee: "Can you just skip that one?"; Marcus: how many exceptions, and the total; the bank confirmation is back $X higher / lower |
| 5 | Rapid round C: sample selection | 6 | `rapid-sample` (15 × 20 s) | Marcus: sample selection |
| 6 | Summary and adjusting entries | 12 | `misstatement-summary`, `pass-or-propose`, `proposed-aje`, `marcus-summary` | Marcus: materiality memo (overall, performance 75%, clearly trivial 5%; pass below clearly trivial, propose at or above); draft the adjusting entries; summary for partner review |

### Rapid rounds (30 points, `rapid_round` × 3)

15 items × 20 seconds each, choice fields only. Items 1–5 of each round are worth 0.5 and items 6–15 are worth 0.75 (10 per round, exactly); a field right earns its share of the item. Option lists are the same for every candidate (except the check numbers offered in round C); the exhibits and answers are seeded.

1. **Tick and tie.** A schedule line next to its source document, five items each: AP subledger vs vendor invoice, cash lead schedule vs bank confirmation, inventory receipts log vs receiving report. Rows: reference, vendor or bank, date, amount / balance / quantity. Fields: **Agrees / Exception** and the reason (**amount or quantity, date or cutoff, vendor or bank name, no support, N/A: agrees**). Per candidate: 5 agree, 3 amount differences, 3 January-dated documents against December schedule lines, 2 lookalike names (e.g. Midland vs Midway Fastener), 2 with the document "Not on file". Each exception differs in one row only.
2. **Cutoff call.** A sale or purchase with FOB shipping point or FOB destination, ship, delivery, invoice and recorded dates between late December 2025 and early January 2026. Fields: **which year it belongs to** (2025 / 2026: ownership passes at shipment under FOB shipping point, at delivery under FOB destination) and **recorded in the right year?** (Yes / No). Every round has both years, both outcomes and both terms; the invoice date often falls in the other year as a distractor. The same rule is used for Bluestem's purchases (title passes to Bluestem at the same point).
3. **Sample selection.** Three kinds, five each, alternating:
   - *Which line:* a five-line population excerpt and a rule, "select every item over $T, plus every kth item number starting at #s". Exactly one line is selected, either by amount or by the interval; one unselected line sits just under the threshold.
   - *How many:* five consecutive item numbers, same rule; the answer is 1–4. Interval picks are always under the threshold, so the count is the same whether or not the interval skips key items.
   - *Missing check:* a six-line December check register with one number missing from the sequence; pick it from four numbers (the other three are in the register).

### Part 1 · Expense vouching (25 points, `document_review` × 4 + `multiple_choice`)

Each pair shows, per item, the GL line (ref, date, payee, description, account, amount) and the support row (vendor invoice, card receipt, or "No support provided"). The candidate flags the GL line of each exception with a reason. One trap per pair:

| Trap | What the candidate sees | Expected reason | Misstatement |
| --- | --- | --- | --- |
| Amount | GL amount has the hundreds and tens digits swapped against the invoice, GL higher (e.g. booked $2,418.50, invoice $2,148.50) | Amount doesn't agree to support | GL − invoice (a multiple of $90) |
| Cutoff | Invoice dated 01/03/2026 for January 2–3 work, posted 12/28–12/31/2025 to Repairs & maintenance | Wrong period (cutoff) | Full amount |
| Personal | Card receipt for a ski lodge family stay, jewelry, pet boarding or private boat storage, cardholder an officer, booked as "Client entertainment" | Not a business expense | Full amount |
| No support | Round-number 12/31 manual accrual ("Q4 consulting"), no invoice, contract or engagement letter; client says the officer agreed it by phone | No support | Full amount |

The four clean items agree on amount, date, payee and period. One clean option is a real client dinner booked to entertainment with attendees and business purpose on the receipt, so "entertainment" alone isn't the tell. After the last pair, a one-minute screen (`vouch-conclusion`, `multiple_choice`, single select, 5) asks for the conclusion on the sample: **"Exceptions noted: document them and work out the adjustment"** (not "No exceptions", "replace those items with new sample items", or "ask the client to fix them; nothing to document"). The options are the same for every candidate.

### Part 2 · Inbox under pressure (15 points)

- **Controller (`inbox_reply`, 5):** politely declines to skip or swap the sampled item (2); asks for alternative support: engagement letter or contract, emails agreeing the fee, evidence the work was done, the invoice when it arrives (2); courteous, no promises (1).
- **Marcus's questions (`numeric` × 2):** count of exceptions, always 4 (2); total misstatement (3). Asked after the vouching section has closed, so the candidate answers from their own notes.
- **Bank confirmation (`document_review`, 5):** flag the confirmed balance, lead balance or difference as "Balances don't agree" (2); next step: **get the client's December 31 bank reconciliation, agree the confirmed balance to it and vouch the reconciling items** (3). Wrong: adjust cash to the confirmation, pass as immaterial, ask the client to have the bank change it. The payroll account agrees and is a false-flag trap.

### Part 3 · Proposed adjustment (30 points)

- **Summary of misstatements (`spreadsheet`, 10):** one row per sampled item; the four exception cells (2 each) and the total (2). Clean items aren't scored. Total = sum of the four planted errors for every seed.
- **Pass or propose (`multiple_choice`, single select, 4):** **"Pass: below clearly trivial"** or **"Propose the adjustment"**, against the clearly trivial threshold in Marcus's memo. The threshold is seeded so roughly half of candidates should pass and half propose; the screen is the same for everyone.
- **Adjusting entries (`journal_entry`, 4 × 2):**

| Entry | Debit | Credit |
| --- | --- | --- |
| Amount | Accounts payable (Cash accepted) | The expense account booked |
| Cutoff | Accounts payable (Accrued liabilities accepted) | Repairs & maintenance |
| Personal | Due from officer | Meals & entertainment |
| No support | Accrued liabilities | Professional fees |

- **Summary to Marcus (`inbox_reply`, 8):** count, total and pass/propose call (3); a line on each exception (3); short and organized (2).

### Scoring (100 points)

| Area | Points |
| --- | --- |
| Rapid round A: tick and tie (15 items, 2 fields each) | 10 |
| Vouching: 4 exceptions × 5 (half for the right item with the wrong reason; −1 per false flag) | 20 |
| Vouching: conclusion on the sample (multiple choice) | 5 |
| Rapid round B: cutoff (15 items, 2 fields each) | 10 |
| Reply to the controller (reviewer) | 5 |
| Exception count / total misstatement | 2 / 3 |
| Bank confirmation: flag / next step | 2 / 3 |
| Rapid round C: sample selection (15 items, 1 field each) | 10 |
| Summary of misstatements: 4 items × 2, total 2 | 10 |
| Pass or propose (multiple choice) | 4 |
| Adjusting entries: 4 × 2 | 8 |
| Summary to Marcus (reviewer) | 8 |
| **Total** | **100** |

A perfect attempt shows 87 automatic points until a reviewer marks the two replies. The rapid rounds also report the median response time (0 points).

### Accepted for v1 (forced by the current step types)

- Each vouching pair holds exactly one exception, because `document_review` findings are fixed in the config. Trap types and positions move per seed.
- The controller mentions one missing item, not two, so the four planted traps stay as specified.
- Message senders (Marcus Avery, Renee Okafor) are fixed: `from` lines aren't templated. Everything inside the messages is seeded.
- Rapid-round items carry 0.5 or 0.75 points (first five vs the rest) so each round adds up to exactly 10; 2/3 of a point each would not.
- The time limit is 52 minutes (the six sections as specified), not 50.

### For the accountant reviewing this draft

- Treating the whole unsupported accrual as a known misstatement, reversed against Accrued liabilities.
- The personal expense debited to Due from officer (not officer compensation).
- The cutoff entry against Accounts payable or Accrued liabilities.
- The engagement rule "pass below clearly trivial, propose at or above", with clearly trivial at 5% and performance materiality at 75% of overall. A real team would also weigh a 4-of-8 exception rate (projection, control findings); Marcus says he handles projection.
- The bank confirmation's expected next step.
- Rapid round A: a January-dated document against a December schedule line counts as "date or cutoff" whatever the document type, including a bank confirmation dated in January.
- Rapid round B: FOB terms decide the year for purchases as well as sales; the invoice date never does. "Recorded in GL" is the posting date.
- Rapid round C: the sample-selection rule ("every item over $T, plus every kth item number starting at #s") and the reading that the interval runs over item numbers, key items included; the seeding avoids any line where the two readings would differ.
- Section lengths: 2¾ minutes per vouching pair plus 1 minute for the sample conclusion, 4 minutes for the controller reply.

## Example 6: Corporate AP intern, payment run day (52 min, 100 points)

**Status: draft: needs accountant review.** Built as `corporate-ap-ridgeway` v1 in `src/lib/engine/scenarios/corporate-ap-ridgeway.ts`, tests in `tests/engine/corporate-ap-ridgeway.test.ts`. Six timed sections (`06-assessment-engine.md`, "Timed sections and rapid rounds"): three rapid rounds (30 points) between the phase A work (70 points). Published to the cloud library as v1 on 2026-11-17 for the team's own testing; review fixes ship as v2.

**Setup:** "You're an accounts payable intern in the in-house finance team at Ridgeway Outdoor Supply, an outdoor gear retailer. Your manager is Priya Desai, the AP lead. Today is the mid-month payment run."

Seeded per candidate: every amount, quantity, vendor and contact name, email domain, phone number, invoice / PO / receiving report number and date, **which of the four match documents holds which trap**, and every rapid item (its amounts and names, and which item comes when). Numbers below are one variant (seed `abc`).

### Sections

Sections run back to back; a finished section can't be reopened. The overall timer never pauses. Total 52 minutes (`timeLimitMinutes` 52; `validateSections` passes).

| # | Section | Minutes | Steps | Points |
| --- | --- | --- | --- | --- |
| 1 | Rapid round A: journal entries | 6 | `rapid-je` (15 items × 20 s) | 10 |
| 2 | Three-way match, one screen at a time | 12 | `match-1` … `match-4` (2.5 min each), then `post-bills` (2 min) | 25 |
| 3 | Rapid round B: pay or hold | 6 | `rapid-pay` (15 × 20 s) | 10 |
| 4 | AP inbox, one screen at a time | 10 | `vendor-reply` (3 min), `run-total` (3 min), `bank-change` (4 min) | 15 |
| 5 | Rapid round C: cash application | 6 | `rapid-cash` (15 × 20 s) | 10 |
| 6 | Vendor statement | 12 | `statement-rec`, `statement-reply` | 30 |

The four match screens are 2.5 minutes, not 3, so the posting step fits in the section's 12 minutes (the screens add up to the section exactly). A rapid round's 15 items take 5 minutes, inside the 6-minute section.

### Messages

Messages linked to a step arrive relative to their section's start (so they come earlier when a candidate finishes a section early).

| Arrives | From | Delivers |
| --- | --- | --- |
| Section 2 + 0 | Priya: match queue for today's run, the AP policy ("pay only when PO, receiving report and invoice agree on quantity and price and we haven't paid it before; any difference, however small, goes on hold"), and two bills she approved yesterday that are already in the run | Three-way match |
| Section 4 + 0 | The short-shipped vendor's AR clerk: "Is invoice TP-26323 for $1,392.23 in today's run?" | Reply to the vendor |
| Section 4 + 0 | Priya forwards an AP-inbox email: "Updated remittance details" | Bank-change review |
| Section 4 + 0 | Priya: "Total approved for today's run? Number only." with the four invoices from the match queue (vendor, number, total) for reference | Run total |
| Section 6 + 0 | Priya: a fifth vendor's statement doesn't agree with our AP subledger | Statement rec |
| Section 6 + 1 | Priya: "Send me a short note, under 120 words: the balance we owe, what to ask them for, and the entry we need." | Note to Priya |

The inbox messages all arrive when the inbox section opens: its screens can be moved on early, and a screen shouldn't open before its brief. Because the match screens are closed by then, the inbox carries what it needs: the vendor reply shows the held invoice's match record (item, invoiced, received), and the run-total email lists all four invoices without saying which was approved.

### Rapid rounds (30 points)

Each round is 15 items × 20 seconds. Items 3, 6, 9, 12 and 15 hold the harder kinds and are worth 1 point; the other ten are worth ½, so each round is exactly 10. The order within each tier is shuffled per seed. Each item has two pick-one fields scored separately (half the item each). The step type adds a 0-point response-time line (median and unanswered count).

**A · Journal entry flash** (`rapid-je`). A one-line transaction with a seeded amount; Debit and Credit from one short chart of 13 accounts (Cash, Accounts receivable, Supplies, Prepaid insurance, Equipment, Accounts payable, Wages payable, Unearned revenue, Service revenue, Wages expense, Utilities expense, Supplies expense, Insurance expense).

| Tier | Transactions (10 of 12 quick ones per candidate; all 5 harder ones) |
| --- | --- |
| ½ point | Paid for 12 months of store insurance (Prepaid insurance / Cash); received from a customer on account (Cash / AR); bought store supplies on credit (Supplies / AP); paid a supplier for a recorded bill (AP / Cash); paid this week's wages (Wages expense / Cash); billed a customer for ski tuning (AR / Service revenue); cash for bike repairs today (Cash / Service revenue); paid the electricity bill (Utilities expense / Cash); received the electricity bill, to pay next month (Utilities expense / AP); bought store supplies for cash (Supplies / Cash); bought a display rack for cash or on account (Equipment / Cash or AP) |
| 1 point | Customer paid in advance for a repair (Cash / Unearned revenue); a month of prepaid insurance expired (Insurance expense / Prepaid insurance); finished prepaid repair work (Unearned revenue / Service revenue); wages earned, paid next month (Wages expense / Wages payable); store supplies used up (Supplies expense / Supplies) |

**B · Pay or hold** (`rapid-pay`). An invoice exhibit (vendor, invoice number and date, amount, PO) and one fact. The round's intro states the rules: pay only against a PO; over $5,000 needs Priya's approval; bank details changed by email are verified by phone first; never pay the same bill twice. Fields: Pay / Hold, and the reason (Nothing wrong, Bank details changed by email, No purchase order, Over the $5,000 approval limit, Same as an invoice already paid). Only one thing is wrong with any invoice, and only over-limit invoices are over $5,000 (the others run up to $4,950).

| Tier | Cases per candidate | Expected |
| --- | --- | --- |
| ½ point | 3 × vendor's bank details changed yesterday by email | Hold, bank details |
| ½ point | 3 × PO "None" (ordered by phone) | Hold, no purchase order |
| ½ point | 4 × "Goods received in full; the PO and the invoice agree" | Pay, nothing wrong |
| 1 point | 2 × "Last payment to this vendor: invoice (another number) for the same amount, dated the same day, paid" | Hold, already paid |
| 1 point | 2 × $5,001–9,800 with a clean fact | Hold, over the limit |
| 1 point | 1 × last payment to this vendor for a different amount and date (looks like the duplicate case) | Pay, nothing wrong |

**C · Cash application** (`rapid-cash`). Covering the receivables desk: a customer payment, its remittance advice and the customer's three open invoices. Fields: which invoices to apply it to (three seeded sets of invoices, or "None of these: hold it as unapplied cash") and what's left (Nothing / Short-pay: leave the shortfall open on the invoice / Unapplied cash: hold it and ask the customer). Every one of the seven sets of the open invoices adds up to a different amount, so at most one set matches a payment exactly; the options' ids are the same for every candidate, and the right one moves between them.

| Tier | Cases per candidate | Expected |
| --- | --- | --- |
| ½ point | 3 × remittance names one invoice, payment equals it | That invoice; nothing left |
| ½ point | 3 × no remittance, payment equals exactly one invoice | That invoice; nothing left |
| ½ point | 4 × remittance names two invoices, payment equals both | Both; nothing left |
| 1 point | 3 × remittance names one invoice "less $X for damaged items", payment = invoice − X (3–12%, at least $5) | That invoice; short-pay |
| 1 point | 2 × no remittance, payment more than 15% away from every set of invoices | None; unapplied cash |

### Part 1 · Three-way match (25 points)

Four `document_review` steps, one per vendor. Each shows the PO (number, date), the receiving report (number, date), the invoice (number, date, terms), the last payment to that vendor, and a line table with PO qty, PO unit price, received qty, invoiced qty, invoice unit price and amount. Each invoice has two merchandise lines and one store-use line. The candidate flags what breaks the match with a reason, then chooses **Pay** or **Hold**.

Planted, one each, shuffled across the four documents:

| Trap | What the document shows (seed `abc`) | Expected |
| --- | --- | --- |
| Short shipment | Timberline Packs: fleece pullovers ordered 14, received 11, billed 14 | Flag the line (or the total), reason "Billed for more than we received"; Hold |
| Price above PO | Granite Peak Footwear: water bottles billed $12.77 a unit, PO $11.40 | Flag the line (or the total), reason "Price is higher than the PO"; Hold |
| Already paid | High Desert Hydration: invoice HDH-31099 $1,622.85; "Last payment to this vendor: Invoice HDH-31099 · $1,622.85 · paid Oct 15" | Flag the invoice number (or the last-payment row), reason "Duplicate: already paid"; Hold |
| Clean match | Lakeshore Lantern Co.: everything agrees, $1,069.56 | Tick "Nothing wrong here" (`document_review` `confirmClean`, 3); Pay |

Every match screen offers "Nothing wrong here" (it can't be ticked while items are flagged), so its presence gives nothing away. Ticking it on a document that has a problem costs 1, like a false flag. Every document shows a last payment, so its presence gives nothing away either; only the duplicate's invoice number matches it. The duplicate's PO, receiving report and invoice are dated September / October, the others late October / November.

Then a `journal_entry` step posts the approved invoice (the clean one): Dr Merchandise Inventory (the two merchandise lines, $764.70), Dr Store Supplies Expense (the store-use line, $304.86) / Cr Accounts Payable $1,069.56. The prompt asks for one debit line per account. Priya's two pre-approved bills are already posted.

### Part 2 · Inbox under pressure (15 points)

- **(a) Vendor chasing the held invoice** (`inbox_reply`, 5): rubric: explains the hold with the facts (received 11, billed 14) 2; asks for a corrected invoice or credit memo (or ship the balance), paid once it matches 2; courteous, no promised date 1.
- **(b) Run total** (`numeric`, 4): Priya's two pre-approved bills plus the clean invoice: $2,674.06 + $1,278.43 + $1,069.56 = **$5,022.05**. No partial credit. Including any held invoice (e.g. the duplicate) is wrong.
- **(c) Bank-details change** (`document_review`, 6): an email "from" the clean vendor (the one being paid today) at a lookalike domain (`lakeshorelantern-remit.com` against `lakeshorelantern.com` on file), asking to switch remittance to a new account before today's run, saying the old account closes this week, and giving a new phone number. The vendor master's email and phone are shown. Findings: lookalike domain 1.5; unverified bank change 1.5; pressure or new contact number 1 (either line). False flags cost 0.5. Decision 2: **change nothing; call the vendor on the number on file and tell Priya**. Wrong decisions offered: update the bank details, reply to the email to confirm, call the number in the email.

### Part 3 · Vendor statement reconciliation (30 points)

`spreadsheet` (20): the vendor's statement (as of Nov 12) and our AP subledger for them, both opening at October's agreed balance, then a reconciliation template.

| | Seed `abc` |
| --- | --- |
| Balance per vendor statement, Nov 12 | 8,669.02 |
| Less: payment sent 11/13, not on the statement (in transit) | (1,520.04) |
| **Adjusted vendor balance** | **7,148.98** |
| Balance per AP subledger | 5,120.41 |
| Add: invoice NPW-47229 on the statement, never received | 2,160.47 |
| Less: credit memo CM-1706 (returned goods) not booked | (311.90) |
| Add / (less): invoice NPW-47154 keyed at 3,130.41, billed 3,310.41 (transposition) | 180.00 |
| **Adjusted AP balance** | **7,148.98** |

Scoring: each of the four planted items 4, each adjusted balance 2. The keying error is a hundreds/tens transposition, either direction, so its sign matters.

`inbox_reply` to Priya (10), under ~120 words: states the balance we owe (7,148.98) and that the difference is explained 3; asks the vendor for a copy of invoice NPW-47229 (and checks the goods arrived before booking) and of credit memo CM-1706 3; names the entries 2: book the credit memo (Dr AP / Cr Merchandise Inventory), correct the keyed invoice (here Dr Merchandise Inventory / Cr AP 180.00), record the missing invoice once received and approved; no entry for the payment in transit; brief and forwardable 2.

### Scoring (100 points)

| Area | What earns points | Points |
| --- | --- | --- |
| Rapid A: JE flash | Debit and credit, half the item each; 10 items × ½ + 5 × 1 | 10 |
| Three-way match | Per document: the right flag and reason 3 (half for the right item with another reason), or "Nothing wrong here" on the clean match 3; Pay / Hold 2; × 4 | 20 |
| Posting | The clean invoice to Inventory, Supplies and AP | 5 |
| Rapid B: pay or hold | Decision and reason, half the item each | 10 |
| Vendor reply | Rubric (reviewer) | 5 |
| Run total | Pre-approved bills + clean invoice | 4 |
| Bank-change email | Domain 1.5, bank change 1.5, pressure / new contact 1, decision 2 | 6 |
| Rapid C: cash application | Invoices and what's left, half the item each | 10 |
| Statement rec | Four planted items 4 each, both adjusted balances 2 each | 20 |
| Note to Priya | Rubric (reviewer) | 10 |
| **Total** | | **100** |

A perfect attempt shows 85 automatic points until a reviewer marks the two replies. Each trap answered wrongly costs exactly its own points (tested): paying the duplicate, the short shipment or the price variance costs that document's 5; holding the clean invoice with an invented problem costs 5; paying it without ticking "Nothing wrong here" costs 3; ticking it on a document with a problem costs 1; updating the bank details without flags costs 6, and calling the number in the email or replying to it costs the 2 decision points. Knock-on effects are scored where they land: a run total that includes a held invoice loses the 4 numeric points.

### Judgment calls for the accountant review

- Policy is strict (no price tolerance, hold the whole invoice on a short shipment). Many companies short-pay the received quantity or allow a small price tolerance; Priya's email states the strict policy so the key is unambiguous.
- Posting a held invoice as well isn't penalised by `journal_entry` (extra entries score 0 and are listed for the reviewer).
- Merchandise goes to inventory (perpetual system), store-use items to Store Supplies Expense. The journal step asks for one debit line per account, because splitting inventory over two lines costs the leftover-line penalty.
- The unreceived invoice is added on our side of the rec (we owe it once received and approved), and the credit memo is booked against Merchandise Inventory (returned goods). An accountant may prefer a purchase returns account or to leave the unreceived invoice as a vendor-side item until it's verified.
- The phishing email is auto-scored as a `document_review` rather than a written reply, so the trap can be tested exactly. A candidate who would also forward it to IT or security gets no extra credit.
- Time: the sections add up to 52 minutes, not 50, to keep 6-minute rapid rounds and 12-minute match and statement sections. The match screens are 2.5 minutes each (not 3) so the posting step gets 2 minutes.
- The JE flash uses its own short chart, where supplies bought are an asset (Supplies) and expensed when used. The three-way match posts store-use items straight to Store Supplies Expense. Both are common; a reviewer may want one treatment across the whole test.
- JE flash revenue items (ski tuning, bike repairs) give a retailer a service-revenue line; the round is about debit/credit mechanics, not Ridgeway's revenue mix.
- Pay or hold: the "near miss" (a prior payment to the same vendor for a different amount and date) is a Pay. Over-limit invoices are held, not paid "pending approval". A bank-details change is held even when the invoice is otherwise fine.
- Cash application sits in an AP scenario (covering the receivables desk). A short-pay is applied to the invoice with the shortfall left open; an unidentifiable payment is held as unapplied cash, not applied to the oldest invoice. Some teams apply on-account cash oldest-first.
- The rapid rounds weight the harder kinds (accruals and deferrals; duplicates, over-limit and the near miss; short-pays and unapplied cash) at 1 point and the rest at ½. A uniform ⅔ point would not add up to exactly 10.
- Sections close their screens, so the inbox shows the held invoice's match record in the vendor-reply prompt and the four queue invoices in the run-total email. The run total still depends on the candidate's own match decisions.

## Example 7: Tax intern, Schedule C at Hollis Tax & Accounting (52 min, 100 points)

**Status: draft: needs accountant review.** Built as `tax-hollis-schedule-c` v1 in `src/lib/engine/scenarios/tax-hollis-schedule-c.ts`, tests in `tests/engine/tax-hollis-schedule-c.test.ts` and `e2e/simulations/tax-hollis-schedule-c.spec.ts`. Six timed sections (`06-assessment-engine.md`, "Timed sections and rapid rounds"): three rapid rounds (30 points) between the organize, inbox and Schedule C work (70 points).

**Setup:** "You're a tax intern at Hollis Tax & Accounting in the middle of busy season. Your manager is Elena Vasquez. Today you're on one client's return: a graphic designer who works for themselves and files Schedule C."

Seeded per candidate: the client's name, every payer, employer, bank, fund and lender name, every amount, mileage, square footage and date, which document sits on which organize screen and in which position, which payer's 1099-NEC is missing, and every rapid item (its amounts and names, and which item comes when). Elena's name and the firm are fixed.

### Tax year and rules (for the accountant reviewer to confirm)

The tax year is fixed in the scenario config: **2025** (`TAX_YEAR`, with the rates below in `RATES`). Every rule and rate the key uses:

| Rule | Value used | Where |
| --- | --- | --- |
| Standard mileage rate, business use, 2025 | 70 cents a mile | Rapid C, Schedule C line 9 |
| Standard mileage rate replaces actual car costs | Gas, repairs and car insurance are not added; business parking and tolls are | Rapid C, Schedule C (gas left off) |
| Simplified home office method | $5 a square foot, up to 300 square feet ($1,500 cap) | Rapid C, inbox (b), Schedule C line 30 |
| Net earnings from self-employment | 92.35% of Schedule C net profit (Schedule SE line 4a) | Rapid C |
| Self-employment tax | 12.4% social security + 2.9% Medicare = 15.3% of net earnings; every amount stays under the 2025 social security wage base ($176,100) | Rapid C |
| Deduction for half of SE tax | 50% of SE tax (Schedule 1) | Rapid C |
| Business meals | 50% deductible (client meals, meals on business travel) | Rapid B, Rapid C, Schedule C line 24b |
| Entertainment | Not deductible (tickets to a game with a client) | Rapid B |
| Club dues | Not deductible (country club, even when clients are met there) | Rapid B |
| Fines and penalties | Not deductible (parking ticket, IRS late-filing penalty) | Rapid B, Schedule C |
| Personal and family costs | Not deductible (groceries, family streaming, a family trip where work email was checked) | Rapid B, organize, inbox (a), Schedule C |
| Federal income tax | Not deductible on Schedule C | Rapid B |
| De minimis safe harbor | Hollis elects it for every client: equipment of $2,500 or less per item is expensed in full; over $2,500 is capitalized | Rapid B, organize, Schedule C |
| Section 179 | Elected on the laptop: its full cost goes on Schedule C line 13 | Schedule C |
| Self-employed health insurance | Not a Schedule C expense (it belongs on Schedule 1) | Schedule C |
| 1099-NEC threshold | Business payers issue a 1099-NEC for $600 or more of services in 2025; the income is reportable with or without one | Organize, inbox (c), Schedule C |
| Prior-year safe harbor for estimates | 110% of last year's tax when last year's AGI was over $150,000, in four equal payments | Rapid C |
| Points on a home purchase | Form 1098 box 6 points go on Schedule A line 8a with box 1 interest | Rapid A |
| Form-to-line map (2025 forms) | W-2 box 1 → 1040 line 1a; W-2 box 2 → 1040 line 25a; 1099-NEC box 1 → Schedule C line 1; 1099-INT boxes 1 and 3 → 1040 line 2b; 1099-INT box 8 → 1040 line 2a; 1099-DIV box 1a → 1040 line 3b; 1099-DIV box 1b → 1040 line 3a; 1099-DIV box 2a → Schedule D line 13; Form 1098 box 1 → Schedule A line 8a | Rapid A |

**Rounding and tolerance.** Like the IRS forms, every number answer is in whole dollars: cents are added first and only the result is rounded, 50 cents and up to the next dollar. Rapid number items and Elena's net profit question accept the key ±$1 (so truncating instead of rounding still counts). On the Schedule C sheet line 1, line 30 and each expense line accept ±$1; the three totals (lines 28, 29 and 31) accept ±$3, so a candidate who rounds once at the end rather than line by line isn't penalised. A miss by more than that earns 0 for the cell.

### Sections

Sections run back to back; a finished section can't be reopened. The overall timer never pauses. Total 52 minutes (`timeLimitMinutes` 52; `validateSections` passes).

| # | Section | Minutes | Steps | Points |
| --- | --- | --- | --- | --- |
| 1 | Rapid round A: form to field | 6 | `rapid-forms` (15 × 20 s) | 10 |
| 2 | Organize the documents, one screen at a time | 12 | `sort-1`, `sort-2`, `sort-3`, `deposits` (3 min each) | 25 |
| 3 | Rapid round B: deductible? | 6 | `rapid-deduct` (15 × 20 s) | 10 |
| 4 | Inbox, one screen at a time | 10 | `vacation-reply` (3 min), `net-profit` (3 min), `late-reply` (4 min) | 15 |
| 5 | Rapid round C: quick calcs | 6 | `rapid-calcs` (15 × 20 s) | 10 |
| 6 | Schedule C | 12 | `schedule-c`, `elena-summary` | 30 |

The inbox screens are 3, 3 and 4 minutes so they fill the 10-minute section (the last reply has the most to say).

### Messages

| Arrives | From | Delivers |
| --- | --- | --- |
| Section 1 + 0 | Elena: warm-up while she pulls the file | Rapid A |
| Section 2 + 0 | Elena: the client's folder is in; sort three batches of three, then check deposits against the 1099s; Hollis elects the $2,500 de minimis safe harbor | Organize |
| Section 3 + 0 | Elena: quick deductibility checks | Rapid B |
| Section 4 + 0 | Client: "Can I deduct our family trip? I checked work email every day." | Vacation reply |
| Section 4 + 0 | Elena: her draft numbers (gross receipts before the late 1099, total expenses, home office square feet). "Net Schedule C profit? Number only." | Net profit |
| Section 4 + 0 | Client: found a 1099-NEC they'd forgotten (the payer missing from the deposits screen), with its amount. "Does it change anything?" | Late 1099 reply |
| Section 5 + 0 | Elena: quick calcs | Rapid C |
| Section 6 + 0 | Elena: build the Schedule C input sheet from the organizer, with everything we know as of today; standard mileage, simplified home office, Section 179 on the laptop | Schedule C |
| Section 6 + 1 | Elena: "Send me a short note: net profit, open items, documents we still need." | Note to Elena |

All inbox messages arrive when the inbox opens (a screen can be moved on early and shouldn't open before its brief). Elena's net profit question says it is on her draft numbers, so the key for (b) is before the late 1099; the late 1099 changes the Schedule C sheet in section 6.

### Rapid rounds (30 points)

Each round is 15 items × 20 seconds, one field per item. Items 3, 6, 9, 12 and 15 hold the harder kinds and are worth 1 point; the other ten are worth ½, so each round is exactly 10. The order within each tier is shuffled per seed. The step type adds a 0-point response-time line.

**A · Form to field** (`rapid-forms`). A tax form laid out by box (W-2, 1099-NEC, 1099-INT, 1099-DIV or 1098, 2025) with seeded payer, recipient and amounts.

| Tier | Item | Expected |
| --- | --- | --- |
| ½ point (pick the line; 10 kinds, one each) | W-2 box 1; W-2 box 2; 1099-NEC box 1; 1099-INT box 1; 1099-INT box 3; 1099-INT box 8; 1099-DIV box 1a; 1099-DIV box 1b; 1099-DIV box 2a; 1098 box 1 | The line in the form-to-line map above, from one list of nine lines (the same list on every item) |
| 1 point (type the amount, whole dollars, ±$1) | W-2 with a 401(k) deferral: line 1a | Box 1 (not box 3) |
| | 1099-INT: taxable interest for line 2b | Box 1 + box 3 (box 8 is tax-exempt) |
| | 1099-DIV: line 3b | Box 1a (1b is part of it) |
| | Two 1099-NECs to the same person: Schedule C line 1 | The two box 1 amounts added |
| | Form 1098: Schedule A line 8a | Box 1 + box 6 points |

**B · Deductible?** (`rapid-deduct`). One expense from the client's 2025 records with a seeded amount. One field: Fully deductible / 50% deductible / Not deductible / Capitalize and depreciate (or Section 179). The round's intro states Hollis's de minimis policy. The rule table (each rule has its own test):

| Tier | Rule id | Expense | Expected |
| --- | --- | --- | --- |
| ½ | `software` | Annual design software subscription | Fully deductible |
| ½ | `insurance` | Business liability insurance for the year | Fully deductible |
| ½ | `stock` | Stock photo license for a client's brochure | Fully deductible |
| ½ | `ads` | Promoted posts to find new clients | Fully deductible |
| ½ | `supplies` | Printer ink and paper for client proofs | Fully deductible |
| ½ | `hosting` | Hosting and domain for the portfolio website | Fully deductible |
| ½ | `client-meal` | Lunch with a client about a project | 50% deductible |
| ½ | `travel-meal` | Dinner on an overnight trip for a client shoot | 50% deductible |
| ½ | `parking-ticket` | Parking ticket outside a client's office | Not deductible |
| ½ | `groceries` | Groceries for the family | Not deductible |
| ½ | `income-tax` | Federal estimated income tax payment | Not deductible |
| ½ | `streaming` | Family streaming subscription | Not deductible |
| 1 | `laptop` | A laptop for design work, $2,600 to $3,900, one item | Capitalize and depreciate (or Section 179) |
| 1 | `monitor` | A monitor for design work, $300 to $2,400, one item | Fully deductible (de minimis safe harbor) |
| 1 | `tickets` | Tickets to take a client to a basketball game | Not deductible (entertainment) |
| 1 | `club` | Country club dues; clients are met there | Not deductible |
| 1 | `penalty` | IRS penalty for filing last year's return late | Not deductible |

Ten of the twelve ½-point rules and all five 1-point rules appear per candidate.

**C · Quick calcs** (`rapid-calcs`). One number field, whole dollars, ±$1. The intro gives the 2025 rates (70 cents a mile; $5 a square foot up to 300 square feet; SE tax is 15.3% of 92.35% of net profit) and the rounding rule.

| Tier | Kind (two each at ½, one each at 1) | Expected |
| --- | --- | --- |
| ½ | Home office, 90 to 300 sq ft | sq ft × $5 |
| ½ | Business miles | miles × $0.70, rounded |
| ½ | Net earnings from self-employment | net profit × 92.35%, rounded |
| ½ | Client meals | half, rounded |
| ½ | Tax due spread over four estimates | tax ÷ 4, rounded |
| 1 | Home office over 300 sq ft | $1,500 (the cap) |
| 1 | Self-employment tax | base = profit × 92.35%, rounded; then round(base × 12.4%) + round(base × 2.9%), as Schedule SE lines 10 and 11 |
| 1 | Half of SE tax | SE tax ÷ 2, rounded |
| 1 | Prior-year safe harbor, last year's AGI over $150,000 | last year's tax × 110% ÷ 4, rounded |
| 1 | Miles plus business parking and tolls | miles × $0.70 + parking + tolls, rounded once |

### Part 1 · Organize the documents (25 points)

Three `document_review` screens (`sort-1` … `sort-3`), each a table of three documents from the client's folder (document, from, date, details, amount). The candidate flags every document and picks what it is: **Income**, **Deductible business expense**, **Business asset (capitalize)**, **Personal: not deductible**, or **Need more info from the client**. Each document is a 2-point finding: the right category earns 2, a flag with another category 1 (the step type's half credit for the right item), no flag 0. Nine documents per candidate, shuffled across the three screens:

| Category | Documents (per candidate) |
| --- | --- |
| Income | The two 1099-NECs in the folder (payers A and B) |
| Deductible business expense | 3 of: design software annual plan; business liability insurance; portfolio hosting and domain; stock photo license for a client job; lunch with a client (50% deductible, still a business expense) |
| Business asset | A laptop for design work over $2,500 (one item) |
| Personal | 2 of: family groceries; kids' summer camp; family streaming plan; gym membership |
| Need more info | 1 of: a Venmo payment to a first name with a vague memo (a contractor? W-9 and 1099-NEC); a phone bill used for business and personal calls (business share?); an online order with no item details |

The fourth screen (`deposits`, `document_review`, 7) shows the two 1099-NECs in the folder and the client's 2025 business deposits by payer: payer A and payer B (each agreeing to its 1099), payer C (no 1099-NEC in the folder: **the missing one**, $1,800 to $7,500), and a row of small clients each under $600 for the year. Flag payer C's row with **1099-NEC expected but not in the folder** (4; half for another reason). Flagging any other row or field is a false flag (−1). Decision (3): **Ask the client for the missing 1099-NEC, and report the income either way**. Wrong: leave it off until the form arrives; leave it off because the IRS won't know.

### Part 2 · Inbox (15 points)

- **(a) Family vacation** (`inbox_reply`, 5): says no, clearly (2); plain-language why: the trip's main purpose was a family vacation, and checking email or one call doesn't make it a business trip (2); friendly and short, no jargon (1).
- **(b) Net profit** (`numeric`, 4, whole dollars, ±$1): Elena's draft gross receipts − her draft total expenses − home office square feet × $5. Her draft gross receipts are the organizer's income before the late 1099 (payers A and B plus small clients); her total expenses equal Schedule C line 28. No partial credit.
- **(c) Late 1099** (`inbox_reply`, 6): thanks the client, says it will be added and that it matches the payer C deposits (1); what changes: gross receipts and net profit go up by the 1099 amount, and so do self-employment tax and income tax (3); calm and plain, says the return will be updated before filing or offers to check estimated payments (2).

### Part 3 · Schedule C input sheet (30 points)

`spreadsheet` (20). The top is the client's organizer (prepared by the client); the bottom is a Schedule C input screen laid out like tax software (line number, line name, amount; whole dollars), not a copy of any vendor's screen.

| Organizer item | Goes to | Treatment |
| --- | --- | --- |
| 1099-NEC payer A, 1099-NEC payer B, payments from small clients (no 1099s) | Line 1 | added |
| The late 1099-NEC (payer C), only in the client's email | Line 1 | **added** |
| Promoted posts; print ad in the local business directory | Line 8 Advertising | added, rounded once |
| Business miles (log kept) | Line 9 Car and truck | miles × $0.70 |
| Gas for the car | Left off | the standard mileage rate covers it |
| Laptop for design work | Line 13 Depreciation and section 179 | full cost (Section 179) |
| Business liability insurance | Line 15 Insurance | |
| Health insurance premiums (self only) | Left off | Schedule 1, not Schedule C |
| Last year's tax prep fee for the Schedule C | Line 17 Legal and professional | |
| Printer ink and paper; sketchbooks, markers and mounting board | Line 22 Supplies | added, rounded once |
| Client meals (full amount) | Line 24b Deductible meals | 50% |
| Design software subscriptions; professional association dues | Line 27a Other expenses | added, rounded once |
| Parking ticket outside a client's office | Left off | a fine |
| Family trip (the one from inbox (a)) | Left off | personal |
| Home office, seeded sq ft (90 to 300) | Line 30 | sq ft × $5 |

Lines 28 (total expenses = the eight expense lines), 29 (line 1 − line 28) and 31 (line 29 − line 30) complete the sheet. Points: line 1 3; lines 8, 9, 13, 15, 17, 22, 24b and 27a 1.5 each (12); line 28 1; line 29 1; line 30 1; line 31 2 (20 in all).

`inbox_reply` to Elena (10): net profit including the late 1099 (3); what was left off and why: the family trip, gas, the parking ticket, the health insurance (to Schedule 1) (3); documents still needed: the "need more info" item from the organize screens (2); short and organized (2).

### Scoring (100 points)

| Area | What earns points | Points |
| --- | --- | --- |
| Rapid A: form to field | 10 items × ½ + 5 × 1 | 10 |
| Organize | 9 documents × 2 | 18 |
| Deposits vs 1099s | Missing 1099-NEC flagged 4 (−1 per false flag), decision 3 | 7 |
| Rapid B: deductible? | 10 × ½ + 5 × 1 | 10 |
| Vacation reply | Rubric (reviewer) | 5 |
| Net profit | Elena's draft numbers, ±$1 | 4 |
| Late 1099 reply | Rubric (reviewer) | 6 |
| Rapid C: quick calcs | 10 × ½ + 5 × 1 | 10 |
| Schedule C sheet | Line 1 3, eight expense lines 1.5 each, lines 28/29/30 1 each, line 31 2 | 20 |
| Note to Elena | Rubric (reviewer) | 10 |
| **Total** | | **100** |

A perfect attempt shows 79 automatic points until a reviewer marks the three replies. Each trap answered wrongly costs exactly (tested):

- A Schedule C sheet that ignores the late 1099: line 1, line 29 and line 31 are each short by the 1099 amount: **−6** (3 + 1 + 2). Line 28 is unaffected.
- Gas added to line 9, the meals at 100%, the health insurance on line 15, the parking ticket or the family trip on line 27a: that line (1.5), line 28 (1), line 29 (1) and line 31 (2): **−5.5** each.
- Missing 1099-NEC not flagged: −4; flagged with another reason: −2; the small-clients row flagged as well: −1; leaving the income off until the form arrives: −3.
- An organize document flagged with the wrong category: −1; not flagged: −2.
- Elena's net profit with the home office left out or the late 1099 added: −4.
- A rapid item wrong or timed out: its ½ or 1.

### Judgment calls for the accountant review

- Every rule and rate in the table above, for tax year 2025, and the whole-dollar rounding with ±$1 (±$3 on the Schedule C totals).
- Organize uses `document_review`, so a document flagged with the wrong category still earns half (the step type's rule for the right item with another reason). No flag earns 0.
- The client lunch is sorted as a deductible business expense (the 50% limit is applied on the Schedule C sheet and in Rapid B), not as a category of its own.
- The deposits screen expects the income reported whether or not the 1099-NEC arrives; the small-clients row (each under $600) is the false-flag trap.
- Elena's (b) question is on her draft numbers, before the late 1099, and her draft total expenses equal Schedule C line 28; the Schedule C sheet then adds the late 1099. A candidate who adds the late 1099 to (b) loses (b)'s 4 points.
- Section 179 on the laptop (not regular or bonus depreciation); the laptop is over the $2,500 de minimis limit, the Rapid B monitor under it.
- The family trip, gas under the standard mileage rate, the parking ticket and self-employed health insurance are left off Schedule C; the health insurance belongs on Schedule 1.
- Rapid A puts 1098 box 6 points on a home purchase on line 8a with the interest, and treats 1099-INT box 3 as taxable on the federal return.
- Rapid C's safe-harbor item expects 110% of last year's tax (AGI over $150,000) without stating the percentage; the other rates are given in the intro.
- Message senders are fixed (`from` lines aren't templated): Elena by name, the client as "Client portal message"; the client's seeded name is inside each message.
- Time: 52 minutes, not 50, to keep 6-minute rapid rounds and the 12/10/12 work sections.

## Step types needed

`inbox_reply`, `spreadsheet`, `journal_entry`, `document_review`. These four cover all three examples and most future accounting scenarios.
