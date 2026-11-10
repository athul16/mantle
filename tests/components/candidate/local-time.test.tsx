/** LocalTime on candidate pages: UTC (labelled) on the server, the candidate's zone in the browser. */
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { LocalTime } from "@/app/a/local-time";

const ISO = "2026-11-30T23:59:59.000Z";
const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
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
});
