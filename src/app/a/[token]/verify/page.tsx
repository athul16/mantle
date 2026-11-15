import { redirect } from "next/navigation";
import { Icon } from "@/components/icons";
import { maskEmail } from "@/lib/candidate/code";
import { CODE_TTL_MINUTES, MAX_CODE_ATTEMPTS, consentLabel } from "@/lib/candidate/config";
import { loadPageState, pageForStatus } from "@/lib/candidate/pages";
import { getInviteProctoringSettings } from "@/lib/proctoring/server";
import { DEFAULT_MEDIA_RETENTION_DAYS, DEFAULT_RESULTS_RETENTION_DAYS } from "@/lib/retention/policy";
import { LocalTime } from "../../local-time";
import { BrandAside, ERROR_TEXT, MessageBox, SplitPage } from "../../ui";
import { VerifyForm } from "./verify-form";

// Candidate pages read the link token, the session cookie and the database on
// every request, so they wait on the server rather than show a prefetched shell.
export const instant = false;

export const metadata = { title: "Confirm it's you" };

const RESEND_FORM = "resend-code";

/**
 * Name, emailed code and consent (prototype vVerify()). The "What's recorded,
 * and why" table is the monitoring notice, built from the assessment's real
 * settings; ticking the box is the consent (recorded by /api/candidate/verify).
 * Posting the form is what creates (or resumes) the attempt.
 */
export default async function VerifyPage({ params, searchParams }: PageProps<"/a/[token]/verify">) {
  const { token } = await params;
  const query = await searchParams;
  const state = await loadPageState(token);

  if (state.kind === "session") redirect(pageForStatus(token, state.attempt));
  if (state.kind !== "no_session") redirect(`/a/${token}`);

  const { invite } = state;
  const settings = await getInviteProctoringSettings(invite);
  const mediaDays = settings.mediaRetentionDays ?? DEFAULT_MEDIA_RETENTION_DAYS;
  const resultsDays = settings.resultsRetentionDays ?? DEFAULT_RESULTS_RETENTION_DAYS;
  const company = invite.companyName;
  const error = typeof query.error === "string" ? query.error : undefined;
  const left = typeof query.left === "string" ? Number(query.left) : undefined;

  const resend = (text: string) => (
    <button type="submit" form={RESEND_FORM} className="linkbtn">
      {text}
    </button>
  );
  let message = null;
  if (error === "wrong_code") {
    message = (
      <MessageBox tone="bad">
        That code isn&apos;t right.
        {left !== undefined && Number.isFinite(left) ? (
          <>
            {" "}
            <strong>
              {left} {left === 1 ? "try" : "tries"} left
            </strong>{" "}
            before you need a new code.
          </>
        ) : null}
      </MessageBox>
    );
  } else if (error === "locked") {
    message = <MessageBox tone="bad">Too many wrong codes. {resend("Send a new code")} to try again.</MessageBox>;
  } else if (error === "code_expired") {
    message = <MessageBox tone="warn">That code has expired. {resend("Send a new code")}.</MessageBox>;
  } else if (error === "no_code") {
    message = <MessageBox tone="bad">That code has already been used or was never sent. {resend("Send a new code")}.</MessageBox>;
  } else if (error === "too_soon") {
    message = <MessageBox tone="info">{ERROR_TEXT.too_soon}</MessageBox>;
  } else if (error && ERROR_TEXT[error]) {
    message = <MessageBox tone="bad">{ERROR_TEXT[error]}</MessageBox>;
  }

  const rows: [string, string, string][] = [];
  if (settings.camera) rows.push(["Camera snapshots", "Occasional photos, not video", "Confirm the same person does the whole simulation"]);
  if (settings.screen) rows.push(["Your entire screen", "Only while the simulation is open", "Show that no other tools or people helped"]);
  rows.push(["Your activity", "Opens, edits, sends, copy and paste — timestamped", "Show how you worked, not just what you submitted"]);

  const notice = (
    <>
      <div>
        <h2 style={{ fontSize: 22 }}>What&apos;s recorded, and why</h2>
        <p className="small ink2" style={{ marginTop: 4 }}>
          Read this before you agree. You can stop at any time by closing the window.
        </p>
      </div>
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ fontSize: 14 }}>
          <thead>
            <tr>
              <th>What</th>
              <th>Why</th>
              <th>Who sees it</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([what, sub, why]) => (
              <tr key={what}>
                <td className="strong">
                  {what}
                  <div className="xs muted" style={{ fontWeight: 400 }}>
                    {sub}
                  </div>
                </td>
                <td className="ink2">{why}</td>
                <td className="ink2">{company}&apos;s hiring team</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 12 }}>
        <div style={{ padding: "14px 16px", borderRadius: 10, background: "var(--subtle)", display: "flex", gap: 10 }}>
          <Icon name="trash" />
          <span className="small">
            <span className="strong">
              {settings.camera || settings.screen ? `Photos and screenshots deleted after ${mediaDays} days.` : null} Answers and results
              deleted after {resultsDays} days.
            </span>{" "}
            {company} can delete them sooner on request.
            {settings.camera ? " Photos are never used to identify you." : ""}
          </span>
        </div>
        <div style={{ padding: "14px 16px", borderRadius: 10, background: "var(--subtle)", display: "flex", gap: 10 }}>
          <Icon name="user" />
          <span className="small">
            <span className="strong">A person decides.</span> Written replies are scored by a person; nothing rejects you automatically.
          </span>
        </div>
      </div>
      <p className="small ink2" data-testid="accommodation-contact">
        Need extra time, or can&apos;t use a camera or share your screen? Contact{" "}
        {settings.contactEmail ? (
          <>
            {company} at <a href={`mailto:${settings.contactEmail}`}>{settings.contactEmail}</a>
          </>
        ) : (
          `${company}'s hiring team`
        )}{" "}
        before you start.
      </p>
    </>
  );

  return (
    <SplitPage
      aside={
        <BrandAside
          companyName={company}
          jobTitle={invite.jobTitle}
          minutes={invite.timeLimitMinutes}
          deadline={
            <>
              finish by <LocalTime iso={invite.startBy.toISOString()} format="day" />
            </>
          }
          step={1}
          stepNote="About 1 minute"
        />
      }
    >
      {query.sent ? (
        <MessageBox tone="ok" icon="mail">
          We sent a 6-digit code to {maskEmail(invite.email)}. It expires in {CODE_TTL_MINUTES} minutes.
        </MessageBox>
      ) : null}
      <VerifyForm
        token={token}
        defaultName={invite.candidateName ?? ""}
        sentTo={`${maskEmail(invite.email)} · ${MAX_CODE_ATTEMPTS} tries per code`}
        resendFormId={RESEND_FORM}
        canResend
        message={message}
        notice={notice}
        consentLabel={consentLabel(settings)}
      />
      <form id={RESEND_FORM} action="/api/candidate/code" method="post" hidden>
        <input type="hidden" name="token" value={token} />
      </form>
    </SplitPage>
  );
}
