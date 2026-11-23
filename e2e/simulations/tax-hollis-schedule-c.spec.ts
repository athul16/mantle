/**
 * Hollis Tax & Accounting, Schedule C (docs/07 Example 7): a candidate goes
 * through all six timed sections, one rapid item times out and the round moves
 * on, the work is submitted, and the company report shows the section scores
 * the key gives for those answers. Time passes by moving `started_at` back in
 * the database; nothing sleeps.
 *
 * The test reads the attempt's seed from the database and asks the engine for
 * that seed's key in a separate process (the engine is server-only), then
 * answers a known subset right: one rapid item per round, the first organize
 * screen, the deposits screen, Elena's net profit and the whole Schedule C.
 */
import { execFileSync } from "node:child_process";
import { signInViaUi } from "../fixtures";
import { attemptFor, backdateAttempt, db } from "../support/db";
import { chromiumOnly, expect, KNOWN_FAINT_TEXT, test } from "../support/test";

chromiumOnly();

const SLUG = "tax-hollis-schedule-c";

type RapidKey = { items: Record<string, Record<string, { choice?: string; value?: number }>> };
type Variant = { values: Record<string, string | number>; keys: Record<string, unknown> };

/** This seed's values and keys, from the engine run under the react-server condition (like the publish script). */
function variantFor(seed: string): Variant {
  const code = `import("@/lib/engine/scenarios").then((m) => { const { getScenario } = m.default ?? m; const v = getScenario(${JSON.stringify(SLUG)}, 1).generate(${JSON.stringify(seed)}); process.stdout.write(JSON.stringify(v)); })`;
  return JSON.parse(execFileSync("pnpm", ["exec", "tsx", "--conditions=react-server", "-e", code], { encoding: "utf8", env: process.env }));
}

test.setTimeout(180_000);

