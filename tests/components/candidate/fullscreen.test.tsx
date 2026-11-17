/** Full screen for every test: Start enters it, and the workspace returns to it on the next click. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFullscreenOnInteract } from "@/lib/candidate/fullscreen";

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const { StartButton } = await import("@/app/a/[token]/instructions/start-button");

let request: ReturnType<typeof vi.fn>;

function setFullscreen(on: boolean) {
  Object.defineProperty(document, "fullscreenElement", { value: on ? document.documentElement : null, configurable: true });
}

beforeEach(() => {
  setFullscreen(false);
  Object.defineProperty(document, "fullscreenEnabled", { value: true, configurable: true });
  request = vi.fn(async () => setFullscreen(true));
  Object.defineProperty(document.documentElement, "requestFullscreen", { value: request, configurable: true });
  router.replace.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

function Harness({ enabled }: { enabled: boolean }) {
  useFullscreenOnInteract(enabled);
  return (
    <>
      <button type="button">Cell</button>
      <div className="wsov">
        <button type="button">Share entire screen</button>
      </div>
    </>
  );
}

describe("StartButton", () => {
  it("goes full screen from the click, then starts and opens the workspace", async () => {
    render(<StartButton token="t" minutes={15} />);
    fireEvent.click(screen.getByRole("button", { name: "Start the 15-minute test" }));
    expect(request).toHaveBeenCalledOnce();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/a/t/workspace"));
  });

  it("skips full screen when the candidate is excused from it", async () => {
    render(<StartButton token="t" minutes={15} fullscreen={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Start the 15-minute test" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(request).not.toHaveBeenCalled();
  });

  it("is a real form posting to the start route, so it works before hydration", () => {
    render(<StartButton token="t" minutes={15} />);
    const button = screen.getByRole("button", { name: "Start the 15-minute test" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button.closest("form")).toHaveAttribute("action", "/api/candidate/start");
  });
});

describe("useFullscreenOnInteract", () => {
  it("returns to full screen on the next click", () => {
    render(<Harness enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Cell" }));
    expect(request).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Cell" }));
    expect(request).toHaveBeenCalledOnce();
  });

  it("leaves clicks in the monitoring cover alone", () => {
    render(<Harness enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Share entire screen" }));
    expect(request).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    render(<Harness enabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Cell" }));
    expect(request).not.toHaveBeenCalled();
  });
});
