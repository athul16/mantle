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

## Example 5: Corporate AP intern, payment run day (~50 min, phase A)

**Status: draft: needs accountant review.** Built as `corporate-ap-ridgeway` v1 in `src/lib/engine/scenarios/corporate-ap-ridgeway.ts`, tests in `tests/engine/corporate-ap-ridgeway.test.ts`. Phase A only: the parts that use existing step types, 70 points, as a normal scenario without sections. The three rapid rounds (30 points) come in phase B (see the TODO at the end).

**Setup:** "You're an accounts payable intern in the in-house finance team at Ridgeway Outdoor Supply, an outdoor gear retailer. Your manager is Priya Desai, the AP lead. Today is the mid-month payment run."

Seeded per candidate: every amount, quantity, vendor and contact name, email domain, phone number, invoice / PO / receiving report number and date, and **which of the four match documents holds which trap**. Numbers below are one variant (seed `abc`).

### Messages

| Minute | From | Delivers |
| --- | --- | --- |
| 0 | Priya: match queue for today's run, the AP policy ("pay only when PO, receiving report and invoice agree on quantity and price and we haven't paid it before; any difference, however small, goes on hold"), and two bills she approved yesterday that are already in the run | Three-way match 1 (2–4 and the posting are open from the start) |
| 15 | The short-shipped vendor's AR clerk: "Is invoice TP-26323 for $1,392.23 in today's run?" | Reply to the vendor |
| 22 | Priya forwards an AP-inbox email: "Updated remittance details" | Bank-change review |
| 28 | Priya: "Total approved for today's run? Number only." | Run total |
| 32 | Priya: a fifth vendor's statement doesn't agree with our AP subledger | Statement rec |
| 33 | Priya: "Send me a short note, under 120 words: the balance we owe, what to ask them for, and the entry we need." | Note to Priya |

### Part 1 · Three-way match (25 points)

Four `document_review` steps, one per vendor. Each shows the PO (number, date), the receiving report (number, date), the invoice (number, date, terms), the last payment to that vendor, and a line table with PO qty, PO unit price, received qty, invoiced qty, invoice unit price and amount. Each invoice has two merchandise lines and one store-use line. The candidate flags what breaks the match with a reason, then chooses **Pay** or **Hold**.

Planted, one each, shuffled across the four documents:

| Trap | What the document shows (seed `abc`) | Expected |
| --- | --- | --- |
| Short shipment | Timberline Packs: fleece pullovers ordered 14, received 11, billed 14 | Flag the line (or the total), reason "Billed for more than we received"; Hold |
| Price above PO | Granite Peak Footwear: water bottles billed $12.77 a unit, PO $11.40 | Flag the line (or the total), reason "Price is higher than the PO"; Hold |
| Already paid | High Desert Hydration: invoice HDH-31099 $1,622.85; "Last payment to this vendor: Invoice HDH-31099 · $1,622.85 · paid Oct 15" | Flag the invoice number (or the last-payment row), reason "Duplicate: already paid"; Hold |
| Clean match | Lakeshore Lantern Co.: everything agrees, $1,069.56 | Flag the "Three-way match" row with "All three agree"; Pay |

Every document shows a last payment, so its presence gives nothing away; only the duplicate's invoice number matches it. The duplicate's PO, receiving report and invoice are dated September / October, the others late October / November.

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

### Scoring, phase A (70 points)

| Area | What earns points | Points |
| --- | --- | --- |
| Three-way match | Per document: the right flag and reason 3 (half for the right item with another reason), Pay / Hold 2; × 4 | 20 |
| Posting | The clean invoice to Inventory, Supplies and AP | 5 |
| Vendor reply | Rubric (reviewer) | 5 |
| Run total | Pre-approved bills + clean invoice | 4 |
| Bank-change email | Domain 1.5, bank change 1.5, pressure / new contact 1, decision 2 | 6 |
| Statement rec | Four planted items 4 each, both adjusted balances 2 each | 20 |
| Note to Priya | Rubric (reviewer) | 10 |

A perfect attempt shows 55 automatic points until a reviewer marks the two replies. Each trap answered wrongly costs exactly its own points (tested): paying the duplicate, the short shipment or the price variance costs that document's 5; holding the clean invoice costs 5; updating the bank details without flags costs 6, and calling the number in the email or replying to it costs the 2 decision points. Knock-on effects are scored where they land: a run total that includes a held invoice loses the 4 numeric points.

### Judgment calls for the accountant review

- Policy is strict (no price tolerance, hold the whole invoice on a short shipment). Many companies short-pay the received quantity or allow a small price tolerance; Priya's email states the strict policy so the key is unambiguous.
- The clean match is answered by flagging a "Three-way match" row with "All three agree", because `document_review` needs at least one finding per document. This reads oddly next to the red Flag buttons.
- Posting a held invoice as well isn't penalised by `journal_entry` (extra entries score 0 and are listed for the reviewer).
- Merchandise goes to inventory (perpetual system), store-use items to Store Supplies Expense. The journal step asks for one debit line per account, because splitting inventory over two lines costs the leftover-line penalty.
- The unreceived invoice is added on our side of the rec (we owe it once received and approved), and the credit memo is booked against Merchandise Inventory (returned goods). An accountant may prefer a purchase returns account or to leave the unreceived invoice as a vendor-side item until it's verified.
- The phishing email is auto-scored as a `document_review` rather than a written reply, so the trap can be tested exactly. A candidate who would also forward it to IT or security gets no extra credit.

### TODO, phase B (30 points, after the sections engine and `rapid_round` merge)

Three timed rapid rounds, 15 items × 20 seconds each, 10 points each:

1. **JE flash**: pick the debit and credit for a one-line AP event (e.g. invoice for store supplies, payment of an invoice, credit memo for returned goods, early-payment discount taken).
2. **Pay or hold**: one-line PO / receipt / invoice summaries; Pay or Hold.
3. **Cash application**: match a vendor payment or remittance to the invoice(s) it pays.

Phase B turns the scenario into sections (match queue, inbox, rapid rounds, statement) and brings it to 100 points.

## Step types needed

`inbox_reply`, `spreadsheet`, `journal_entry`, `document_review`. These four cover all three examples and most future accounting scenarios.
