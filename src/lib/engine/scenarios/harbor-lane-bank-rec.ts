import "server-only";

import { defineScenario } from "../server/scenario";
import { formatCents } from "../server/template";
import { INBOX_REPLY } from "../step-types/inbox_reply/public";
import { JOURNAL_ENTRY } from "../step-types/journal_entry/public";
import { SPREADSHEET } from "../step-types/spreadsheet/public";

/**
 * docs/07 Example 4: Harbor Lane Coffee Co.'s October bank reconciliation,
 * with a voided check announced by Dana at minute 12. 30 minutes, 100 points:
 * reconciliation 45, journal entries 15, reply to Dana 40.
 *
 * Every amount and check number is seeded per candidate; payees, dates and
 * the planted items are fixed. The key is built from the same numbers as the
 * material, so the rec always ties. Derived figures (adjusted balance, the
 * check-error amount) exist only in the keys.
 *
 * Differences from docs/07 forced by the current step types:
 * - The workbook is one spreadsheet grid, not four tabs: bank statement and GL
 *   are read-only sections above the reconciliation, and journal entries are
 *   their own step. Candidates can't insert rows.
 * - The reconciliation has a fixed row per item type (interest, cancelled
 *   checks, fees, NSF, book errors) so each item can be scored on its own.
 *   docs/07's open "add / less" rows can't be scored per item, and the row
 *   names hint at what to look for.
 * - Spreadsheet cells score all-or-nothing. A candidate who misses the update
 *   puts the voided check into outstanding checks, so they lose that cell's 5
 *   points too: 25 of 45 on the rec instead of docs/07's 30. The report shows
 *   the trap balance next to the expected one; there is no dedicated
 *   "missed update" label.
 * - The reply rubric needs a reviewer (no AI scorer yet), so a perfect attempt
 *   shows 60 automatic points until the reply is marked.
 * - Emails can't greet the candidate by first name; the engine doesn't have it.
 * - Accounts payable is accepted for the check-error entry without the
 *   explanation docs/07 asks for: the journal step can't read the memo.
 * - Process signals (time to open the minute-12 email, rec edits afterwards)
 *   come from attempt events, not the scenario.
 * - docs/07 dates the NSF return (10/20) before the deposit that held the
 *   bakery's check (10/22); here the check was in the 10/12 deposit.
 */

const ACCOUNTS = [
  { code: "1010", name: "Cash" },
  { code: "1200", name: "Accounts Receivable" },
  { code: "2000", name: "Accounts Payable" },
  { code: "5100", name: "Cost of Goods Sold" },
  { code: "6100", name: "Office Supplies Expense" },
  { code: "6200", name: "Bank Service Charges" },
  { code: "6300", name: "Rent Expense" },
  { code: "6400", name: "Utilities Expense" },
  { code: "6500", name: "Repairs Expense" },
  { code: "7100", name: "Interest Income" },
];

/** A ledger line: `out` lowers the balance, `in` raises it (values are cents). */
type LedgerRow = { date: string; ref?: string; desc: string; out?: string; in?: string };

const BANK_ROWS: LedgerRow[] = [
  { date: "10/02", desc: "Deposit", in: "dep1" },
  { date: "10/05", desc: "Check #{{no1}}", out: "chk1" },
  { date: "10/08", desc: "Check #{{no2}}", out: "chk2" },
  { date: "10/12", desc: "Deposit", in: "dep2" },
  { date: "10/14", desc: "Check #{{no3}}", out: "chk3_cleared" },
  { date: "10/18", desc: "Check #{{no4}}", out: "chk4" },
  { date: "10/20", desc: "Returned item: NSF, Maple St. Bakery", out: "nsf" },
  { date: "10/22", desc: "Deposit", in: "dep3" },
  { date: "10/25", desc: "Check #{{no5}}", out: "chk5" },
  { date: "10/27", desc: "Check #{{no7}}", out: "chk7" },
  { date: "10/31", desc: "Monthly service fee", out: "fee" },
  { date: "10/31", desc: "Interest earned", in: "interest" },
];

