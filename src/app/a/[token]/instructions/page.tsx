import Link from "next/link";
import { CompanyLogo } from "@/components/brand";
import { Icon } from "@/components/icons";
import { getIntro } from "@/lib/candidate/attempt";
import { requireSessionPage } from "@/lib/candidate/pages";
import { isMonitored } from "@/lib/proctoring/config";
import { getProctoringSettings } from "@/lib/proctoring/server";
import { SubmitButton } from "../submit-button";
import { PracticeTour } from "./practice-tour";
import { StartMonitoredButton } from "./start-button";

// Candidate pages read the link token, the session cookie and the database on
// every request, so they wait on the server rather than show a prefetched shell.
export const instant = false;

export const metadata = { title: "Before you start" };

/** Briefing and practice (prototype vInstructions(), variant B). */
export default async function InstructionsPage({ params }: PageProps<"/a/[token]/instructions">) {
  const { token } = await params;
  const { session, attempt } = await requireSessionPage(token, ["not_started", "in_progress"]);
  const [{ intro, stepCount }, proctoring] = await Promise.all([getIntro(session), getProctoringSettings(session)]);
  const monitored = isMonitored(proctoring);
  const minutes = session.invite.timeLimitMinutes;
  const watched = [proctoring.camera ? "Camera" : null, proctoring.screen ? "screen" : null].filter(Boolean).join(" or ");

  const { extraTimePercent, waiveCamera, waiveScreen, waiveFullscreen, waiveMicrophone } = session.invite.accommodations;
  const waivedList = [
    waiveCamera ? "camera" : null,
    waiveScreen ? "screen share" : null,
    waiveFullscreen ? "full screen" : null,
    waiveMicrophone ? "microphone" : null,
  ].filter((w): w is string => w !== null);
  const waived = waivedList.length > 1 ? `${waivedList.slice(0, -1).join(", ")} and ${waivedList.at(-1)}` : (waivedList[0] ?? "");

  const facts: [string, string][] = [
    ["Time", `${minutes} min${extraTimePercent ? ` (includes ${extraTimePercent}% extra time)` : ""}, starts when you press Start`],
    ["Tasks", `${stepCount}, delivered through the inbox — some may arrive while you work`],
    ["Allowed", "A calculator, scratch paper"],
    ["Not allowed", "Other tabs or apps, phone, AI tools, other people"],
    ["Saving", "Automatic. Lost connection? Reopen your link."],
  ];
  if (waived) facts.push(["Excused", `${session.invite.companyName} has excused you from the ${waived} for this assessment.`]);
  if (proctoring.camera || proctoring.screen) {
    facts.push([watched, `If ${proctoring.camera && proctoring.screen ? "either" : "it"} stops, the workspace is covered until it's back. The clock keeps running.`]);
  }
  if (proctoring.fullscreen) facts.push(["Full screen", "Stay in full screen; leaving covers the task and the timer keeps running"]);
  if (proctoring.microphone) facts.push(["Microphone", "Your microphone is on; short clips are saved when speech is heard"]);
  if (proctoring.camera && proctoring.gaze) facts.push(["Gaze", "Face the screen; your device checks where you're looking"]);
  facts.push(["At 0:00", "Whatever is saved is submitted"]);

  return (
    <div className="split" style={{ background: "var(--bg)" }}>
      <aside className="iaside">
        <div className="row g10">
          <CompanyLogo name={session.invite.companyName} size={32} />
          <span className="strong">{session.invite.companyName}</span>
          <span className="grow" />
          <span className="xs muted">Step 3 of 4</span>
        </div>
        <div className="col g8">
          <h1 style={{ fontSize: 24, lineHeight: 1.2 }}>Before you start</h1>
          <p className="ink2" style={{ whiteSpace: "pre-line" }}>
            {intro}
          </p>
        </div>
        <dl className="dl">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <span className="grow" />
        <div className="col g10">
          {attempt.status === "in_progress" ? (
            <Link href={`/a/${token}/workspace`} className="btn btn-dark btn-lg">
              Back to your test
            </Link>
          ) : monitored ? (
            <StartMonitoredButton token={token} minutes={minutes} />
          ) : (
            <form action="/api/candidate/start" method="post" className="col">
              <input type="hidden" name="token" value={token} />
              <SubmitButton className="btn btn-dark btn-lg" pendingText="Starting…">
                <Icon name="play" />
                Start the {minutes}-minute simulation
              </SubmitButton>
            </form>
          )}
          <span className="xs muted" style={{ textAlign: "center" }}>
            You can&apos;t pause once the clock starts.
          </span>
        </div>
      </aside>
      <main className="imain">
        <PracticeTour minutes={minutes} title={`${session.invite.jobTitle} simulation`} />
      </main>
    </div>
  );
}
