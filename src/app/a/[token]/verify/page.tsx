import { redirect } from "next/navigation";
import { maskEmail } from "@/lib/candidate/code";
import { CODE_TTL_MINUTES, consentLabel } from "@/lib/candidate/config";
import { loadPageState, pageForStatus } from "@/lib/candidate/pages";
import { monitoringNoticeParts } from "@/lib/proctoring/config";
import { getInviteProctoringSettings } from "@/lib/proctoring/server";
import { LocalTime } from "../../local-time";
import { BrandAside, ERROR_TEXT, MessageBox, SplitPage } from "../../ui";
import { VerifyForm } from "./verify-form";

// Candidate pages read the link token, the session cookie and the database on
// every request, so they wait on the server rather than show a prefetched shell.
export const instant = false;

export const metadata = { title: "Confirm it's you" };

const RESEND_FORM = "resend-code";

/**
 * Name, emailed code and consent (prototype vVerify()). The "What we record"
 * list is the monitoring notice, built from the assessment's real settings;
 * ticking the box is the consent (recorded by /api/candidate/verify).
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

  const { recorded, details } = monitoringNoticeParts(settings, company);

  const notice = (
    <>
      <h2 id="recorded-heading" style={{ fontSize: 18 }}>
        What we record
      </h2>
      <ul aria-labelledby="recorded-heading" className="small ink2" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
        {recorded.map((r) => (
          <li key={r}>{r[0].toUpperCase() + r.slice(1)}</li>
        ))}
      </ul>
      {details.map((d) => (
        <p key={d} className="small ink2">
          {d}
        </p>
      ))}
      <p className="small ink2" data-testid="accommodation-contact">
        Need extra time or other changes? Email{" "}
        {settings.contactEmail ? <a href={`mailto:${settings.contactEmail}`}>{settings.contactEmail}</a> : `${company}'s hiring team`} before you start.
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
        sentTo={maskEmail(invite.email)}
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
