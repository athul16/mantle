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

## Example 5: Audit intern, year-end fieldwork at Calder & Finch (~50 min, phase A)

**Status: draft: needs accountant review.** Built as `audit-calder-bluestem` v1 in `src/lib/engine/scenarios/audit-calder-bluestem.ts`, tests in `tests/engine/audit-calder-bluestem.test.ts`. Extends Example 2 (vouching) into a full session with the Example 4 message pattern. Numbers below describe the structure; every amount, payee, officer, date, document number, and which item in which pair holds which trap is seeded per candidate.

**Setup:** "You're an audit intern at Calder & Finch LLP. It's fieldwork week on the December 31, 2025 year-end audit of Bluestem Manufacturing. Your senior, Marcus Avery, will send you work through the session, and the client's team will be in touch too."

### Timeline

| Minute | From | Delivers |
| --- | --- | --- |
| 0 | Marcus | Vouch a sample of 8 operating-expense entries (four pairs, all open from the start) |
| 8 | Renee Okafor, Controller | "Can you just skip that one and pick a different entry?" (the unsupported accrual) |
| 15 | Marcus | How many exceptions? |
| 16 | Marcus | And the total dollar misstatement? |
| 22 | Marcus | The bank confirmation came back $X higher / lower than the cash lead schedule |
| 28 | Marcus | Materiality memo: overall, performance (75%) and clearly trivial (5%); pass below clearly trivial, propose at or above |
| 30 | Marcus | Draft the adjusting entries |
| 32 | Marcus | Summary for partner review |

### Part 1 · Expense vouching (25 points, `document_review` × 4)

Each pair shows, per item, the GL line (ref, date, payee, description, account, amount) and the support row (vendor invoice, card receipt, or "No support provided"). The candidate flags the GL line of each exception with a reason. One trap per pair:

| Trap | What the candidate sees | Expected reason | Misstatement |
| --- | --- | --- | --- |
| Amount | GL amount has the hundreds and tens digits swapped against the invoice, GL higher (e.g. booked $2,418.50, invoice $2,148.50) | Amount doesn't agree to support | GL − invoice (a multiple of $90) |
| Cutoff | Invoice dated 01/03/2026 for January 2–3 work, posted 12/28–12/31/2025 to Repairs & maintenance | Wrong period (cutoff) | Full amount |
| Personal | Card receipt for a ski lodge family stay, jewelry, pet boarding or private boat storage, cardholder an officer, booked as "Client entertainment" | Not a business expense | Full amount |
| No support | Round-number 12/31 manual accrual ("Q4 consulting"), no invoice, contract or engagement letter; client says the officer agreed it by phone | No support | Full amount |

The four clean items agree on amount, date, payee and period. One clean option is a real client dinner booked to entertainment with attendees and business purpose on the receipt, so "entertainment" alone isn't the tell. After the last pair the candidate concludes on the sample: **"Exceptions noted: document them and work out the adjustment"** (not "no exceptions", "replace those items", or "ask the client to fix them").

### Part 2 · Inbox under pressure (15 points)

- **Controller (`inbox_reply`, 5):** politely declines to skip or swap the sampled item (2); asks for alternative support: engagement letter or contract, emails agreeing the fee, evidence the work was done, the invoice when it arrives (2); courteous, no promises (1).
- **Marcus's questions (`numeric` × 2):** count of exceptions, always 4 (2); total misstatement (3).
- **Bank confirmation (`document_review`, 5):** flag the confirmed balance, lead balance or difference as "Balances don't agree" (2); next step: **get the client's December 31 bank reconciliation, agree the confirmed balance to it and vouch the reconciling items** (3). Wrong: adjust cash to the confirmation, pass as immaterial, ask the client to have the bank change it. The payroll account agrees and is a false-flag trap.

### Part 3 · Proposed adjustment (30 points)

- **Summary of misstatements (`spreadsheet`, 14):** one row per sampled item; the four exception cells (2 each), the total (2), and the call: 1 = propose, 0 = pass (4). Clean items aren't scored. Total = sum of the four planted errors for every seed. The threshold is seeded so roughly half of candidates should pass and half propose.
- **Adjusting entries (`journal_entry`, 4 × 2):**

| Entry | Debit | Credit |
| --- | --- | --- |
| Amount | Accounts payable (Cash accepted) | The expense account booked |
| Cutoff | Accounts payable (Accrued liabilities accepted) | Repairs & maintenance |
| Personal | Due from officer | Meals & entertainment |
| No support | Accrued liabilities | Professional fees |

- **Summary to Marcus (`inbox_reply`, 8):** count, total and pass/propose call (3); a line on each exception (3); short and organized (2).

### Scoring, phase A (70 of 100 points)

| Area | Points |
| --- | --- |
| Vouching: 4 exceptions × 5 (half for the right item with the wrong reason; −1 per false flag) | 20 |
| Vouching: conclusion on the sample | 5 |
| Reply to the controller (reviewer) | 5 |
| Exception count / total misstatement | 2 / 3 |
| Bank confirmation: flag / next step | 2 / 3 |
| Summary of misstatements: 4 items × 2, total 2, pass or propose 4 | 14 |
| Adjusting entries: 4 × 2 | 8 |
| Summary to Marcus (reviewer) | 8 |

A perfect attempt shows 57 automatic points until a reviewer marks the two replies.

### Phase B TODO: rapid rounds (30 points)

Needs timed sections and the `rapid_round` step type (in progress on another branch). Then add three rapid rounds and bump to a new version:

1. **Tick-and-tie**, 15 items × 20 s: does this figure agree to that source?
2. **Cutoff call**, 15 items × 20 s: which year does this invoice or shipment belong in?
3. **Sample selection**, 15 items × 20 s: is this item in the population / a valid selection?

### Accepted for v1 (forced by the current step types)

- The pass/propose call is a number cell (1 or 0) in the summary spreadsheet; there is no multiple-choice step type yet.
- Each vouching pair holds exactly one exception, because `document_review` findings are fixed in the config. Trap types and positions move per seed.
- The controller mentions one missing item, not two, so the four planted traps stay as specified.
- Message senders (Marcus Avery, Renee Okafor) are fixed: `from` lines aren't templated. Everything inside the messages is seeded.
- Marcus's numbers are asked mid-task, so a candidate still vouching can come back and change them before submitting.

### For the accountant reviewing this draft

- Treating the whole unsupported accrual as a known misstatement, reversed against Accrued liabilities.
- The personal expense debited to Due from officer (not officer compensation).
- The cutoff entry against Accounts payable or Accrued liabilities.
- The engagement rule "pass below clearly trivial, propose at or above", with clearly trivial at 5% and performance materiality at 75% of overall. A real team would also weigh a 4-of-8 exception rate (projection, control findings); Marcus says he handles projection.
- The bank confirmation's expected next step.

## Step types needed

`inbox_reply`, `spreadsheet`, `journal_entry`, `document_review`. These four cover all three examples and most future accounting scenarios.
