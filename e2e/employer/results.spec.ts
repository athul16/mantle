/** Results table, candidate report, rubric review and notes; viewers are read-only on scores. */
import type { Page } from "@playwright/test";
import { signInViaUi } from "../fixtures";
import { hold, isServerAction } from "../support/hold";
import { chromiumOnly, expect, test } from "../support/test";
import type { TestData } from "../../tests/helpers/factories";
import { RUBRIC, REPLY_BODY, miniCloseJob, miniCloseScore, scoredAttempt } from "../../tests/helpers/results";

chromiumOnly();

const resultRow = (page: Page, text: string) => page.getByRole("row").filter({ hasText: text });
// First cell is the select checkbox; the name is a link (to the report) or a button (opens the invite drawer).
const rowNames = (page: Page) => page.getByRole("row").locator("td:nth-child(2) > :is(a, button)").allTextContents();

async function setup(data: TestData) {
  const co = await data.company();
  const { jobId, scenarioId } = await miniCloseJob(data, co.orgId);
  // Riley: 8/19 with the reply waiting for review. Sam: 17/19, already reviewed. Plus one invite not started.
  const riley = await scoredAttempt(data, { orgId: co.orgId, jobId, scenarioId, candidateName: "Riley Chen", minutes: 14 });
  const samScore = miniCloseScore();
  const { needsReview: _, ...reply } = samScore.steps["client-reply"];
  void _;
  const reviewedReply = { ...reply, points: 9, items: reply.items.map((i) => ({ ...i, earned: i.max })), review: { by: co.users.admin.id, at: new Date().toISOString() } };
  const sam = await scoredAttempt(data, {
    orgId: co.orgId,
    jobId,
    scenarioId,
    candidateName: "Sam Okafor",
    minutes: 19,
    submittedAt: new Date(Date.now() - 3_600_000),
    score: { ...samScore, points: 17, steps: { ...samScore.steps, "client-reply": reviewedReply } },
  });
  const waiting = await data.invite({ orgId: co.orgId, jobId });
  return { co, jobId, riley, sam, waiting };
}