const GL_ROWS: LedgerRow[] = [
  { date: "10/02", ref: "DEP", desc: "Daily sales deposit", in: "dep1" },
  { date: "10/05", ref: "{{no1}}", desc: "Coastal Roasters, coffee beans", out: "chk1" },
  { date: "10/08", ref: "{{no2}}", desc: "Piedmont Dairy", out: "chk2" },
  { date: "10/12", ref: "DEP", desc: "Sales deposit incl. Maple St. Bakery wholesale check", in: "dep2" },
  { date: "10/14", ref: "{{no3}}", desc: "Coastal Roasters, coffee beans", out: "chk3_booked" },
  { date: "10/18", ref: "{{no4}}", desc: "Bull City Equipment Repair", out: "chk4" },
  { date: "10/22", ref: "DEP", desc: "Daily sales deposit", in: "dep3" },
  { date: "10/25", ref: "{{no5}}", desc: "Triangle Property Mgmt, rent", out: "chk5" },
  { date: "10/26", ref: "{{no6}}", desc: "Office Depot, office supplies", out: "chk6" },
  { date: "10/27", ref: "{{no7}}", desc: "City Utilities", out: "chk7" },
  { date: "10/30", ref: "{{no8}}", desc: "Cardinal Linens", out: "chk8" },
  { date: "10/31", ref: "DEP", desc: "Daily sales deposit", in: "dit" },
];

const money = (name: string) => ({ text: `{{${name}|money}}`, align: "right" as const });
const bold = (text: string) => ({ text, bold: true });
const blankRow = [null, null, null, null, null, null];
const section = (title: string) => [bold(title), null, null, null, null, null];
/** A reconciliation row: label in column A, the amount in column F. */
const recRow = (label: string | { text: string; bold: boolean }, cell: unknown) => [label, null, null, null, null, cell];
const input = (id: string, label: string, points?: number) => ({ input: id, label, ...(points ? { points } : {}) });

/**
 * Bank statement rows use bank conventions (withdrawals in column D), GL rows
 * use book conventions (debits, money in, in column D).
 */
function ledgerRows(rows: LedgerRow[], prefix: string, bankSide: boolean) {
  return rows.map((r, i) => {
    const debit = bankSide ? r.out : r.in;
    const credit = bankSide ? r.in : r.out;
    return [
      r.date,
      r.ref ?? "",
      r.desc,
      debit ? money(debit) : null,
      credit ? money(credit) : null,
      money(`${prefix}_bal_${i + 1}`),
    ];
  });
}

