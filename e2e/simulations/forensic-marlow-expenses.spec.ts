/**
 * Marlow Forensic (docs/07 Example 9), end to end in one browser: a candidate
 * goes through all six timed sections, lets one rapid item time out, finds the
 * four shell-vendor signs, answers Sam's total from the extract in his email,
 * fills one findings cell, writes two replies and submits. The company report
 * then shows the section scores the key gives for exactly those answers.
 * Time passes by moving `started_at` back in the database; nothing sleeps.
 */
import type { Page } from "@playwright/test";
import { signInViaUi } from "../fixtures";
import { backdateAttempt } from "../support/db";
import { chromiumOnly, expect, KNOWN_FAINT_TEXT, test } from "../support/test";

chromiumOnly();

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayOf = (s: string) => {
  const m = s.match(/([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/)!;
  return Date.UTC(Number(m[3]), MONTHS.indexOf(m[1]), Number(m[2]));
};
const cents = (s: string) => Math.round(Number(s.replace(/[$,\s]/g, "")) * 100);

async function nextScreen(page: Page) {
  await page.getByRole("button", { name: "Next screen" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Next screen" }).click();
}

async function finishSection(page: Page) {
  await page.getByRole("button", { name: "Finish section" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Finish section" }).click();
}

test("forensic intern: six sections, a timed-out item, the report shows the expected scores", async ({ page, data, candidate, a11y }) => {
  test.setTimeout(240_000);
  const co = await data.company();
  const { assessmentId } = await data.assessment({
    orgId: co.orgId,
    scenarioId: await data.libraryScenario("forensic-marlow-expenses"),
    title: "Forensic intern",
    timeLimitMinutes: 49,
  });
  const { jobId } = await data.job({ orgId: co.orgId, assessmentId, title: "Forensic intern" });
  const invite = await data.invite({ orgId: co.orgId, jobId });

  await candidate.startTest(invite);
  // New-email toasts can cover the lower rows of a screen; put them off whenever they get in the way.
  await page.addLocatorHandler(page.getByRole("button", { name: "Later", exact: true }), (later) => later.click());
  const sectionBar = page.getByRole("region", { name: "Section" });
  const heading = page.getByRole("heading", { level: 1 });

  // ---- 1. Rapid round A: item 1 times out, then finish the section early ----
  await expect(sectionBar).toContainText("Section 1 of 6");
  await expect(page.getByText("Item 1 of 15")).toBeVisible();
  await a11y(KNOWN_FAINT_TEXT);
  await backdateAttempt(invite.inviteId, 0.5, { keepDeadline: true });
  await page.reload();
  await expect(page.getByText("Item 2 of 15")).toBeVisible();
  await finishSection(page);

  // ---- 2. Vendor master: flag the one shell-vendor sign on each screen, skip the follow-up list ----
  await expect(sectionBar).toContainText("Section 2 of 6");
  for (let k = 1; k <= 4; k++) {
    await expect(sectionBar).toContainText(`Screen ${k} of 5`);
    await expect(heading).toHaveText(`Vendor master, screen ${k} of 4`);
    const doc = page.getByRole("article", { name: `Vendor master · screen ${k} of 4` });
    // Axe before flagging: a flagged row's button reads "Flagged" while its name is "Flag <row>"
    // (label-content-name-mismatch in the document_review view, an engine issue reported, not ours to fix here).
    if (k === 1) await a11y(KNOWN_FAINT_TEXT);
    const employees = (await doc.locator("p.pre").innerText())
      .split("\n")
      .slice(1)
      .map((l) => l.replace(/^.+?: /, ""));
    expect(employees.length).toBe(6);
    const rows = await doc.locator("tbody tr").all();
    const signs: { name: string; reason: string }[] = [];
    for (const row of rows) {
      const [name, address, tax, created, paid] = (await row.getByRole("cell").allInnerTexts()).map((t) => t.trim());
      const reason = /^PO Box/.test(address)
        ? "PO box address"
        : !/^\d{2}-\d{7}$/.test(tax)
          ? "No tax ID on file"
          : employees.includes(address)
            ? "Address matches an employee's"
            : dayOf(created) === dayOf(paid)
              ? "Created and paid the same day"
              : null;
      if (reason) signs.push({ name, reason });
    }
    expect(signs.length, `screen ${k}`).toBe(1);
    await doc.getByRole("button", { name: `Flag ${signs[0].name}` }).click();
    await doc.getByLabel(`Reason for ${signs[0].name}`).selectOption({ label: signs[0].reason });
    await candidate.saved();
    await nextScreen(page);
  }
  await expect(sectionBar).toContainText("Screen 5 of 5");
  await expect(heading).toHaveText("Follow-up list");
  await expect(page.getByRole("checkbox")).toHaveCount(12);
  await a11y(KNOWN_FAINT_TEXT);
  await nextScreen(page);

  // ---- 3. Rapid round B: finish early ----
  await expect(sectionBar).toContainText("Section 3 of 6");
  await expect(page.getByText("Item 1 of 15")).toBeVisible();
  await finishSection(page);

  // ---- 4. Inbox: reply to the suspect, Sam's total from his extract, leave the board member ----
  await expect(sectionBar).toContainText("Section 4 of 6");
  await expect(heading).toHaveText(/^Reply to /);
  await page.getByLabel("Reply", { exact: true }).fill("Hi, thanks for the offer. Sam is leading this work, so please send any questions to him.");
  await candidate.saved();
  await a11y(KNOWN_FAINT_TEXT);
  await nextScreen(page);

  await expect(heading).toHaveText(/^Total paid to /);
  const flagged = (await heading.innerText()).replace(/^Total paid to /, "");
  // Sam's email (linked in the brief column) carries the payment extract.
  await candidate.openInbox();
  await candidate.message(/Total for /).click();
  const email = await page.getByRole("dialog", { name: "Inbox" }).innerText();
  await page.getByRole("button", { name: "Close inbox" }).click();
  const lines = email.split("\n").filter((l) => l.startsWith("• "));
  expect(lines.length).toBe(13);
  const mine = lines.map((l) => l.slice(2).split(" · ")).filter((p) => p[1] === flagged);
  expect(mine.length).toBe(5);
  const total = mine.reduce((t, p) => t + cents(p[3]), 0);
  await page.getByLabel(/total we paid/).fill((total / 100).toFixed(2));
  await candidate.saved();
  await a11y(KNOWN_FAINT_TEXT);
  await nextScreen(page);
  await expect(heading).toHaveText(/^Reply to /);
  await nextScreen(page);

  // ---- 5. Rapid round C: finish early ----
  await expect(sectionBar).toContainText("Section 5 of 6");
  await expect(page.getByText("Item 1 of 12")).toBeVisible();
  await finishSection(page);

  // ---- 6. Findings: the flagged vendor's total in the sheet, and a memo ----
  await expect(sectionBar).toContainText("Section 6 of 6");
  await expect(heading).toHaveText("Findings summary");
  await page.getByLabel(`${flagged}, C`).fill((total / 100).toFixed(2));
  await candidate.saved();
  await a11y(KNOWN_FAINT_TEXT);
  await candidate.task(/Findings memo to Sam/).click();
  await expect(heading).toHaveText("Findings memo to Sam");
  await page.getByLabel("Reply", { exact: true }).fill(`Sam, ${flagged} was paid five times in Q1. Next steps: preserve records, interviews, bank records.`);
  await candidate.saved();

  await page.getByRole("link", { name: "Submit", exact: true }).click();
  await expect(page).toHaveURL(/\/review$/);
  await page.getByRole("checkbox", { name: "I understand I can't make changes after submitting." }).check();
  await page.getByRole("button", { name: "Submit final answers" }).click();
  await expect(page).toHaveURL(/\/done$/);

  // ---- The company report ----
  await signInViaUi(page, co.users.recruiter, `/app/${co.slug}/candidates/${invite.inviteId}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("27 of 100 points")).toBeVisible();
  const card = (stepId: string) => page.locator(`a[href="#step-${stepId}"]`);
  const expected: [string, string][] = [
    ["rapid-redflag", "0/10"],
    ["vendors-1", "5/5"],
    ["vendors-2", "5/5"],
    ["vendors-3", "5/5"],
    ["vendors-4", "5/5"],
    ["vendor-list", "0/5"],
    ["rapid-duplicate", "0/10"],
    ["suspect-reply", "0/5"],
    ["flagged-total", "5/5"],
    ["board-reply", "0/5"],
    ["rapid-analytics", "0/10"],
    ["findings-sheet", "2/15"],
    ["findings-memo", "0/15"],
  ];
  for (const [id, score] of expected) await expect(card(id), id).toContainText(score);
  await expect(page.getByText("Needs review · 2 tasks")).toBeVisible();
  await a11y(KNOWN_FAINT_TEXT);
});
