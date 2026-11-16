/**
 * Timed sections (demo-timed-close): rapid items one at a time, an item that
 * times out moving on by itself, finishing a section early, and one-at-a-time
 * screens. Time passes by moving `started_at` back in the database; nothing sleeps.
 */
import { backdateAttempt } from "../support/db";
import { chromiumOnly, expect, KNOWN_FAINT_TEXT, test } from "../support/test";

chromiumOnly();

test("rapid items time out and move on; sections and screens advance and lock", async ({ page, data, candidate, a11y }) => {
  const co = await data.company();
  const { assessmentId } = await data.assessment({
    orgId: co.orgId,
    scenarioId: await data.libraryScenario("demo-timed-close"),
    title: "Timed close",
    timeLimitMinutes: 12,
  });
  const { jobId } = await data.job({ orgId: co.orgId, assessmentId });
  const invite = await data.invite({ orgId: co.orgId, jobId });

  await candidate.startTest(invite);
  const sectionBar = page.getByRole("region", { name: "Section" });
  await expect(sectionBar).toContainText("Section 1 of 3");
  await expect(sectionBar).toContainText("Quick checks");
  await expect(page.getByText("Item 1 of 4")).toBeVisible();
  await expect(page.getByRole("timer")).toBeVisible();
  await a11y(KNOWN_FAINT_TEXT);

  // 30 seconds pass with no answer: item 1 timed out, item 2 is showing.
  await backdateAttempt(invite.inviteId, 0.5, { keepDeadline: true });
  await page.reload();
  await expect(page.getByText("Item 2 of 4")).toBeVisible();

  // Answer item 2: pick the first option in every group, submit, item 3 appears at once.
  for (const group of await page.getByRole("radiogroup").all()) await group.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Submit answer" }).click();
  await expect(page.getByText("Item 3 of 4")).toBeVisible();

  // Finish the section early; it can't be reopened.
  await page.getByRole("button", { name: "Finish section" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Finish section" }).click();
  await expect(sectionBar).toContainText("Section 2 of 3");
  await expect(sectionBar).toContainText("Screen 1 of 2");
  await expect(page.getByRole("heading", { level: 1, name: "Allowance for doubtful accounts" })).toBeVisible();
  await expect(page.getByText("Item 3 of 4")).toHaveCount(0);

  await page.getByRole("button", { name: "Next screen" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Next screen" }).click();
  await expect(sectionBar).toContainText("Screen 2 of 2");
  await expect(page.getByRole("heading", { level: 1, name: "Insurance expense for the month" })).toBeVisible();
  await a11y(KNOWN_FAINT_TEXT);
});
