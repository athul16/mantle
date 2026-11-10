/** Candidate system check: desktop browser and screen size (camera and screen share: system-check-proctoring.test.tsx). */
import { act, render, screen } from "@testing-library/react";
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

beforeEach(() => {
  setScreen(1440, 900);
  setMobile(undefined);
  setUserAgent(originalUa);
});
afterEach(() => {
  setMobile(undefined);
  setUserAgent(originalUa);
});

const row = (label: string) => screen.getByText(label).closest("li")!;

describe("SystemCheck", () => {
  it("passes on a desktop with a big enough screen and links to the instructions", async () => {
    const SystemCheck = await load();
    render(<SystemCheck token="tok123" />);
    expect(row("Desktop or laptop browser")).toHaveTextContent("OK");
    expect(row("Screen at least 1024×600")).toHaveTextContent("OK");
    expect(row("Screen at least 1024×600")).toHaveTextContent("Your screen: 1440×900");
    expect(screen.getByRole("link", { name: "Continue to instructions" })).toHaveAttribute("href", "/a/tok123/instructions");
  });

  it("shows camera and screen share as not used when the assessment has no proctoring", async () => {
    const SystemCheck = await load();
    render(<SystemCheck token="t" />);
    expect(row("Camera")).toHaveTextContent("Not used");
    expect(row("Camera")).toHaveTextContent("Not used in this test.");
    expect(row("Screen share")).toHaveTextContent("Not used in this test.");
  });

  it("blocks a small screen", async () => {
    setScreen(800, 600);
    const SystemCheck = await load();
    render(<SystemCheck token="t" />);
    expect(row("Screen at least 1024×600")).toHaveTextContent("Problem");
    expect(row("Screen at least 1024×600")).toHaveTextContent("Your screen: 800×600");
    expect(screen.queryByRole("link", { name: "Continue to instructions" })).not.toBeInTheDocument();
    expect(screen.getByText("Fix the items above to continue.")).toBeVisible();
  });

  it("blocks a screen that is too short", async () => {
    setScreen(1280, 599);
    const SystemCheck = await load();
    render(<SystemCheck token="t" />);
    expect(row("Screen at least 1024×600")).toHaveTextContent("Problem");
  });

  it("blocks a phone reported by userAgentData", async () => {
    setMobile(true);
    const SystemCheck = await load();
    render(<SystemCheck token="t" />);
    expect(row("Desktop or laptop browser")).toHaveTextContent("Problem");
    expect(screen.getByText("This test needs a computer. Please reopen the link on a desktop or laptop.")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Continue to instructions" })).not.toBeInTheDocument();
  });

  it("falls back to the user agent string when userAgentData is missing", async () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148");
    const SystemCheck = await load();
    render(<SystemCheck token="t" />);
    expect(row("Desktop or laptop browser")).toHaveTextContent("Problem");
  });

  it("trusts userAgentData over a mobile-looking user agent", async () => {
    setMobile(false);
    setUserAgent("Mozilla/5.0 (Linux; Android 14) Mobile");
    const SystemCheck = await load();
    render(<SystemCheck token="t" />);
    expect(row("Desktop or laptop browser")).toHaveTextContent("OK");
  });

  it("re-checks when the window is resized", async () => {
    setScreen(800, 600);
    const SystemCheck = await load();
    render(<SystemCheck token="t" />);
    expect(screen.queryByRole("link", { name: "Continue to instructions" })).not.toBeInTheDocument();
    setScreen(1920, 1080);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(row("Screen at least 1024×600")).toHaveTextContent("Your screen: 1920×1080");
    expect(screen.getByRole("link", { name: "Continue to instructions" })).toBeVisible();
  });

  it("shows Checking… before the browser has run the checks (server render)", async () => {
    const SystemCheck = await load();
    const html = renderToString(<SystemCheck token="t" />);
    expect(html).toContain("Checking…");
    expect(html).not.toContain("Continue to instructions");
  });
});
