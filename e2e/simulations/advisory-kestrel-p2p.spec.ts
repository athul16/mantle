/**
 * advisory-kestrel-p2p (docs/07 Example 8): a candidate goes through all six
 * timed sections, solving what they see on screen. Rapid item 1 of round A
 * times out (time passes by moving `started_at` back; nothing sleeps), one
 * item each of rounds A and B is answered, round C is skipped, every work
 * screen is answered right, the write-up goes to review. Then a recruiter
 * opens the report and sees the step scores the key gives for those answers.
 */
import type { Page } from "@playwright/test";
import { signInViaUi } from "../fixtures";
import { CANDIDATE_NAME } from "../support/candidate";
import { attemptFor, backdateAttempt } from "../support/db";
import { chromiumOnly, expect, KNOWN_FAINT_TEXT, test } from "../support/test";

chromiumOnly();
test.setTimeout(240_000);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const date = (s: string) => {
  const [m, d] = s.trim().split(" ");
  return MONTHS.indexOf(m) * 100 + Number(d);
};
const cents = (s: string) => Math.round(Number(s.replace(/[$,\s]/g, "")) * 100);

/** The P2P process, first to last, by each walkthrough card's wording. */
const WALK_RULES: RegExp[] = [
  /raises a purchase requisition$/,
  /^Purchasing turns the requisition into a PO in the ERP$/,
  /^Key control P2P-02: a director approves the PO/,
  /^The PO is sent to the vendor/,
  /^The warehouse receives the goods/,
  /^AP enters the vendor's invoice$/,
  /^Key control P2P-03:/,
  /^AP builds the weekly payment run$/,
  /^Key control P2P-04:/,
  /^The bank releases the payments/,
];

/** Closes a "New email" toast if one is showing, so it can't cover a button. */
async function dismissToast(page: Page) {
  const later = page.getByRole("button", { name: "Later" });
  if (await later.isVisible()) await later.click();
}

async function advance(page: Page, name: "Next screen" | "Finish section") {
  await dismissToast(page);
  await page.getByRole("region", { name: "Section" }).getByRole("button", { name }).click();
  await page.getByRole("dialog").getByRole("button", { name }).click();
}

/** The open rapid item's exhibit rows, label → value. */
async function exhibitRows(page: Page) {
  const figure = page.locator("figure");
  const labels = await figure.locator("dt").allTextContents();
  const values = await figure.locator("dd").allTextContents();
  return { title: ((await figure.locator("figcaption").textContent()) ?? "").trim(), row: (l: string) => values[labels.indexOf(l)].trim() };
}

/** Control pass or fail, solved from the evidence: [result, reason]. */
async function solveControl(page: Page): Promise<[string, string]> {
  const { title, row } = await exhibitRows(page);
  let reason = "No issue";
  if (/^PO approval/.test(title)) {
    const [, approver, limit] = row("Approved by").match(/^(.+) \(limit (\$[\d,]+\.\d\d)\)$/)!;
    if (approver === row("Requested by")) reason = "Approver is the requester";
    else if (cents(row("Amount")) > cents(limit)) reason = "Over the approval limit";
    else if (date(row("Approved on")) > date(row("Paid on"))) reason = "Approved after payment";
  } else if (/^Vendor change/.test(title)) {
    if (row("Entered by") === row("Approved by")) reason = "Approver is the requester";
    else if (date(row("Approved on")) > date(row("First payment to the new account"))) reason = "Approved after payment";
  } else {
    const reviewer = row("Reviewed by");
    if (/^Not signed/.test(reviewer)) reason = "Sign-off missing or late";
    else if (reviewer === row("Prepared by")) reason = "Approver is the requester";
    else if (date(row("Reviewed on")) > date(row("Review due"))) reason = "Sign-off missing or late";
  }
  return [reason === "No issue" ? "Effective" : "Deficiency", reason];
}

const SOD: [string, string, string][] = [
  ["Create vendor + approve payment", "Create and edit vendors", "Approve payments"],
  ["Post JE + approve JE", "Post journal entries", "Approve journal entries"],
  ["Receive goods + approve invoice", "Receive goods", "Approve vendor invoices"],
];

async function solveSod(page: Page) {
  const roles = await page.locator("figure table tbody tr td:nth-child(2)").allTextContents();
  const hit = SOD.find(([, a, b]) => roles.includes(a) && roles.includes(b));
  return hit ? hit[0] : "No conflict";
}

async function pick(scope: Page, group: string, option: string | RegExp) {
  await dismissToast(scope);
  await scope.getByRole("radiogroup", { name: group }).getByRole("radio", { name: option }).check();
}

