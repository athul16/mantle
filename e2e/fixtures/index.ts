/**
 * Shared Playwright fixtures. Import `test` and `expect` from here, not from
 * @playwright/test:
 *
 *   import { test, expect } from "./fixtures";
 *
 *   test("recruiter invites a candidate", async ({ page, company, signInAs, data }) => {
 *     await signInAs("recruiter");
 *     ...
 *   });
 *
 * - `data`: fixture factories (tests/helpers/factories.ts), cleaned up after the test.
 * - `company`: a fresh company with admin/recruiter/viewer users.
 * - `signInAs(role)`: signs that user of `company` in through the login form on `page`.
 * - `hiring`: company + assessment + job + one invite (with the raw link token).
 * - `outbox`: read emails the app wrote to .dev-outbox.
 * - `axe()`: fail the test on WCAG A/AA violations on the current page.
 */
import { test as base, expect } from "@playwright/test";
import { createTestData, type Role, type TestCompany, type TestData } from "../../tests/helpers/factories";
import * as outboxHelpers from "../../tests/helpers/outbox";
import { signInViaUi } from "./auth";
import { expectNoAxeViolations, type AxeOptions } from "./axe";

type Hiring = Awaited<ReturnType<TestData["hiringSetup"]>>;

type Fixtures = {
  data: TestData;
  company: TestCompany;
  signInAs: (role: Role, next?: string) => Promise<void>;
  hiring: Hiring;
  outbox: typeof outboxHelpers;
  axe: (options?: AxeOptions) => Promise<void>;
};

// The fixture callback is named `provide` (Playwright calls it `use`) so the React hooks lint rule leaves it alone.
export const test = base.extend<Fixtures>({
  data: async ({}, provide, testInfo) => {
    const data = createTestData(`e2e-${testInfo.project.name}-w${testInfo.workerIndex}`);
    await provide(data);
    await data.cleanup();
  },
  company: async ({ data }, provide) => {
    await provide(await data.company());
  },
  signInAs: async ({ page, company }, provide) => {
    await provide((role, next) => signInViaUi(page, company.users[role], next));
  },
  hiring: async ({ data }, provide) => {
    await provide(await data.hiringSetup());
  },
  outbox: async ({}, provide) => {
    await provide(outboxHelpers);
  },
  axe: async ({ page }, provide, testInfo) => {
    await provide((options) => expectNoAxeViolations(page, testInfo, options));
  },
});

export { expect };
export { signInViaUi, storageStateFor } from "./auth";
export { expectNoAxeViolations } from "./axe";