export const harborLaneBankRec = defineScenario({
  slug: "harbor-lane-bank-rec",
  version: 1,
  title: "Harbor Lane Coffee: October bank reconciliation",
  roleFamily: "accounting",
  timeLimitMinutes: 30,
  definition: {
    intro:
      "You're a new staff accountant at Oakline CPA Group. Your client is Harbor Lane Coffee Co. Your senior, Dana Ruiz, needs the October bank reconciliation for checking ending 4471 before a 10 AM client call.",
    steps: [
      {
        id: "bank-rec",
        type: SPREADSHEET,
        title: "Harbor Lane October workbook: reconciliation",
        config: {
          prompt: [
            "The bank statement and the GL cash account are at the top. Fill in the yellow reconciliation cells at the bottom.",
            "Enter amounts as positive numbers in Add and Less rows. In Add / (less) rows, enter a reduction as a negative, e.g. (125.00).",
            "Leave a row blank if nothing belongs in it.",
          ].join("\n"),
          columns: ["A", "B", "C", "D", "E", "F"],
          rows: [
            section("Bank statement · Piedmont Community Bank · Checking ending 4471 · Oct 1–31"),
            [bold("Date"), bold("Ref"), bold("Description"), bold("Withdrawals"), bold("Deposits"), bold("Balance")],
            ["10/01", "", "Opening balance", null, null, money("bank_bal_0")],
            ...ledgerRows(BANK_ROWS, "bank", true),
            blankRow,
            section("General ledger · 1010 Cash, Operating · October"),
            [bold("Date"), bold("Ref"), bold("Description"), bold("Debit"), bold("Credit"), bold("Balance")],
            ["10/01", "", "Beginning balance", null, null, money("gl_bal_0")],
            ...ledgerRows(GL_ROWS, "gl", false),
            blankRow,
            section("Bank reconciliation · Checking ending 4471 · October 31"),
            recRow(bold("Bank side"), null),
            recRow("Balance per bank statement, Oct 31", money("bank_end")),
            recRow("Add: deposits in transit", input("dit", "Deposits in transit", 5)),
            recRow("Less: outstanding checks", input("oc", "Outstanding checks", 5)),
            recRow("Add / (less): bank errors", input("bank_err", "Bank errors")),
            recRow(bold("Adjusted bank balance"), input("adj_bank", "Adjusted bank balance", 2.5)),
            recRow(bold("Book side"), null),
            recRow("Balance per books (GL 1010), Oct 31", money("book_end")),
            recRow("Add: interest and other credits not recorded", input("interest", "Interest not recorded", 5)),
            recRow("Add: cancelled checks still in the books", input("cancelled", "Voided check added back (minute-12 update)", 10)),
            recRow("Less: bank service charges", input("fee", "Bank service charge", 5)),
            recRow("Less: NSF / returned customer checks", input("nsf", "NSF customer check", 5)),
            recRow("Add / (less): errors in the books", input("book_err", "Check recorded at the wrong amount", 5)),
            recRow(bold("Adjusted book balance"), input("adj_book", "Adjusted book balance", 2.5)),
            recRow("Difference (should be zero)", input("diff", "Difference")),
          ],
        },
      },
      {
        id: "rec-entries",
        type: JOURNAL_ENTRY,
        title: "Harbor Lane October workbook: journal entries",
        config: {
          prompt:
            "Draft the journal entries Harbor Lane needs so their books agree with the reconciliation. One entry per item, using only the accounts listed.",
          accounts: ACCOUNTS,
          maxEntries: 10,
          maxLines: 4,
          expected: [
            { id: "fee", label: "Bank service charge" },
            { id: "nsf", label: "NSF check back to receivables" },
            { id: "interest", label: "Interest earned" },
            { id: "transposition", label: "Check recorded at the wrong amount" },
            { id: "voided", label: "Reverse the voided check" },
          ],
        },
      },
      {
        id: "dana-reply",
        type: INBOX_REPLY,
        title: "Reply to Dana",
        config: {
          prompt: "Reply to Dana with the adjusted cash balance and a short summary of anything the client should know about.",
          to: "Dana Ruiz, Senior Associate",
          subject: "RE: Harbor Lane: October bank rec",
          maxChars: 4_000,
          criteria: [
            {
              id: "answer",
              label: "States the adjusted cash balance up front",
              maxPoints: 10,
              guidance: "Gives the adjusted (reconciled) cash balance at October 31 early in the reply, and says bank and book agree.",
            },
            {
              id: "client-issues",
              label: "Flags what the client must follow up",
              maxPoints: 10,
              guidance:
                "Raises the returned (NSF) Maple St. Bakery check as a receivable to follow up, and the entry error on check #{{no3}} to Coastal Roasters.",
            },
            {
              id: "update",
              label: "Confirms the voided check was handled",
              maxPoints: 5,
              guidance: "Says check #{{no6}} to Office Depot was reversed in the books per Dana's update and is not outstanding.",
            },
            {
              id: "clarity",
              label: "Short and organized",
              maxPoints: 10,
              guidance: "Under about 150 words, organized so Dana can use it on a call; no unnecessary detail.",
            },
            {
              id: "tone",
              label: "Professional, friendly tone",
              maxPoints: 5,
              guidance: "Professional and friendly, with a greeting and a sign-off.",
            },
          ],
        },
      },
    ],
    messages: [
      {
        id: "m1",
        from: "Dana Ruiz, Senior Associate, Oakline CPA Group",
        subject: "Harbor Lane: October bank rec",
        body: [
          "Hi,",
          "",
          "Welcome aboard! First assignment: Harbor Lane Coffee Co. needs their October bank reconciliation for their operating account (checking ending 4471).",
          "",
          "The workbook has the October bank statement from Piedmont Community Bank and their GL cash account, with a reconciliation template to fill in. There's a separate journal entries sheet.",
          "",
          "Please:",
          "1. Reconcile the bank balance to the book balance as of October 31.",
          "2. Draft any journal entries the client needs to fix their books.",
          "3. Reply to me with the adjusted cash balance and a short summary of anything the client should know about.",
          "",
          "September's reconciliation was clean, so nothing carries over from last month. I need this before my 10 AM call with the client.",
          "",
          "Thanks!",
          "Dana Ruiz",
          "Senior Associate, Oakline CPA Group",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "bank-rec",
      },
      {
        id: "m2",
        from: "Dana Ruiz, Senior Associate, Oakline CPA Group",
        subject: "RE: Harbor Lane: one more thing",
        body: [
          "Quick update: Marcus (Harbor Lane's owner) just told me check #{{no6}} to Office Depot for {{chk6|money}} was voided. The order was cancelled and the check was never mailed, but it's still in their books. It was originally booked to Office Supplies Expense. Please factor that into your rec.",
          "",
          "Dana",
        ].join("\n"),
        arriveAtMinute: 12,
      },
    ],
  },

  build(rng) {
    const open = rng.cents(18_000, 30_000);
    const firstCheck = rng.int(1020, 4800);
    const v: Record<string, number> = {
      dep1: rng.cents(4_000, 6_500),
      dep2: rng.cents(4_000, 6_500),
      dep3: rng.cents(4_500, 7_000),
      dit: rng.cents(2_500, 5_000),
      chk1: rng.cents(2_000, 4_000),
      chk2: rng.cents(500, 1_200),
      chk4: rng.cents(1_000, 2_500),
      chk5: rng.cents(3_500, 5_000),
      chk6: rng.cents(150, 450),
      chk7: rng.cents(800, 1_500),
      chk8: rng.cents(600, 1_800),
      nsf: rng.cents(250, 750),
      fee: rng.cents(20, 45),
      interest: rng.cents(5, 25),
    };
    for (let i = 1; i <= 8; i++) v[`no${i}`] = firstCheck + i - 1;

    // Check 3 has its hundreds and tens digits swapped between bank and books
    // (docs/07: cleared 2,610, booked 2,160). Either side can hold the larger amount.
    const thousands = rng.int(1, 3);
    const hi = rng.int(1, 9);
    const lo = rng.int(0, hi - 1);
    const unit = rng.int(0, 9);
    const centsPart = rng.int(0, 99);
    const big = (thousands * 1000 + hi * 100 + lo * 10 + unit) * 100 + centsPart;
    const small = (thousands * 1000 + lo * 100 + hi * 10 + unit) * 100 + centsPart;
    const understated = rng.int(0, 1) === 1; // books show less than the bank paid
    v.chk3_cleared = understated ? big : small;
    v.chk3_booked = understated ? small : big;

    const run = (rows: LedgerRow[], prefix: string) => {
      let bal = open;
      v[`${prefix}_bal_0`] = bal;
      rows.forEach((r, i) => {
        bal += (r.in ? v[r.in] : 0) - (r.out ? v[r.out] : 0);
        v[`${prefix}_bal_${i + 1}`] = bal;
      });
      return bal;
    };
    const bankEnd = run(BANK_ROWS, "bank");
    const bookEnd = run(GL_ROWS, "gl");
    v.bank_end = bankEnd;
    v.book_end = bookEnd;

    const bookError = v.chk3_booked - v.chk3_cleared; // + adds back to books, − reduces them
    const fix = Math.abs(bookError);
    const adjusted = bankEnd + v.dit - v.chk8;
    const adjustedBook = bookEnd + v.interest + v.chk6 - v.fee - v.nsf + bookError;
    if (adjusted !== adjustedBook) throw new Error("harbor-lane-bank-rec: reconciliation doesn't tie");
    const trap = adjusted - v.chk6;

    const d = (cents: number) => cents / 100;
    const entry = (dr: string[], cr: string[], amount: number) => ({
      lines: [
        { accounts: dr, side: "debit" as const, amount: d(amount) },
        { accounts: cr, side: "credit" as const, amount: d(amount) },
      ],
    });
    // docs/07: accept Accounts payable for the check error if the check paid a booked invoice.
    const errorAccounts = ["5100", "2000"];

    return {
      values: v,
      keys: {
        "bank-rec": {
          tolerance: 0.005,
          cells: {
            dit: { value: d(v.dit) },
            oc: { value: d(v.chk8) },
            adj_bank: { value: d(adjusted) },
            interest: { value: d(v.interest) },
            cancelled: { value: d(v.chk6) },
            fee: { value: d(v.fee) },
            nsf: { value: d(v.nsf) },
            book_err: { value: d(bookError) },
            adj_book: { value: d(adjusted) },
          },
        },
        "rec-entries": {
          entries: {
            fee: entry(["6200"], ["1010"], v.fee),
            nsf: entry(["1200"], ["1010"], v.nsf),
            interest: entry(["1010"], ["7100"], v.interest),
            transposition: understated ? entry(errorAccounts, ["1010"], fix) : entry(["1010"], errorAccounts, fix),
            voided: entry(["1010"], ["6100"], v.chk6),
          },
        },
        "dana-reply": {
          notes: {
            answer: `Adjusted cash is ${formatCents(adjusted)} on both sides. A candidate who missed the minute-12 update ties at ${formatCents(trap)} instead.`,
            "client-issues": `Maple St. Bakery's ${formatCents(v.nsf)} check came back NSF and is back in receivables. Check #${v.no3} to Coastal Roasters was booked at ${formatCents(v.chk3_booked)} but cleared at ${formatCents(v.chk3_cleared)}, a ${formatCents(fix)} entry error.`,
            update: `Check #${v.no6} to Office Depot for ${formatCents(v.chk6)} was voided: added back to the books, not outstanding.`,
          },
        },
      },
    };
  },
});