test("tax intern: six sections, a rapid item times out, submit, and the report shows the section scores", async ({ page, data, candidate, a11y, land }) => {
  const co = await data.company();
  const { assessmentId } = await data.assessment({
    orgId: co.orgId,
    scenarioId: await data.libraryScenario(SLUG),
    title: "Tax intern",
    timeLimitMinutes: 52,
  });
  const { jobId } = await data.job({ orgId: co.orgId, assessmentId, title: "Tax intern" });
  const invite = await data.invite({ orgId: co.orgId, jobId });

  await candidate.startTest(invite);
  const attempt = await attemptFor(invite.inviteId);
  const { data: secret } = await db().from("attempt_secrets").select("seed").eq("attempt_id", attempt!.id).single();
  const { values, keys } = variantFor(secret!.seed);
  const rapid = (stepId: string, itemId: string) => (keys[stepId] as RapidKey).items[itemId];

  const sectionBar = page.getByRole("region", { name: "Section" });
  const heading = (name: string | RegExp) => page.getByRole("heading", { level: 1, name });
  const nextScreen = async () => {
    await page.getByRole("button", { name: "Next screen" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Next screen" }).click();
  };
  const finishSection = async () => {
    await page.getByRole("button", { name: "Finish section" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Finish section" }).click();
  };
  /** Answers the open rapid item from the key: a radio for a pick, the number box for an amount. */
  const answerItem = async (stepId: string, itemId: string) => {
    for (const [, k] of Object.entries(rapid(stepId, itemId))) {
      if (k.choice) await page.locator(`input[type="radio"][value="${k.choice}"]`).check();
      else await page.getByRole("textbox", { name: "Amount (whole dollars)" }).fill(String(k.value));
    }
    await page.getByRole("button", { name: "Submit answer" }).click();
  };

  // ---- 1 · Rapid A: item 1 times out, item 2 answered right ----
  await expect(sectionBar).toContainText("Section 1 of 6");
  await expect(sectionBar).toContainText("Rapid round: form to field");
  await expect(page.getByText("Item 1 of 15")).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Where it goes" })).toBeVisible();
  await a11y(KNOWN_FAINT_TEXT);
  await backdateAttempt(invite.inviteId, 0.5, { keepDeadline: true });
  await page.reload();
  await expect(page.getByText("Item 2 of 15")).toBeVisible();
  await answerItem("rapid-forms", "ff-02");
  await expect(page.getByText("Item 3 of 15")).toBeVisible();
  await finishSection();

  // ---- 2 · Organize: batch 1 sorted right, batches 2 and 3 skipped, deposits flagged ----
  await expect(sectionBar).toContainText("Section 2 of 6");
  await expect(sectionBar).toContainText("Screen 1 of 4");
  await expect(heading("Client documents, batch 1 of 3")).toBeVisible();
  const sort1 = keys["sort-1"] as { findings: Record<string, { reasons: string[] }> };
  for (const j of [1, 2, 3]) {
    await page.getByRole("button", { name: new RegExp(`^Flag ${j}\\. `) }).click();
    await page.getByRole("combobox", { name: new RegExp(`^Reason for ${j}\\. `) }).selectOption(sort1.findings[`doc${j}`].reasons[0]);
  }
  await candidate.saved();
  await a11y(KNOWN_FAINT_TEXT);
  await nextScreen();
  await expect(heading("Client documents, batch 2 of 3")).toBeVisible();
  await nextScreen();
  await expect(heading("Client documents, batch 3 of 3")).toBeVisible();
  await nextScreen();
  await expect(sectionBar).toContainText("Screen 4 of 4");
  await expect(heading("Bank deposits vs 1099s")).toBeVisible();
  const latePayer = String(values.late_payer);
  await page.getByRole("button", { name: `Flag ${latePayer}`, exact: true }).click();
  await page.getByRole("combobox", { name: `Reason for ${latePayer}`, exact: true }).selectOption("missing");
  await page.getByRole("radio", { name: /^Ask the client for the missing 1099-NEC/ }).check();
  await candidate.saved();
  await a11y(KNOWN_FAINT_TEXT);
  await nextScreen();

  // ---- 3 · Rapid B: item 1 right ----
  await expect(sectionBar).toContainText("Section 3 of 6");
  await expect(page.getByText("Item 1 of 15")).toBeVisible();
  await answerItem("rapid-deduct", "dd-01");
  await expect(page.getByText("Item 2 of 15")).toBeVisible();
  await finishSection();

  // ---- 4 · Inbox: two replies and Elena's number ----
  await expect(sectionBar).toContainText("Section 4 of 6");
  await expect(heading(/about the trip$/)).toBeVisible();
  await page.getByRole("textbox", { name: "Reply" }).fill("Hi, I'm sorry, but the trip isn't deductible. It was a family vacation, and checking email doesn't make it a business trip.");
  await candidate.saved();
  await a11y(KNOWN_FAINT_TEXT);
  await nextScreen();
  await expect(heading("Net profit for Elena")).toBeVisible();
  await page.getByLabel(/net Schedule C profit on her draft numbers/).fill(String((keys["net-profit"] as { value: number }).value));
  await candidate.saved();
  await a11y(KNOWN_FAINT_TEXT);
  await nextScreen();
  await expect(heading(/about the late 1099$/)).toBeVisible();
  await page.getByRole("textbox", { name: "Reply" }).fill("Thanks for sending it. We'll add it to the return: gross receipts and net profit go up by that amount, and so does your self-employment tax.");
  await candidate.saved();
  await nextScreen();

  // ---- 5 · Rapid C: item 1 right ----
  await expect(sectionBar).toContainText("Section 5 of 6");
  await expect(page.getByText("Item 1 of 15")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Amount (whole dollars)" })).toBeVisible();
  await a11y(KNOWN_FAINT_TEXT);
  await answerItem("rapid-calcs", "qc-01");
  await expect(page.getByText("Item 2 of 15")).toBeVisible();
  await finishSection();

  // ---- 6 · Schedule C: the whole sheet from the key, then the note to Elena ----
  await expect(sectionBar).toContainText("Section 6 of 6");
  await expect(heading(/^Schedule C input: /)).toBeVisible();
  const sheet = keys["schedule-c"] as { cells: Record<string, { value: number }> };
  for (const [id, line] of [
    ["l1", "Line 1"],
    ["l8", "Line 8"],
    ["l9", "Line 9"],
    ["l13", "Line 13"],
    ["l15", "Line 15"],
    ["l17", "Line 17"],
    ["l22", "Line 22"],
    ["l24b", "Line 24b"],
    ["l27a", "Line 27a"],
    ["l28", "Line 28"],
    ["l29", "Line 29"],
    ["l30", "Line 30"],
    ["l31", "Line 31"],
  ]) {
    await page.getByLabel(`${line}, C`, { exact: true }).fill(String(sheet.cells[id].value));
  }
  await candidate.saved();
  await a11y(KNOWN_FAINT_TEXT);
  await candidate.task(/^Note to Elena/).click();
  await page.getByRole("textbox", { name: "Reply" }).fill(`Net profit is $${sheet.cells.l31.value.toLocaleString("en-US")} with the late 1099. Left off the trip, gas, the ticket and health insurance.`);
  await candidate.saved();

  await page.getByRole("link", { name: "Submit", exact: true }).click();
  await land(/\/review$/, "Review before you submit");
  await page.getByRole("checkbox", { name: "I understand I can't make changes after submitting." }).check();
  await page.getByRole("button", { name: "Submit final answers" }).click();
  await land(/\/done$/, /^Submitted\. Thanks/);

  // ---- The company report: per-step scores add up to each section's expected score ----
  await signInViaUi(page, co.users.recruiter, `/app/${co.slug}/candidates/${invite.inviteId}`);
  await land(new RegExp(`/candidates/${invite.inviteId}$`), /Jamie Rivera/);
  const expected: [RegExp, string][] = [
    // Section 1 · rapid A: item 2 only (½).
    [/Rapid round: form to field$/, "0.5/10"],
    // Section 2 · organize: batch 1 (6) and deposits (7) = 13.
    [/Client documents, batch 1 of 3$/, "6/6"],
    [/Client documents, batch 2 of 3$/, "0/6"],
    [/Client documents, batch 3 of 3$/, "0/6"],
    [/Bank deposits vs 1099s$/, "7/7"],
    // Section 3 · rapid B: item 1 (½).
    [/Rapid round: deductible\?$/, "0.5/10"],
    // Section 4 · inbox: the number (4); the replies wait for a reviewer.
    [/Net profit for Elena$/, "4/4"],
    // Section 5 · rapid C: item 1 (½).
    [/Rapid round: quick calcs$/, "0.5/10"],
    // Section 6 · Schedule C (20); the note waits for a reviewer.
    [/Schedule C input: .+$/, "20/20"],
  ];
  for (const [title, score] of expected) {
    await expect(page.getByRole("region", { name: title }).getByText(score, { exact: true }).first(), `${title}`).toBeVisible();
  }
  for (const title of [/about the trip$/, /about the late 1099$/, /^\d+ · Note to Elena/]) {
    await expect(page.getByRole("region", { name: title }).getByText("Needs review", { exact: true }).first()).toBeVisible();
  }
  // 0.5 + 13 + 0.5 + 4 + 0.5 + 20 automatic points; three replies to review.
  await expect(page.getByText("38.5 of 100 points")).toBeVisible();
  await expect(page.getByText("Needs review · 3 tasks")).toBeVisible();
  const forms = page.getByRole("region", { name: /Rapid round: form to field$/ });
  await expect(forms.getByRole("row").filter({ hasText: "Item 1" }).first()).toContainText(/No answer/);
});
