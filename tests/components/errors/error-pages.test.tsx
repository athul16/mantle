/**
 * Error boundaries: friendly copy, a reference id to quote, a retry button,
 * and never the error message or stack trace.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CandidateError from "@/app/a/[token]/error";
import AppError from "@/app/app/error";
import GlobalError from "@/app/global-error";

const SECRET_MESSAGE = "relation invite_secrets: token_hash=abc123 violates";
const STACK_LINE = "at verifyCode (/var/task/src/lib/candidate/code.ts:88:11)";

function serverError(digest?: string) {
  const err = new Error(SECRET_MESSAGE) as Error & { digest?: string };
  err.stack = `Error: ${SECRET_MESSAGE}\n    ${STACK_LINE}`;
  if (digest) err.digest = digest;
  return err;
}

let logged: unknown[][] = [];
beforeEach(() => {
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void logged.push(args));
});
afterEach(() => vi.restoreAllMocks());

function expectNoLeak(text: string) {
  expect(text).not.toContain(SECRET_MESSAGE);
  expect(text).not.toContain("token_hash");
  expect(text).not.toContain(STACK_LINE);
  expect(text).not.toContain("code.ts");
}

describe("candidate error page", () => {
  it("reassures, offers retry and a contact, shows the digest, hides the error", () => {
    const retry = vi.fn();
    const { container } = render(<CandidateError error={serverError("4242424242")} retry={retry} reset={() => {}} />);
    expect(screen.getByRole("heading")).toHaveTextContent(/something went wrong/i);
    expect(container).toHaveTextContent(/answers are saved/i);
    expect(container).toHaveTextContent(/reply to that email/i);
    expect(container).toHaveTextContent("4242424242");
    expectNoLeak(container.textContent ?? "");
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("makes up a reference id for client-side errors and logs it with the error", () => {
    const { container } = render(<CandidateError error={new Error(SECRET_MESSAGE)} retry={() => {}} reset={() => {}} />);
    const ref = screen.getByTestId("error-ref").textContent ?? "";
    expect(ref).toMatch(/^[a-z0-9-]{6,}$/i);
    expectNoLeak(container.textContent ?? "");
    expect(logged.some((args) => args.some((a) => String(a).includes(ref)))).toBe(true);
  });

  it("copes with a thrown non-Error", () => {
    const { container } = render(<CandidateError error={"boom"} retry={() => {}} reset={() => {}} />);
    expect(container).toHaveTextContent(/something went wrong/i);
  });
});

describe("company app error page", () => {
  it("shows a friendly message and the digest, never the error", () => {
    const retry = vi.fn();
    const { container } = render(<AppError error={serverError("9999")} retry={retry} reset={() => {}} />);
    expect(screen.getByRole("heading")).toHaveTextContent(/something went wrong/i);
    expect(container).toHaveTextContent("9999");
    expectNoLeak(container.textContent ?? "");
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe("global error page", () => {
  it("renders its own document without the error text", () => {
    const html = renderToStaticMarkup(<GlobalError error={serverError("7777")} retry={() => {}} reset={() => {}} />);
    expect(html).toMatch(/^<html/);
    expect(html).toContain("<body");
    expect(html).toContain("7777");
    expect(html).toMatch(/something went wrong/i);
    expectNoLeak(html);
  });
});