test("a candidate works through all six sections and the report shows the expected scores", async ({ page, data, candidate, a11y, land }) => {
  const co = await data.company();
  const { assessmentId } = await data.assessment({
    orgId: co.orgId,
    scenarioId: await data.libraryScenario("advisory-kestrel-p2p"),
    title: "Advisory P2P controls",
    timeLimitMinutes: 52,
  });
  const { jobId } = await data.job({ orgId: co.orgId, assessmentId, title: "Advisory intern" });
  const invite = await data.invite({ orgId: co.orgId, jobId });

  await candidate.startTest(invite);
  const bar = page.getByRole("region", { name: "Section" });

  // ---- Section 1: rapid round A. Item 1 times out; item 2 is answered from the evidence ----
  await expect(bar).toContainText("Section 1 of 6");
  await expect(bar).toContainText("Rapid round: control pass or fail");
  await expect(page.getByText("Item 1 of 15")).toBeVisible();
  await a11y(KNOWN_FAINT_TEXT);

  await backdateAttempt(invite.inviteId, 0.42, { keepDeadline: true }); // 25 s: past item 1's 24 s
  await page.reload();
  await expect(page.getByText("Item 2 of 15")).toBeVisible();
  const [result, reason] = await solveControl(page);
  await pick(page, "Result", result);
  await pick(page, "Reason", reason);
  await dismissToast(page);
  await page.getByRole("button", { name: "Submit answer" }).click();
  await expect(page.getByText("Item 3 of 15")).toBeVisible();
  await advance(page, "Finish section");

  // ---- Section 2: the PO sample, two at a time, then the conclusion ----
  await expect(bar).toContainText("Section 2 of 6");
  const exceptions: number[] = [];
  for (let k = 1; k <= 4; k++) {
    await expect(bar).toContainText(`Screen ${k} of 5`);
    await expect(page.getByRole("heading", { level: 1, name: `PO approval test: items ${2 * k - 1} and ${2 * k}` })).toBeVisible();
    const rows = page.getByRole("article").locator("tbody tr");
    await expect(rows).toHaveCount(2);
    // Before any flag: a flagged button reads "Flagged" under the name "Flag …", which axe reports
    // (label-content-name-mismatch, in the shared document_review view, not this scenario).
    if (k === 1) await a11y(KNOWN_FAINT_TEXT);
    let failed = false;
    // Read both rows before flagging: a flag opens a reason row inside the table, which shifts nth().
    const cells: string[][] = [];
    for (const r of await rows.all()) cells.push((await r.locator("td").allTextContents()).map((t) => t.trim()));
    for (const [po, , amount, , order, approver, title, approvedOn] of cells) {
      const why = /^None/.test(approver)
        ? "No approval on record"
        : !/Director/.test(title)
          ? "Approver isn't a director"
          : date(approvedOn) > date(order)
            ? "Approved after the order date"
            : null;
      if (!why) continue;
      failed = true;
      exceptions.push(cents(amount));
      await dismissToast(page);
      await page.getByRole("button", { name: `Flag ${po}` }).click();
      await page.getByLabel(`Reason for ${po}`).selectOption({ label: why });
    }
    await dismissToast(page);
    if (!failed) await page.getByRole("checkbox", { name: "Both POs pass" }).check();
    await candidate.saved();
    await advance(page, "Next screen");
  }
  await expect(bar).toContainText("Screen 5 of 5");
  await expect(page.getByRole("heading", { level: 1, name: "Conclusion on P2P-02" })).toBeVisible();
  expect(exceptions.length).toBeGreaterThanOrEqual(1);
  await dismissToast(page);
  await page.getByRole("radio", { name: exceptions.length <= 1 ? "Effective" : "Deficiency" }).check();
  await candidate.saved();
  await a11y(KNOWN_FAINT_TEXT);
  await advance(page, "Next screen");

  // ---- Section 3: rapid round B. Item 1 answered, then finish early ----
  await expect(bar).toContainText("Section 3 of 6");
  await expect(page.getByText("Item 1 of 15")).toBeVisible();
  await pick(page, "Conflict", await solveSod(page));
  await dismissToast(page);
  await page.getByRole("button", { name: "Submit answer" }).click();
  await expect(page.getByText("Item 2 of 15")).toBeVisible();
  await advance(page, "Finish section");

  // ---- Section 4: inbox, one screen at a time ----
  await expect(bar).toContainText("Section 4 of 6");
  await expect(bar).toContainText("Screen 1 of 4");
  await dismissToast(page);
  await page.getByRole("radio", { name: /^No, I have to record it as an exception/ }).check();
  await candidate.saved();
  await a11y(KNOWN_FAINT_TEXT);
  await advance(page, "Next screen");

  await expect(bar).toContainText("Screen 2 of 4");
  await page.getByLabel(/how many exceptions/).fill(String(exceptions.length));
  await candidate.saved();
  await a11y(KNOWN_FAINT_TEXT);
  await advance(page, "Next screen");

  await expect(bar).toContainText("Screen 3 of 4");
  await page.getByLabel(/total value of the POs with exceptions/).fill((exceptions.reduce((t, c) => t + c, 0) / 100).toFixed(2));
  await candidate.saved();
  await advance(page, "Next screen");

  await expect(bar).toContainText("Screen 4 of 4");
  const list = page.getByRole("article");
  const leavers = ((await list.locator("dd").allTextContents()).find((t) => /\(left /.test(t)) ?? "").split("; ").map((s) => s.replace(/ \(left .+\)$/, "").trim());
  expect(leavers.length).toBe(2);
  let flagged = 0;
  const users: string[][] = [];
  for (const r of await list.locator("tbody tr").all()) users.push((await r.locator("td").allTextContents()).map((t) => t.trim()));
  for (const [userId, name] of users) {
    if (!leavers.includes(name)) continue;
    await dismissToast(page);
    await page.getByRole("button", { name: `Flag ${userId}` }).click();
    await page.getByLabel(`Reason for ${userId}`).selectOption({ label: "Left the company but still active" });
    flagged++;
  }
  expect(flagged).toBe(1);
  await dismissToast(page);
  await page.getByRole("radio", { name: /^Disable the account now/ }).check();
  await candidate.saved();
  await advance(page, "Next screen");

  // ---- Section 5: rapid round C, skipped ----
  await expect(bar).toContainText("Section 5 of 6");
  await expect(page.getByText("Item 1 of 15")).toBeVisible();
  await advance(page, "Finish section");

  // ---- Section 6: walkthrough and write-up ----
  await expect(bar).toContainText("Section 6 of 6");
  await dismissToast(page);
  await candidate.task(/P2P walkthrough/).click();
  const order = page.getByRole("list", { name: "Your order" });
  await expect(order.getByRole("listitem")).toHaveCount(10);
  const labels = await order.locator("li").evaluateAll((lis) => lis.map((li) => li.getAttribute("data-label") ?? ""));
  const right = WALK_RULES.map((re) => {
    const hits = labels.filter((l) => re.test(l));
    expect(hits, `${re}`).toHaveLength(1);
    return hits[0];
  });
  await a11y(KNOWN_FAINT_TEXT);
  // Moving each card to the top, last one first, leaves them in the right order.
  for (const label of [...right].reverse()) {
    const handle = page.getByRole("button", { name: `Reorder "${label}"` });
    await handle.focus();
    await handle.press("Home");
    await expect(page.getByRole("button", { name: `Reorder "${label}", position 1 of 10` })).toBeFocused();
  }
  expect(await order.locator("li").evaluateAll((lis) => lis.map((li) => li.getAttribute("data-label") ?? ""))).toEqual(right);
  await candidate.saved();

  await dismissToast(page);
  await candidate.task(/Write-up to Jordan/).click();
  await page.locator("textarea").fill(
    "Condition: a user who left is still active in the ERP and logged in after leaving. Criteria: ITGC-03 says access goes within 1 business day. Risk: unauthorized invoice or payment approvals. Recommendation: disable it now, review its activity, fix the leaver process.",
  );
  await candidate.saved();
  await a11y(KNOWN_FAINT_TEXT);

  // ---- Submit ----
  await page.getByRole("link", { name: "Submit", exact: true }).click();
  await land(/\/review$/, "Review before you submit");
  await page.getByRole("checkbox", { name: "I understand I can't make changes after submitting." }).check();
  await page.getByRole("button", { name: "Submit final answers" }).click();
  await land(/\/done$/, `Submitted. Thanks, ${CANDIDATE_NAME.split(" ")[0]}.`);
  expect((await attemptFor(invite.inviteId))?.status).toBe("scored");

  // ---- The company report ----
  await signInViaUi(page, co.users.recruiter, `/app/${co.slug}/candidates/${invite.inviteId}`);
  await land(new RegExp(`/candidates/${invite.inviteId}$`), CANDIDATE_NAME);

  // Rapid A ½ (item 2), sample 4 × 5 + conclusion 5, rapid B ½ (item 1), inbox 15, rapid C 0, walkthrough 15; write-up waits.
  await expect(page.getByTestId("final-score")).toHaveText("56");
  await expect(page.getByText("56 of 100 points")).toBeVisible();
  await expect(page.getByText("Needs review · 1 task")).toBeVisible();
  const card = (title: string | RegExp) => page.getByRole("link", { name: title });
  await expect(card(/^Rapid round: control pass or fail/)).toContainText("0.5/10");
  for (let k = 1; k <= 4; k++) await expect(card(new RegExp(`^PO approval test: items ${2 * k - 1} and ${2 * k}`))).toContainText("5/5");
  await expect(card(/^Conclusion on P2P-02/)).toContainText("5/5");
  await expect(card(/^Rapid round: access conflicts/)).toContainText("0.5/10");
  await expect(card(/^Reply to /)).toContainText("5/5");
  await expect(card(/^Exceptions in the sample/)).toContainText("2/2");
  await expect(card(/^Value of the exceptions/)).toContainText("2/2");
  await expect(card(/^ERP user list/)).toContainText("6/6");
  await expect(card(/^Rapid round: design or operating\?/)).toContainText("0/10");
  await expect(card(/^P2P walkthrough/)).toContainText("15/15");
  await expect(card(/^Write-up to Jordan/)).toContainText("0/15");

  const rapid = page.getByRole("region", { name: /Rapid round: control pass or fail$/ });
  await expect(rapid.getByRole("row").filter({ hasText: "Response time" })).toContainText("with no answer");
});
