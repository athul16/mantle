/** LocalDate: UTC (labelled) on the server, the viewer's zone in the browser. */
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalDate } from "@/app/app/[orgSlug]/jobs/local-date";

const ISO = "2026-11-23T23:30:00.000Z";
const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
  vi.restoreAllMocks();
});

describe("LocalDate", () => {
  it("shows a dash when there is no date", () => {
    render(<LocalDate iso={null} />);
    expect(screen.getByText("—")).toBeVisible();
  });

  it("renders the date in the browser's time zone", () => {
    process.env.TZ = "Asia/Kolkata";
    render(<LocalDate iso={ISO} />);
    const time = screen.getByText("Nov 24, 2026");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", ISO);
  });

  it("renders date and time in the browser's zone, without a UTC label", () => {
    process.env.TZ = "America/New_York";
    render(<LocalDate iso={ISO} withTime />);
    expect(screen.getByText("Nov 23, 2026, 6:30 PM")).toBeVisible();
  });

  it("renders UTC, labelled, on the server", () => {
    process.env.TZ = "Asia/Kolkata";
    expect(renderToString(<LocalDate iso={ISO} withTime />)).toContain("Nov 23, 2026, 11:30 PM UTC");
    expect(renderToString(<LocalDate iso={ISO} />)).toContain("Nov 23, 2026<");
  });

  it("builds the server text without Intl, so WebKit hydrates the same text", () => {
    vi.spyOn(Date.prototype, "toLocaleString").mockReturnValue("Nov 23, 2026 at 11:30 PM");
    expect(renderToString(<LocalDate iso={ISO} withTime />)).toContain("Nov 23, 2026, 11:30 PM UTC");
    expect(renderToString(<LocalDate iso={ISO} />)).toContain("Nov 23, 2026<");
  });
});

describe("LocalDate short", () => {
  it("shows month and day in the browser's zone", () => {
    process.env.TZ = "Asia/Kolkata";
    render(<LocalDate iso={ISO} short />);
    expect(screen.getByText("Nov 24")).toHaveAttribute("datetime", ISO);
  });

  it("shows the UTC month and day on the server", () => {
    process.env.TZ = "Asia/Kolkata";
    expect(renderToString(<LocalDate iso={ISO} short />)).toContain(">Nov 23<");
  });
});
