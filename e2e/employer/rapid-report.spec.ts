/** Candidate report for a rapid round: per-item answers next to the key with response times, and the Timing evidence card. */
import { signInViaUi } from "../fixtures";
import { chromiumOnly, expect, test } from "../support/test";
import { timedCloseAttempt, timedCloseJob } from "../../tests/helpers/results";

// Like the other company report specs: chromium only; the core happy paths cover firefox and webkit.
chromiumOnly();

test("a recruiter sees each rapid item's answer, the expected answer and the time, plus timing evidence", async ({ page, data, land }) => {
  const co = await data.company();
  const { jobId, scenarioId } = await timedCloseJob(data, co.orgId);
  const jordan = await timedCloseAttempt(data, { orgId: co.orgId, jobId, scenarioId, candidateName: "Jordan Lee" });

  await signInViaUi(page, co.users.recruiter, `/app/${co.slug}/candidates/${jordan.inviteId}`);
  await land(new RegExp(`/candidates/${jordan.inviteId}$`), "Jordan Lee");

  const rapid = page.getByRole("region", { name: /Rapid checks$/ });
  await expect(rapid.getByRole("columnheader", { name: "Time" })).toBeVisible();
  const rent = rapid.getByRole("row").filter({ hasText: "Item 1" });
  await expect(rent.getByText(/^Paid this month's store rent of \$[\d,]+\.\d\d by check\.$/)).toBeVisible();
  await expect(rent.getByRole("cell").nth(1)).toHaveText("Debit: Rent expense; Credit: Cash");
  await expect(rent.getByRole("cell").nth(2)).toHaveText("Debit: Rent expense; Credit: Cash");
  await expect(rent.getByRole("cell").nth(3)).toHaveText("4.2 s");
  const dep = rapid.getByRole("row").filter({ hasText: "Item 4" });
  await expect(dep.getByRole("cell").nth(1)).toHaveText("Monthly depreciation: $123.45");
  await expect(dep.getByRole("cell").nth(2)).toHaveText(/^Monthly depreciation: \$[\d,]+\.\d\d \(± 0\.01\)$/);
  await expect(rapid.getByRole("row").filter({ hasText: "Response time" })).toContainText("Median response");

  const timing = page.getByRole("region", { name: "Timing" });
  const quick = timing.getByRole("group", { name: "Answered within 2 s of returning to the window" });
  await expect(quick.getByText("1 answer", { exact: true })).toBeVisible();
  await expect(quick.getByRole("listitem")).toHaveText(/^Rapid checks, item 3: answered 1\.5 s after returning \(away 7 s\) · 0:17 into the test$/);
  await expect(timing.getByRole("group", { name: "Rapid round vs other tasks" }).getByText("Rapid round 75% · other tasks 0%")).toBeVisible();
});
