import Link from "next/link";
import { getIntro } from "@/lib/candidate/attempt";
import { requireSessionPage } from "@/lib/candidate/pages";
import { isMonitored } from "@/lib/proctoring/config";
import { getProctoringSettings } from "@/lib/proctoring/server";
import { CandidateCard, Facts, primaryButton } from "../../ui";
import { SubmitButton } from "../submit-button";
import { StartMonitoredButton } from "./start-button";

// Candidate pages read the link token, the session cookie and the database on
// every request, so they wait on the server rather than show a prefetched shell.
export const instant = false;

export const metadata = { title: "Instructions" };

export default async function InstructionsPage({ params }: PageProps<"/a/[token]/instructions">) {
  const { token } = await params;
  const { session, attempt } = await requireSessionPage(token, ["not_started", "in_progress"]);
  const [{ title, intro, stepCount }, proctoring] = await Promise.all([getIntro(session), getProctoringSettings(session)]);
  const monitored = isMonitored(proctoring);
  const watched = [proctoring.camera ? "camera" : null, proctoring.screen ? "entire screen" : null].filter(Boolean).join(" and ");
  const minutes = session.invite.timeLimitMinutes;
  const { extraTimePercent, waiveCamera, waiveScreen } = session.invite.accommodations;
  const waived = [waiveCamera ? "camera" : null, waiveScreen ? "screen share" : null].filter(Boolean).join(" and ");

  return (
    <CandidateCard title="Before you start" wide>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm leading-6 whitespace-pre-line">{intro}</p>
      </section>

      <Facts
        items={[
          ["Time limit", extraTimePercent ? `${minutes} minutes (includes ${extraTimePercent}% extra time)` : `${minutes} minutes`],
          ["Tasks", `${stepCount}, delivered through the inbox`],
        ]}
      />

      <section className="space-y-2 text-sm leading-6">
        <h3 className="font-semibold">How it works</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>Messages arrive in the inbox on the left. Some arrive while you work.</li>
          <li>Open a message to see its task on the right. Your answers save automatically.</li>
          <li>You can move between tasks freely and change answers until you submit.</li>
          <li>A calculator and notes on paper are fine. Do the work yourself.</li>
          <li>The timer runs on our server. Closing the tab doesn&apos;t pause it; reopen your link to continue.</li>
          <li>When time runs out, whatever you&apos;ve saved is submitted automatically.</li>
          {waived ? <li>{session.invite.companyName} has excused you from the {waived} for this assessment.</li> : null}
          {monitored ? (
            <li>
              Your {watched} {proctoring.camera && proctoring.screen ? "are" : "is"} monitored until you submit. If{" "}
              {proctoring.screen ? "sharing stops" : "the camera turns off"}, the test is covered until you turn it back on; the timer
              keeps running.
            </li>
          ) : null}
        </ul>
      </section>

      {attempt.status === "in_progress" ? (
        <Link href={`/a/${token}/workspace`} className={primaryButton}>
          Back to your test
        </Link>
      ) : monitored ? (
        <StartMonitoredButton token={token} minutes={minutes} />
      ) : (
        <form action="/api/candidate/start" method="post">
          <input type="hidden" name="token" value={token} />
          <SubmitButton className={primaryButton} pendingText="Starting…">
            Start the {minutes}-minute timer
          </SubmitButton>
        </form>
      )}
    </CandidateCard>
  );
}
