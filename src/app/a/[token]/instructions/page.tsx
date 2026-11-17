import { CompanyLogo } from "@/components/brand";
import { getIntro } from "@/lib/candidate/attempt";
import { requireSessionPage } from "@/lib/candidate/pages";
import { listText } from "@/lib/proctoring/config";
import { getProctoringSettings } from "@/lib/proctoring/server";
import { PracticeTour } from "./practice-tour";
import { ResumeLink, StartButton } from "./start-button";

// Candidate pages read the link token, the session cookie and the database on
// every request, so they wait on the server rather than show a prefetched shell.
export const instant = false;

export const metadata = { title: "Practice run" };

/**
 * Practice and the short brief (prototype vInstructions()). The practice
 * workspace is clearly marked as not the test; Start sits bottom right in a
 * footer bar so it reads as the way out of practice and into the real thing.
 */
export default async function InstructionsPage({ params }: PageProps<"/a/[token]/instructions">) {
  const { token } = await params;
  const { session, attempt } = await requireSessionPage(token, ["not_started", "in_progress"]);
  const [{ intro, stepCount }, proctoring] = await Promise.all([getIntro(session), getProctoringSettings(session)]);
  const minutes = session.invite.timeLimitMinutes;
  const { extraTimePercent, waiveCamera, waiveScreen, waiveFullscreen, waiveMicrophone } = session.invite.accommodations;
  const waivedList = [
    waiveCamera ? "camera" : null,
    waiveScreen ? "screen share" : null,
    waiveFullscreen || proctoring.fullscreenWaived ? "full screen" : null,
    waiveMicrophone ? "microphone" : null,
  ].filter((w): w is string => w !== null);
  const waived = listText(waivedList);
  const keepOn = [proctoring.camera ? "camera" : null, proctoring.screen ? "screen sharing" : null, proctoring.microphone ? "microphone" : null].filter(
    (w): w is string => w !== null,
  );

  const facts: [string, string][] = [
    ["Time", `${minutes} minutes${extraTimePercent ? ` (includes ${extraTimePercent}% extra)` : ""}`],
    ["Tasks", `${stepCount}, sent to your inbox`],
    ["Allowed", "Calculator, scratch paper"],
    ["Not allowed", "Other tabs, AI tools, your phone, other people"],
  ];
  const autoFullscreen = !proctoring.fullscreenWaived;
  if (autoFullscreen) facts.push(["Full screen", "The test opens in full screen"]);
  const keepOnText = listText(keepOn);
  if (keepOnText) facts.push(["Keep on", keepOnText[0].toUpperCase() + keepOnText.slice(1)]);
  if (waived) facts.push(["Excused", `No ${waived} needed`]);
  facts.push(["Saving", "Automatic. Lost connection? Reopen your link."]);
  facts.push(["Time's up", "Your work is submitted"]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <header className="row g10" style={{ padding: "16px 32px", background: "#fff", borderBottom: "1px solid var(--line)" }}>
        <CompanyLogo name={session.invite.companyName} size={28} />
        <span className="strong">{session.invite.companyName}</span>
        <span className="grow" />
        <span className="xs muted">Step 3 of 4</span>
      </header>

      <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 32, padding: "32px 32px 120px", alignItems: "flex-start" }}>
        <main style={{ flex: "999 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="col g6">
            <div className="row g10 wrap">
              <h1 style={{ fontSize: 24, lineHeight: 1.2 }}>Practice run</h1>
              <span className="badge b-accent">Not timed · not scored</span>
            </div>
            <p className="ink2">Try the workspace here. This isn&apos;t the test.</p>
          </div>
          <PracticeTour minutes={minutes} title="Practice workspace" />
        </main>

        <aside className="card" style={{ flex: "1 1 300px", maxWidth: 380, padding: "22px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <h2 style={{ fontSize: 18 }}>Before you start</h2>
          {intro ? (
            <p className="small ink2" style={{ whiteSpace: "pre-line" }}>
              {intro}
            </p>
          ) : null}
          <dl className="dl">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>

      <footer
        className="row g16 wrap"
        style={{
          position: "sticky",
          bottom: 0,
          justifyContent: "flex-end",
          padding: "14px 32px",
          background: "#fff",
          borderTop: "1px solid var(--line)",
          boxShadow: "0 -4px 12px rgba(0,0,0,.04)",
        }}
      >
        {attempt.status === "in_progress" ? (
          <ResumeLink token={token} fullscreen={autoFullscreen} />
        ) : (
          <>
            <span className="small ink2">The timer starts when you click. You can&apos;t pause it.</span>
            <StartButton token={token} minutes={minutes} fullscreen={autoFullscreen} />
          </>
        )}
      </footer>
    </div>
  );
}
