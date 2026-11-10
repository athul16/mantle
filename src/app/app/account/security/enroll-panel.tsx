"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, Field } from "@/components/ui";
import { confirmEnrollment, startEnrollment, type Enrollment } from "../actions";

// Adding an authenticator app: show the QR code and setup key once, then
// confirm with the first code. Nothing is turned on until the code checks out.
export function EnrollPanel({ next, label }: { next?: string; label: string }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [starting, startTransition] = useTransition();
  const [state, formAction, pending] = useActionState(confirmEnrollment, undefined);

  if (!enrollment || "error" in enrollment) {
    return (
      <div className="space-y-3">
        {enrollment && "error" in enrollment ? <ErrorText>{enrollment.error}</ErrorText> : null}
        <Button type="button" disabled={starting} onClick={() => startTransition(async () => setEnrollment(await startEnrollment()))}>
          {starting ? "Please wait…" : label}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ol className="list-decimal space-y-4 pl-5 text-sm">
        <li className="space-y-3">
          <p>Scan this QR code with your authenticator app.</p>
          {/* A data: URL SVG from Supabase Auth; next/image adds nothing here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrollment.qrCode} alt="QR code for your authenticator app" width={180} height={180} className="rounded-md border border-neutral-200 bg-white p-2" />
          <p>
            Can&apos;t scan it? Enter this setup key instead:{" "}
            <code data-testid="totp-secret" className="break-all rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
              {enrollment.secret}
            </code>
          </p>
          <p className="text-neutral-600 dark:text-neutral-400">Don&apos;t screenshot or share this key: anyone with it can make your codes.</p>
        </li>
        <li>
          <p className="mb-3">Enter the 6-digit code the app shows.</p>
          <form action={formAction} className="max-w-xs space-y-3">
            <input type="hidden" name="factorId" value={enrollment.factorId} />
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <Field label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required />
            {state?.error ? <ErrorText>{state.error}</ErrorText> : null}
            <Button type="submit" disabled={pending}>
              {pending ? "Checking…" : "Turn on two-factor authentication"}
            </Button>
          </form>
        </li>
      </ol>
    </div>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
      {children}
    </p>
  );
}
