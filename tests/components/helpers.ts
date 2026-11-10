/** Small helpers for component tests (not a test file: the components project only runs *.test.tsx). */
import type { Mock } from "vitest";

/** A promise you resolve by hand, to hold a server action "in flight". */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The FormData a mocked server action received on call `n` (default: the last call). */
export function formDataOf(action: Mock, n = -1): Record<string, FormDataEntryValue> {
  const call = n < 0 ? action.mock.calls.at(n) : action.mock.calls[n];
  if (!call) throw new Error("action was not called");
  // useActionState actions get (prevState, formData); plain form actions get (formData).
  const fd = call.find((arg: unknown): arg is FormData => arg instanceof FormData);
  if (!fd) throw new Error("no FormData in call");
  return Object.fromEntries(fd.entries());
}
