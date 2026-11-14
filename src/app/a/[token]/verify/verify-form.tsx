"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";

/**
 * The verify form (prototype vVerify()): name and code side by side, the
 * monitoring notice (server-rendered, passed as `notice`), one consent box and
 * Continue, which stays disabled until all three are filled in. Posts to
 * /api/candidate/verify like before; "Send a new code" submits the separate
 * form with id `resendFormId` (forms can't nest).
 */
export function VerifyForm({
  token,
  defaultName,
  sentTo,
  resendFormId,
  canResend,
  message,
  notice,
  consentLabel,
}: {
  token: string;
  defaultName: string;
  sentTo: string;
  resendFormId: string;
  canResend: boolean;
  message?: ReactNode;
  notice: ReactNode;
  consentLabel: string;
}) {
  const [name, setName] = useState(defaultName);
  const [code, setCode] = useState("");
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const codeOk = /^\d{6}$/.test(code);
  const ready = codeOk && consent && name.trim() !== "";

  // Back/forward cache: re-enable the button when the page is shown again.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => e.persisted && setPending(false);
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const hint = !name.trim() ? "Enter your full name" : !codeOk ? "Enter the 6-digit code" : !consent ? "Tick the box above" : null;

  return (
    <form action="/api/candidate/verify" method="post" onSubmit={() => setPending(true)} className="col" style={{ gap: 28 }}>
      <input type="hidden" name="token" value={token} />
      <section className="col g16">
        <h1 style={{ fontSize: 22 }}>Confirm it&apos;s you</h1>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 16 }}>
          <div>
            <label className="label" htmlFor="v-name">
              Full name
            </label>
            <input
              id="v-name"
              name="name"
              className="input"
              required
              maxLength={120}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="v-code">
              Code from your email
            </label>
            <div style={{ position: "relative" }}>
              <input
                id="v-code"
                name="code"
                className="input tnum"
                style={{ letterSpacing: ".3em", fontWeight: 600 }}
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                placeholder="······"
                value={code}
                onChange={(e) => setCode(e.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
                aria-describedby="v-code-help"
              />
              {codeOk ? (
                <span className="okc row" style={{ position: "absolute", right: 10, top: 9 }} aria-hidden="true">
                  <Icon name="checkc" />
                </span>
              ) : null}
            </div>
            <p className="help" id="v-code-help">
              Sent to {sentTo} ·{" "}
              {canResend ? (
                <button type="submit" form={resendFormId} className="linkbtn">
                  Send a new code
                </button>
              ) : null}
            </p>
          </div>
        </div>
        {message}
      </section>

      <section className="col g14">
        {notice}
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
          <input
            type="checkbox"
            name="consent"
            className="chk"
            style={{ marginTop: 2 }}
            required
            checked={consent}
            onChange={(e) => setConsent(e.currentTarget.checked)}
          />
          <span className="small">{consentLabel}</span>
        </label>
      </section>

      <div className="row g16 wrap" style={{ paddingTop: 8, borderTop: "1px solid var(--line)", marginTop: -8 }}>
        <span className="row g12 wrap">
          <button type="submit" className="btn btn-dark btn-lg" disabled={!ready || pending}>
            {pending ? "Verifying…" : "Continue"}
            {pending ? null : <Icon name="arrowR" />}
          </button>
          {hint && !pending ? <span className="small muted">{hint} to continue</span> : null}
        </span>
      </div>
    </form>
  );
}
