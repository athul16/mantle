import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CompanyLogo } from "@/components/brand";
import { Icon } from "@/components/icons";
import { maskEmail } from "@/lib/candidate/code";
import { loadPageState, pageForStatus } from "@/lib/candidate/pages";
import { isMonitored } from "@/lib/proctoring/config";
import { getProctoringSettings } from "@/lib/proctoring/server";
import { CopyLink } from "../copy-link";
import { LocalTime } from "../local-time";
import { BrandAside, ERROR_TEXT, Facts, MessageBox, SplitPage, StateCard } from "../ui";
import { SubmitButton } from "./submit-button";

// Candidate pages read the link token, the session cookie and the database on
// every request, so they wait on the server rather than show a prefetched shell.
export const instant = false;

export const metadata = { title: "Your assessment" };

/** "mm:ss" left until `deadlineIso` (display only; the server enforces the deadline). */
function timeLeft(deadlineIso: string | null): string {
  const s = deadlineIso ? Math.max(0, Math.floor((new Date(deadlineIso).getTime() - Date.now()) / 1000)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const isPhone = (ua: string) => /iPhone|iPod|Android.+Mobile|Windows Phone|Mobi/i.test(ua);

/**
 * Invite landing page. Opening it must not use anything up: link scanners
 * (Microsoft Safe Links) open it before the candidate does. Only the
 * Continue button (a POST) sends the email code.
 */
export default async function InviteLandingPage({ params, searchParams }: PageProps<"/a/[token]">) {
  const { token } = await params;
  const error = (await searchParams).error;
  const state = await loadPageState(token);

  if (state.kind === "invalid") {
    return (
      <StateCard title="Link not recognised" icon="link">
        <p className="ink2">{ERROR_TEXT.invalid}</p>
        <p className="small muted">Still stuck? Reply to the invitation email and the company can send a new one.</p>
      </StateCard>
    );
  }

  if (state.kind === "session") {
    if (state.attempt.status !== "in_progress") redirect(pageForStatus(token, state.attempt));
    const { invite } = state.session;
    const monitored = isMonitored(await getProctoringSettings(state.session));
    return (
      <StateCard title={invite.candidateName ? `Welcome back, ${invite.candidateName.split(" ")[0]}` : "Welcome back"} companyName={invite.companyName}>
        <p className="ink2" style={{ marginTop: -14 }}>
          Your work is saved. Pick up right where you left off.
        </p>
        <div className="row g14" style={{ padding: 16, borderRadius: 10, background: "var(--subtle)" }}>
          <span className="muted row">
            <Icon name="clock" className="i-lg" />
          </span>
          <div style={{ flex: 1 }}>
            <div className="xs muted">Time left</div>
            <div className="tnum" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>
              {timeLeft(state.attempt.deadline_at)}
            </div>
          </div>
        </div>
        <ul className="small ink2" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {monitored ? <li>We&apos;ll ask you to turn your camera and screen sharing back on first.</li> : null}
          <li>Your answers are exactly as you left them. The clock kept running while you were away.</li>
        </ul>
        <Link href={`/a/${token}/workspace`} className="btn btn-primary btn-lg">
          Resume simulation
        </Link>
      </StateCard>
    );
  }

  const { invite } = state;
  if (state.kind === "blocked") {
    if (state.reason === "completed") {
      return (
        <StateCard title="You've already submitted" companyName={invite.companyName} icon="check" tone="ok">
          <p className="ink2" style={{ marginTop: -14 }}>
            {invite.companyName} received your {invite.jobTitle} simulation. Submissions can&apos;t be reopened.
          </p>
          <p className="small ink2">{invite.companyName} will contact you about next steps.</p>
        </StateCard>
      );
    }
    if (state.reason === "expired") {
      return (
        <StateCard title="This invite has expired" companyName={invite.companyName} icon="clock">
          <p className="ink2" style={{ marginTop: -14 }}>
            The deadline for the {invite.jobTitle} simulation was <LocalTime iso={invite.startBy.toISOString()} format="dayTime" />.
          </p>
          <p className="small ink2">
            If something got in the way, {invite.companyName} may be able to send you a new link. Reply to your invitation email to ask.
          </p>
        </StateCard>
      );
    }
    return (
      <StateCard title="Invitation withdrawn" companyName={invite.companyName} icon="xc">
        <p className="ink2" style={{ marginTop: -14 }}>
          {invite.companyName} withdrew this invitation, so the link no longer works.
        </p>
        <p className="small ink2">If you think this is a mistake, contact {invite.companyName}.</p>
      </StateCard>
    );
  }

  const errorText = typeof error === "string" ? ERROR_TEXT[error] : undefined;
  const codeForm = (label: string) => (
    <form action="/api/candidate/code" method="post">
      <input type="hidden" name="token" value={token} />
      <SubmitButton className="btn btn-dark btn-lg" pendingText="Sending code…">
        {label}
        <Icon name="arrowR" />
      </SubmitButton>
    </form>
  );

  // Started on another device (no session cookie here): a new code moves the test to this device.
  if (state.attempt?.status === "in_progress") {
    return (
      <StateCard title="Continue your assessment" companyName={invite.companyName}>
        <p className="ink2" style={{ marginTop: -14 }}>
          Your saved answers are still there. The clock kept running while you were away.
        </p>
        <dl style={{ margin: 0, display: "flex", gap: 24, fontSize: 13 }}>
          <div>
            <dt className="xs muted">Role</dt>
            <dd className="strong" style={{ margin: "2px 0 0" }}>{invite.jobTitle}</dd>
          </div>
          <div>
            <dt className="xs muted">Status</dt>
            <dd className="strong" style={{ margin: "2px 0 0" }}>Started · {timeLeft(state.attempt.deadline_at)} left</dd>
          </div>
        </dl>
        {errorText ? <MessageBox tone="bad">{errorText}</MessageBox> : null}
        <p className="small ink2">To continue on this device, we&apos;ll email you a new 6-digit code. Your other device will be signed out.</p>
        <form action="/api/candidate/code" method="post">
          <input type="hidden" name="token" value={token} />
          <SubmitButton className="btn btn-primary btn-lg" pendingText="Sending code…">
            Email me a new code
          </SubmitButton>
        </form>
      </StateCard>
    );
  }

  const minutes = invite.timeLimitMinutes;
  const startBy = invite.startBy.toISOString();

  // Phones can't run the workspace: show how to get the link onto a computer (prototype vPhone()).
  const ua = (await headers()).get("user-agent") ?? "";
  if (isPhone(ua)) {
    const host = (await headers()).get("host") ?? "";
    return (
      <main style={{ minHeight: "100vh", background: "#fff", display: "flex", flexDirection: "column" }}>
        <div style={{ background: "#1F2A37", color: "#fff", padding: "28px 24px 32px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="row g10">
            <CompanyLogo name={invite.companyName} size={30} inverse />
            <span className="strong">{invite.companyName}</span>
          </div>
          <span className="beyebrow">{invite.jobTitle}</span>
          <h1 style={{ fontSize: 26, lineHeight: 1.2 }}>You&apos;ll need a computer for this one</h1>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, flex: 1 }}>
          <p className="ink2" style={{ fontSize: 15, lineHeight: 1.55 }}>
            This {minutes}-minute test needs a bigger screen.
          </p>
          <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 12, fontSize: 14 }}>
            <li className="row g10">
              <Icon name="laptop" />
              Laptop or desktop: Chrome, Edge or Firefox
            </li>
            <li className="row g10">
              <Icon name="clock" />
              <span>
                {minutes} quiet minutes before <LocalTime iso={startBy} format="day" />
              </span>
            </li>
          </ul>
          <span className="grow" />
          <div className="col g10">
            <span className="small strong">Get the link onto your computer</span>
            <CopyLink display={`${host}/a/${token.slice(0, 8)}…`} />
            <p className="xs muted">Or open the invitation email on your computer and use the link there.</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <SplitPage
      aside={
        <BrandAside
          companyName={invite.companyName}
          jobTitle={invite.jobTitle}
          minutes={minutes}
          deadline={
            <>
              start by <LocalTime iso={startBy} format="day" />
            </>
          }
          step={1}
          stepNote="Starts with a code by email"
        />
      }
      mainStyle={{ padding: "72px 64px", maxWidth: 900 }}
    >
      <div className="col g8">
        <h1 style={{ fontSize: 30, lineHeight: 1.2 }}>{invite.companyName} invited you to an assessment</h1>
        <p className="ink2" style={{ fontSize: 16 }}>
          Nothing starts until you press Continue.
        </p>
      </div>
      <Facts
        items={[
          ["Company", invite.companyName],
          ["Role", invite.jobTitle],
          ["Time needed", `${minutes} minutes, in one sitting`],
          [
            "Start by",
            <>
              <LocalTime iso={startBy} format="dayTime" />{" "}
              <span className="muted" style={{ fontWeight: 400, display: "block" }}>
                your time
              </span>
            </>,
          ],
        ]}
      />
      {errorText ? <MessageBox tone="bad">{errorText}</MessageBox> : null}
      <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 12, fontSize: 14 }}>
        <li className="row g12" style={{ alignItems: "flex-start" }}>
          <Icon name="laptop" />
          <span>Use a desktop or laptop computer.</span>
        </li>
        <li className="row g12" style={{ alignItems: "flex-start" }}>
          <Icon name="mail" />
          <span>
            When you continue, we&apos;ll email a 6-digit code to <strong>{maskEmail(invite.email)}</strong>, the address this invitation went to.
          </span>
        </li>
        <li className="row g12" style={{ alignItems: "flex-start" }}>
          <Icon name="clock" />
          <span>The {minutes}-minute clock starts only after the instructions page.</span>
        </li>
      </ul>
      <div className="row g16 wrap" style={{ paddingTop: 8, borderTop: "1px solid var(--line)" }}>
        {codeForm("Continue")}
      </div>
    </SplitPage>
  );
}