test("a recruiter sorts and filters results, reviews the reply and adds a note", async ({ page, data, land }) => {
  const { co, jobId, riley, waiting } = await setup(data);
  await signInViaUi(page, co.users.recruiter, `/app/${co.slug}/jobs/${jobId}`);
  await land(/\/jobs\/[0-9a-f-]{36}$/, "Staff accountant");

  // The job page is the results table.
  await expect(page.getByText("Showing 3 of 3")).toBeVisible();
  expect(await rowNames(page)).toEqual(["Sam Okafor", "Riley Chen", waiting.email]);

  const rileyRow = resultRow(page, "Riley Chen");
  await expect(rileyRow.getByText("42.1", { exact: true })).toBeVisible();
  await expect(rileyRow.getByTitle("8 / 19 points so far")).toBeVisible();
  await expect(rileyRow.getByText(/· 14 min$/)).toBeVisible();
  await expect(rileyRow.getByText("Reply to score")).toBeVisible();
  await expect(resultRow(page, "Sam Okafor").getByText("89.5", { exact: true })).toBeVisible();
  await expect(resultRow(page, waiting.email).getByText("Invited", { exact: true })).toBeVisible();

  // Sort and filter
  await page.getByRole("button", { name: "Score", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Score" })).toHaveAttribute("aria-sort", "ascending");
  expect(await rowNames(page)).toEqual(["Riley Chen", "Sam Okafor", waiting.email]);
  await page.getByLabel("Status").selectOption("needs_review");
  await expect(page.getByText("Showing 1 of 3")).toBeVisible();
  expect(await rowNames(page)).toEqual(["Riley Chen"]);
  await page.getByLabel("Status").selectOption("all");
  await page.getByRole("searchbox", { name: "Search" }).fill("okafor");
  expect(await rowNames(page)).toEqual(["Sam Okafor"]);
  await page.getByRole("searchbox", { name: "Search" }).fill("");

  // Report
  await page.getByRole("link", { name: "Riley Chen" }).click();
  await land(new RegExp(`/candidates/${riley.inviteId}$`), "Riley Chen");
  await expect(page.getByTestId("final-score")).toHaveText("42.1");
  await expect(page.getByText("8 of 19 points")).toBeVisible();
  await expect(page.getByText("Needs review · 1 task")).toBeVisible();
  await expect(page.getByText("60 · Below bar")).toBeVisible();

  const sheet = page.getByRole("region", { name: /October bank reconciliation$/ });
  await expect(sheet.getByText("6/8")).toBeVisible();
  const book = sheet.getByRole("row").filter({ hasText: "Adjusted book balance" });
  await expect(book.getByRole("cell").nth(1)).toHaveText("10,000.00");
  await expect(book.getByRole("cell").nth(2)).toHaveText(/^\d{1,3}(,\d{3})*\.\d\d$/);
  await expect(book.getByRole("cell").nth(3)).toHaveText("Wrong");

  const numeric = page.getByRole("region", { name: /Quick question from Dana$/ });
  await expect(numeric.getByRole("columnheader", { name: "Expected" })).toBeVisible();
  await expect(numeric.getByRole("row").filter({ hasText: "Value" }).getByRole("cell").nth(1)).toHaveText("$10,400.00");

  const reply = page.getByRole("region", { name: /Reply to Marcus$/ });
  await expect(reply.getByText(REPLY_BODY, { exact: false })).toBeVisible();
  await expect(reply.getByText("Needs review", { exact: true })).toBeVisible();
  await expect(reply.getByText(/Mentions the \$[\d,]+\.\d\d bank service fee/)).toBeVisible();

  // Timeline
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline.getByText("Started the assessment")).toBeVisible();
  await expect(timeline.getByText('Saved "October bank reconciliation" (2 times)')).toBeVisible();
  await expect(timeline.getByRole("listitem").filter({ hasText: "Submitted the assessment" })).toContainText("14:00");

  // Rubric review updates the final score
  const form = reply.getByRole("form", { name: "Review Reply to Marcus" });
  for (const c of RUBRIC) await form.getByLabel(new RegExp(c.label)).fill(String(c.max));
  const held = await hold(page, isServerAction);
  await form.getByRole("button", { name: "Save review" }).click();
  await held.arrived;
  await expect(form.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await held.release();
  await expect(form.getByText("Review saved. The final score is updated.")).toBeVisible();
  await expect(page.getByTestId("final-score")).toHaveText("89.5");
  await expect(page.getByText(/^Needs review · /)).toHaveCount(0);
  await expect(reply.getByText("Reviewed 9/9")).toBeVisible();
  await expect(reply.getByText(/^reviewed /)).toBeVisible();

  // A note, then a vote
  const votes = page.getByRole("region", { name: "Team votes" });
  await votes.getByLabel("Add a note").fill("Solid rec, clear email.");
  await votes.getByRole("button", { name: "Post note" }).click();
  await expect(votes.getByText("Note added.")).toBeVisible();
  const note = votes.getByRole("list", { name: "Notes" }).getByRole("listitem").filter({ hasText: "Solid rec, clear email." });
  await expect(note.getByText(co.users.recruiter.email)).toBeVisible();
  await votes.getByRole("button", { name: "Hire", exact: true }).click();
  await expect(votes.getByRole("button", { name: "Hire", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(votes.getByRole("list", { name: "Votes" }).getByRole("listitem").filter({ hasText: "You" })).toContainText("Hire");
  await expect(votes.getByText("1 voted · 1 note")).toBeVisible();

  // Back on the table, Riley no longer needs review
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Staff accountant" }).click();
  await land(new RegExp(`/(jobs/${jobId}|candidates\\?job=${jobId})$`), "Staff accountant");
  await expect(resultRow(page, "Riley Chen").getByText("89.5", { exact: true })).toBeVisible();
  await expect(resultRow(page, "Riley Chen").getByText("Reply to score")).toHaveCount(0);

  // The author can delete their note
  await page.getByRole("link", { name: "Riley Chen" }).click();
  await land(new RegExp(`/candidates/${riley.inviteId}$`), "Riley Chen");
  await page.getByRole("listitem").filter({ hasText: "Solid rec, clear email." }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("region", { name: "Team votes" }).getByText("1 voted · 0 notes")).toBeVisible();
});

test("a viewer sees scores and answers but cannot review; they can add notes", async ({ page, data, land }) => {
  const { co, jobId, riley } = await setup(data);
  await signInViaUi(page, co.users.viewer, `/app/${co.slug}/candidates?job=${jobId}`);
  await land(new RegExp(`/candidates\\?job=${jobId}$`), "Staff accountant");
  await page.getByRole("link", { name: "Riley Chen" }).click();
  await land(new RegExp(`/candidates/${riley.inviteId}$`), "Riley Chen");

  await expect(page.getByText("Read-only", { exact: true })).toBeVisible();
  await expect(page.getByTestId("final-score")).toHaveText("42.1");
  const reply = page.getByRole("region", { name: /Reply to Marcus$/ });
  await expect(reply.getByText(REPLY_BODY, { exact: false })).toBeVisible();
  await expect(reply.getByText("Waiting for a recruiter or admin to score this task.")).toBeVisible();
  await expect(page.getByRole("form", { name: /Review/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save review" })).toHaveCount(0);
  await expect(page.getByRole("spinbutton")).toHaveCount(0);

  // Notes and votes are open to viewers (docs/03).
  const votes = page.getByRole("region", { name: "Team votes" });
  await votes.getByLabel("Add a note").fill("Would like to meet her.");
  await votes.getByRole("button", { name: "Post note" }).click();
  await expect(votes.getByText("Note added.")).toBeVisible();
  await expect(votes.getByRole("listitem").filter({ hasText: "Would like to meet her." }).getByText(co.users.viewer.email)).toBeVisible();
  await votes.getByRole("button", { name: "Unsure" }).click();
  await expect(votes.getByRole("list", { name: "Votes" }).getByRole("listitem").filter({ hasText: "You" })).toContainText("Unsure");
});

test.describe("another company's report", () => {
  test.use({ allowHttp: [/\/app\//] });

  test("is a 404", async ({ page, data }) => {
    const { co, riley } = await setup(data);
    const other = await data.company();
    await signInViaUi(page, other.users.admin);
    for (const path of [`/app/${co.slug}/candidates/${riley.inviteId}`, `/app/${other.slug}/candidates/${riley.inviteId}`]) {
      await page.goto(path);
      await expect(page.getByText("This page could not be found.")).toBeVisible();
      await expect(page.getByText("Riley Chen")).toHaveCount(0);
    }
  });
});
