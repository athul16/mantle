"use client";

import { useActionState, useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { Button, Notice } from "@/components/ui";
import { confirmEnrollment, startEnrollment, type Enrollment } from "../actions";

// Adding an authenticator app: show the QR code and setup key once, then
// confirm with the first code. Nothing is turned on until the code checks out.
// `primary` makes the start button the blue primary one (first setup);
// otherwise it's the plain "Add another" button.
export function EnrollPanel({ next, label, primary = false }: { next?: string; label: string; primary?: boolean }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [starting, startTransition] = useTransition();
  const [state, formAction, pending] = useActionState(confirmEnrollment, undefined);

  if (!enrollment || "error" in enrollment) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
        {enrollment && "error" in enrollment ? <Notice tone="bad">{enrollment.error}</Notice> : null}
        <Button
          type="button"
          variant={primary ? "primary" : "secondary"}
          disabled={starting}
          onClick={() => startTransition(async () => setEnrollment(await startEnrollment()))}
        >
          {primary ? null : <Icon name="plus" />}
          {starting ? "Please wait…" : label}
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input type="hidden" name="factorId" value={enrollment.factorId} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <ol style={{ paddingLeft: 18, display: "flex", flexDirection: "column", gap: 14, fontSize: 14 }}>
        <li>
          <p>Scan this QR code with your authenticator app.</p>
          {/* A data: URL SVG from Supabase Auth; next/image adds nothing here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={enrollment.qrCode}
            alt="QR code for your authenticator app"
            width={152}
            height={152}
            style={{ display: "block", marginTop: 10, borderRadius: 8, border: "1px solid var(--line)", background: "#fff", padding: 6 }}
          />
          <p className="xs muted" style={{ marginTop: 8 }}>
            Can&apos;t scan? Enter this key:{" "}
            <span data-testid="totp-secret" className="tnum strong" style={{ color: "var(--ink)", wordBreak: "break-all" }}>
              {enrollment.secret.replace(/(.{4})/g, "$1 ").trim()}
            </span>
          </p>
          <p className="xs" style={{ marginTop: 4, color: "var(--warn)" }}>
            Don&apos;t screenshot or share this key: anyone with it can make your codes.
          </p>
        </li>
        <li>
          <label htmlFor="mfa-setup-code">Enter the 6-digit code the app shows.</label>
          <input
            id="mfa-setup-code"
            name="code"
            className="input tnum"
            style={{ width: 160, marginTop: 8, letterSpacing: ".3em", fontWeight: 600 }}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="······"
            required
          />
        </li>
      </ol>
      {state?.error ? <Notice tone="bad">{state.error}</Notice> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Turn on two-factor authentication"}
      </Button>
    </form>
  );
}
