/** Candidate system check: browser, screen size and connection (camera and screen share: system-check-proctoring.test.tsx). */
import { act, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The component caches its result at module level, so each test loads a fresh copy.
async function load() {
  vi.resetModules();
  return (await import("@/app/a/[token]/check/system-check")).SystemCheck;
}

function setScreen(width: number, height: number) {
  Object.defineProperty(window.screen, "width", { value: width, configurable: true });
  Object.defineProperty(window.screen, "height", { value: height, configurable: true });
}

function setMobile(mobile: boolean | undefined) {
  Object.defineProperty(navigator, "userAgentData", { value: mobile === undefined ? undefined : { mobile }, configurable: true });
}

const originalUa = navigator.userAgent;
function setUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
}

const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) as Response);

beforeEach(() => {
  setScreen(1440, 900);
  setMobile(undefined);
  setUserAgent(originalUa);
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  setMobile(undefined);
  setUserAgent(originalUa);
  vi.unstubAllGlobals();
});

const row = (label: string) => screen.getAllByRole("listitem").find((li) => li.querySelector(".strong")?.textContent === label)!;
const status = (label: string) => row(label).querySelector("[role=img]")!.getAttribute("aria-label");
const continueLink = () => screen.queryByRole("link", { name: "Continue" });

describe("SystemCheck", () => {
  it("passes on a desktop with a big enough screen and a connection, and links to the instructions", async () => {
    setUserAgent("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36");
    const SystemCheck = await load();
    render(<SystemCheck token="tok123" />);
    expect(status("Browser")).toBe("Passed");
    expect(row("Browser")).toHaveTextContent("Chrome 130");
    expect(status("Screen")).toBe("Passed");
    expect(row("Screen")).toHaveTextContent("1440 × 900 · at least 1024 × 600 needed");
    await waitFor(() => expect(status("Connection")).toBe("Passed"));
    expect(fetchMock).toHaveBeenCalledWith("/api/health", expect.anything());
    expect(screen.getByText("All set. You can continue.")).toBeVisible();
    expect(continueLink()).toHaveAttribute("href", "/a/tok123/instructions");
  });

  it("lists no camera, screen share or start photo when the assessment has no proctoring", async () => {
    const SystemCheck = await load();
    render(<SystemCheck token="t" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText("Camera")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("blocks a small screen", async () => {
    setScreen(800, 600);
    const SystemCheck = await load();
    render(<SystemCheck token="t" />);
    expect(status("Screen")).toBe("Problem");
    expect(row("Screen")).toHaveTextContent("800 × 600");
    await waitFor(() => expect(screen.getByText("Finish the remaining checks to continue")).toBeVisible());
    expect(continueLink()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("blocks a screen that is too short", async () => {
    setScreen(1280, 599);
    const SystemCheck = await load();
    render(<SystemCheck token="t" />);
    expect(status("Screen")).toBe("Problem");
  });

  it("blocks a phone reported by userAgentData", async () => {
    setMobile(true);
    const SystemCheck = await load();
    render(<SystemCheck token="t" />);
    expect(status("Browser")).toBe("Problem");
    expect(row("Browser")).toHaveTextContent("Phones and tablets can't run the simulation. Reopen the link on a computer.");
    expect(continueLink()).not.toBeInTheDocument();
  });

  it("falls back to the user agent string when userAgentData is missing", async () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148");
    const SystemCheck = await load();
    render(<SystemCheck token="t" />);
    expect(status("Browser")).toBe("Problem");
  });

  it("trusts userAgentData over a mobile-looking user agent", async () => {
    setMobile(false);
    setUserAgent("Mozilla/5.0 (Linux; Android 14) Mobile");
    const SystemCheck = await load();
    render(<SystemCheck token="t" />);
    expect(status("Browser")).toBe("Passed");
  });

  it("fails the connection check when our server can't be reached", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const SystemCheck = await load();
    render(<SystemCheck token="t" />);
    await waitFor(() => expect(status("Connection")).toBe("Problem"));
    expect(continueLink()).not.toBeInTheDocument();
  });

  it("re-checks when the window is resized", async () => {
    setScreen(800, 600);
    const SystemCheck = await load();
    render(<SystemCheck token="t" />);
    await waitFor(() => expect(status("Connection")).toBe("Passed"));
    expect(continueLink()).not.toBeInTheDocument();
    setScreen(1920, 1080);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(row("Screen")).toHaveTextContent("1920 × 1080");
    expect(continueLink()).toBeVisible();
  });

  it("shows Checking… before the browser has run the checks (server render)", async () => {
    const SystemCheck = await load();
    const html = renderToString(<SystemCheck token="t" />);
    expect(html).toContain("Checking…");
    expect(html).not.toContain("/instructions");
  });
});
