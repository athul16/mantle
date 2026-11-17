import { redirect } from "next/navigation";
import { CompanyLogo } from "@/components/brand";
import { Icon } from "@/components/icons";
import { loadPageState, pageForStatus } from "@/lib/candidate/pages";
import { isMonitored } from "@/lib/proctoring/config";
import { getProctoringSettings } from "@/lib/proctoring/server";
import { ReleaseMedia } from "./release-media";

// Candidate pages read the link token, the session cookie and the database on
// every request, so they wait on the server rather than show a prefetched shell.
export const instant = false;

export const metadata = { title: "Submitted" };

/** Thank-you page (prototype "done A"). Candidates never see scores (decision Q7, option A). */
export default async function DonePage({ params }: PageProps<"/a/[token]/done">) {
  const { token } = await params;
  const state = await loadPageState(token);

  if (state.kind === "session") {
    const { attempt, session } = state;
    if (attempt.status === "not_started" || attempt.status === "in_progress") redirect(pageForStatus(token, attempt));
    const monitored = isMonitored(await getProctoringSettings(session));
    return (
      <Done
        company={session.invite.companyName}
        job={session.invite.jobTitle}
        firstName={session.invite.candidateName?.trim().split(/\s+/)[0] ?? null}
        timedOut={attempt.submit_reason === "timeout"}
        mediaOff={monitored}
      />
    );
  }

  if (state.kind === "blocked" && state.reason === "completed") {
    return <Done company={state.invite.companyName} job={state.invite.jobTitle} firstName={null} timedOut={false} mediaOff={false} />;
  }
  redirect(`/a/${token}`);
}

function Done({
  company,
  job,
  firstName,
  timedOut,
  mediaOff,
}: {
  company: string;
  job: string;
  firstName: string | null;
  timedOut: boolean;
  mediaOff: boolean;
}) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <ReleaseMedia />
      <header className="cand-head">
        <CompanyLogo name={company} size={32} />
        <div className="col" style={{ lineHeight: 1.25 }}>
          <span className="strong">{company}</span>
          <span className="xs muted">{job}</span>
        </div>
      </header>
      <main style={{ maxWidth: 600, margin: "0 auto", padding: "56px 24px 120px", display: "flex", flexDirection: "column", alignItems: "center", gap: 28, textAlign: "center" }}>
        {timedOut ? (
          <span className="ovicon" style={{ width: 64, height: 64, background: "var(--subtle)", color: "var(--ink-2)" }}>
            <Icon name="clock" className="i-xl" />
          </span>
        ) : (
          <span className="ovicon" style={{ width: 64, height: 64, background: "var(--ok-bg)", color: "var(--ok)" }}>
            <Icon name="check" className="i-xl" />
          </span>
        )}
        <div className="col g8">
          <h1 style={{ fontSize: 30 }}>
            {timedOut ? "Time's up. Your work is in." : firstName ? `Submitted. Thanks, ${firstName}.` : "Submitted. Thanks."}
          </h1>
          <p className="ink2" style={{ fontSize: 16 }}>
            {timedOut
              ? "We submitted everything you saved."
              : `Your work went to ${company}. You can close this window.`}
          </p>
          {mediaOff ? (
            <p className="small muted row g6" style={{ justifyContent: "center" }}>
              <Icon name="videoOff" className="i-sm" />
              Your camera and screen sharing are now off.
            </p>
          ) : null}
        </div>
        <section className="card" style={{ width: "100%", padding: "20px 24px", textAlign: "left", display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 style={{ fontSize: 17 }}>What happens next</h2>
          <ol style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            <li className="row g12" style={{ alignItems: "flex-start" }}>
              <span className="step-n">1</span>
              <span className="small">
                <span className="strong">{company}&apos;s hiring team reviews your work.</span> Scores help, but a person makes the decision.
              </span>
            </li>
            <li className="row g12" style={{ alignItems: "flex-start" }}>
              <span className="step-n">2</span>
              <span className="small">
                <span className="strong">You&apos;ll hear back by email</span> about next steps for the {job} role.
              </span>
            </li>
            <li className="row g12" style={{ alignItems: "flex-start" }}>
              <span className="step-n">3</span>
              <span className="small">
                <span className="strong">Questions?</span> Reply to your invitation email.
              </span>
            </li>
          </ol>
        </section>
        <span className="xs muted">Powered by Mantle</span>
      </main>
    </div>
  );
}
