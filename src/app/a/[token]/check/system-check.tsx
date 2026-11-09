"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { primaryButton } from "../../ui";

const MIN_WIDTH = 1024;
const MIN_HEIGHT = 600;

interface CheckResult {
  desktop: boolean;
  screenOk: boolean;
  width: number;
  height: number;
}

function runChecks(): CheckResult {
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  const mobile = uaData?.mobile ?? /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const width = window.screen.width;
  const height = window.screen.height;
  return { desktop: !mobile, screenOk: width >= MIN_WIDTH && height >= MIN_HEIGHT, width, height };
}

let cached: CheckResult | null = null;
const subscribe = (onChange: () => void) => {
  const handler = () => {
    cached = runChecks();
    onChange();
  };
  window.addEventListener("resize", handler);
  return () => window.removeEventListener("resize", handler);
};
const getSnapshot = () => (cached ??= runChecks());
const getServerSnapshot = () => null;

/**
 * Basic browser checks. Camera and screen share are skeleton step 7
 * (proctoring); the placeholders below show where they'll go.
 */
export function SystemCheck({ token }: { token: string }) {
  const result = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const passed = result ? result.desktop && result.screenOk : false;

  return (
    <div className="space-y-6">
      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
        <CheckRow
          label="Desktop or laptop browser"
          state={result === null ? "pending" : result.desktop ? "pass" : "fail"}
          detail={result && !result.desktop ? "This test needs a computer. Please reopen the link on a desktop or laptop." : undefined}
        />
        <CheckRow
          label={`Screen at least ${MIN_WIDTH}×${MIN_HEIGHT}`}
          state={result === null ? "pending" : result.screenOk ? "pass" : "fail"}
          detail={result ? `Your screen: ${result.width}×${result.height}` : undefined}
        />
        {/* Placeholder: camera permission + start photo (skeleton step 7, proctoring). */}
        <CheckRow label="Camera" state="later" detail="Not required yet." />
        {/* Placeholder: entire-screen share, verified as a monitor surface (skeleton step 7). */}
        <CheckRow label="Screen share" state="later" detail="Not required yet." />
      </ul>

      {passed ? (
        <Link href={`/a/${token}/instructions`} className={primaryButton}>
          Continue to instructions
        </Link>
      ) : (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {result === null ? "Checking…" : "Fix the items above to continue."}
        </p>
      )}
    </div>
  );
}

function CheckRow({ label, state, detail }: { label: string; state: "pending" | "pass" | "fail" | "later"; detail?: string }) {
  const badge = {
    pending: <span className="text-neutral-500">Checking…</span>,
    pass: <span className="text-green-700 dark:text-green-400">OK</span>,
    fail: <span className="text-red-700 dark:text-red-400">Problem</span>,
    later: <span className="text-neutral-400">Coming soon</span>,
  }[state];
  return (
    <li className="flex items-start justify-between gap-4 px-4 py-3">
      <div>
        <p className="font-medium">{label}</p>
        {detail ? <p className="text-neutral-500">{detail}</p> : null}
      </div>
      {badge}
    </li>
  );
}
