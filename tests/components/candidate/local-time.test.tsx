/** LocalTime on candidate pages: UTC (labelled) on the server, the candidate's zone in the browser. */
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalTime } from "@/app/a/local-time";

const ISO = "2026-11-30T23:59:59.000Z";
const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
  vi.restoreAllMocks();
});

describe("LocalTime", () => {
  it("shows the time in the browser's zone in a <time> element", () => {
    process.env.TZ = "Asia/Tokyo";
    render(<LocalTime iso={ISO} />);
    const expected = new Date(ISO).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" });
    const time = screen.getByText(expected);
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", ISO);
    expect(time).not.toHaveTextContent("UTC");
  });

  it("renders UTC, labelled, on the server", () => {
    process.env.TZ = "Asia/Tokyo";
    expect(renderToString(<LocalTime iso={ISO} />)).toContain("Nov 30, 2026, 11:59 PM UTC");
  });

  it("builds the server text without Intl, so WebKit hydrates the same text", () => {
    // WebKit's Intl writes "Nov 30, 2026 at 11:59 PM"; the hydration pass must not use it.
    vi.spyOn(Date.prototype, "toLocaleString").mockReturnValue("Nov 30, 2026 at 11:59 PM");
    expect(renderToString(<LocalTime iso={ISO} />)).toContain("Nov 30, 2026, 11:59 PM UTC");
  });

  it("formats midnight and noon as 12", () => {
    expect(renderToString(<LocalTime iso="2026-01-05T00:07:00.000Z" />)).toContain("Jan 5, 2026, 12:07 AM UTC");
    expect(renderToString(<LocalTime iso="2026-01-05T12:00:00.000Z" />)).toContain("Jan 5, 2026, 12:00 PM UTC");
  });
});
