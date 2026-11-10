/**
 * App bugs these tests found. Each is `test.fixme` with the behaviour we
 * want, so it shows as a known issue in the report and starts running (and
 * passing) once the app is fixed: change `fixme` to `test` then.
 */
import { axeSerious, test } from "./support/test";

test.describe("known app issues", () => {
  test.fixme("light grey labels meet colour contrast (system check, inbox times)", async ({ page, hiring, candidate }, testInfo) => {
    // `text-neutral-400` on white is about 2.5:1; WCAG AA needs 4.5:1 for this size.
    await candidate.verify(hiring.invite);
    await axeSerious(page, testInfo);
  });
});
