/**
 * The e2e journeys' own fixtures, layered on the shared ones in ../fixtures:
 *
 * - `guard` (automatic): fails the test on console errors, page errors, failed
 *   requests and HTTP 5xx (4xx too, unless allowed with `test.use({ allowHttp })`).
 * - `a11y()`: axe on the current page, failing only on serious and critical issues.
 * - `land(url, heading)`: asserts a page change finished: URL, heading, no error
 *   page, then runs a11y().
 * - `cls()`: cumulative layout shift so far in this document (chromium only).
 * - `candidate`: helpers to walk a candidate through the flow.
 */
import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import { test as base, expect } from "../fixtures";
import * as outbox from "../../tests/helpers/outbox";
import { candidateHelpers, type CandidateHelpers } from "./candidate";

export type A11yOptions = {
  /** Axe rule ids to skip on this page, each with a reason (a known app bug, reported). */
  disableRules?: string[];
  exclude?: string[];
};

type Options = {
  /** URL patterns allowed to answer 4xx (e.g. a 404 page the test visits on purpose). */
  allowHttp: RegExp[];
  /** Console messages that are expected in this test. */
  allowConsole: RegExp[];
};

type Fixtures = {
  guard: void;
  a11y: (options?: A11yOptions) => Promise<void>;
  land: (url: RegExp, heading: string | RegExp, options?: A11yOptions) => Promise<void>;
  cls: () => Promise<number>;
  candidate: CandidateHelpers;
};

// Navigation aborts in-flight prefetches and RSC fetches; that's normal, not a failure.
const ABORTED = /abort|cancel|NS_BINDING_ABORTED|ERR_ABORTED|interrupted/i;
// Text Next.js shows on its error pages; a finished page change must not show any of it.
const ERROR_PAGE = /Application error|This page couldn.t load|Internal Server Error|Something went wrong/i;

// WebKit's wording when navigation cancels an in-flight RSC fetch (a prefetch); the same abort as ABORTED above.
const WEBKIT_ABORTED_RSC = /_rsc=.*due to access control checks/;

/**
 * Harness adaptation, not an app change: under `next start` the candidate
 * session cookie is `Secure`. Chromium and Firefox accept that on
 * http://localhost; WebKit drops it, so a candidate could never stay signed in
 * against the plain-http test server. In WebKit only, copy the cookie into the
 * context without the Secure flag. Production is https, where this doesn't arise.
 */
export async function relaxSecureCookies(context: BrowserContext, browserName: string) {
  if (browserName !== "webkit") return;
  await context.route("**/api/candidate/verify", async (route) => {
    const res = await route.fetch({ maxRedirects: 0 });
    const cookies = res
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => {
        const [pair, ...attrs] = h.value.split(";").map((p) => p.trim());
        const [name, ...rest] = pair.split("=");
        const attr = (key: string) => attrs.find((a) => a.toLowerCase().startsWith(`${key}=`))?.split("=")[1];
        return {
          name,
          value: rest.join("="),
          domain: "localhost",
          path: attr("path") ?? "/",
          httpOnly: true,
          secure: false,
          sameSite: "Lax" as const,
          expires: Math.floor(Date.now() / 1000) + Number(attr("max-age") ?? 3600),
        };
      });
    if (cookies.length) await context.addCookies(cookies);
    // Playwright can't fulfill a 3xx, so hand the browser the same redirect as a meta refresh.
    const location = res.headers()["location"];
    if (location) {
      await route.fulfill({ status: 200, contentType: "text/html", body: `<meta http-equiv="refresh" content="0;url=${location}">` });
    } else {
      await route.fulfill({ response: res });
    }
  });
}

/** Installed before any page script: sums layout-shift entries not caused by input. */
const CLS_SCRIPT = `
  window.__cls = 0;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
`;

/**
 * App bug (reported, not ours to fix): `text-neutral-400` labels ("Coming soon" on
 * the system check, "At start" / "5 min in" in the inbox) fail colour contrast
 * (2.5:1). Journeys skip just those nodes; e2e/known-issues.spec.ts tracks it.
 */
export const KNOWN_FAINT_TEXT: A11yOptions = { exclude: [".text-neutral-400"] };

export async function axeSerious(page: Page, testInfo: TestInfo, options: A11yOptions = {}) {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]);
  for (const sel of options.exclude ?? []) builder = builder.exclude(sel);
  if (options.disableRules?.length) builder = builder.disableRules(options.disableRules);
  // Lighthouse found candidate pages without a title or main landmark; axe rates those moderate, so check them here.
  expect(await page.title(), `page title on ${page.url()}`).not.toBe("");
  expect(await page.getAttribute("html", "lang"), "html lang").toBeTruthy();
  await expect(page.getByRole("main"), `one main landmark on ${page.url()}`).toHaveCount(1);
  // Dialogs, menus and banners fade in (the prototype's "rise" animation); let finite animations
  // finish so contrast is measured on the settled page. Spinners loop forever and are skipped.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const results = await builder.analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  await testInfo.attach(`axe ${new URL(page.url()).pathname}`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  const summary = blocking.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`);
  expect(summary, `serious/critical axe violations on ${page.url()}`).toEqual([]);
}

export const test = base.extend<Options & Fixtures>({
  allowHttp: [[], { option: true }],
  allowConsole: [[], { option: true }],

  guard: [
    // Depends on `data` so it is torn down first: the page is closed before the test's rows are deleted,
    // otherwise a still-open page can hit the server mid-cleanup and log errors that aren't the app's.
    async ({ page, context, browserName, allowHttp, allowConsole, data }, provide) => {
      void data;
      await relaxSecureCookies(context, browserName);
      const problems: string[] = [];
      const allowedUrl = (url: string) => allowHttp.some((re) => re.test(url));
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = msg.text();
        if (allowConsole.some((re) => re.test(text))) return;
        // The browser logs every 4xx resource as a console error; those are judged by the response check below.
        if (/Failed to load resource/.test(text) && allowedUrl(msg.location().url)) return;
        problems.push(`console error: ${text}`);
      });
      page.on("pageerror", (err) => {
        if (browserName === "webkit" && WEBKIT_ABORTED_RSC.test(err.message)) return;
        if (allowConsole.some((re) => re.test(err.message))) return;
        problems.push(`page error: ${err.message}`);
      });
      page.on("requestfailed", (req) => {
        const failure = req.failure()?.errorText ?? "";
        if (ABORTED.test(failure)) return;
        problems.push(`request failed: ${req.method()} ${req.url()} (${failure})`);
      });
      page.on("response", (res) => {
        const status = res.status();
        if (status < 400) return;
        if (status < 500 && allowedUrl(res.url())) return;
        problems.push(`HTTP ${status}: ${res.request().method()} ${res.url()}`);
      });
      await page.addInitScript(CLS_SCRIPT);
      await provide();
      await context.close();
      expect(problems, "console errors or failed requests during the journey").toEqual([]);
    },
    { auto: true },
  ],

  a11y: async ({ page }, provide, testInfo) => {
    await provide((options) => axeSerious(page, testInfo, options));
  },

  land: async ({ page }, provide, testInfo) => {
    await provide(async (url, heading, options) => {
      await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByText(ERROR_PAGE)).toHaveCount(0);
      await axeSerious(page, testInfo, options);
    });
  },

  cls: async ({ page }, provide) => {
    await provide(async () => (await page.evaluate(() => (window as unknown as { __cls?: number }).__cls ?? 0)) as number);
  },

  candidate: async ({ page }, provide) => {
    await provide(candidateHelpers(page));
  },
});

export { expect, outbox };

/** Most journeys run in chromium only; the core happy paths run in all three browsers. */
export function chromiumOnly() {
  test.skip(({ browserName }) => browserName !== "chromium", "chromium only; the core happy paths cover firefox and webkit");
}
