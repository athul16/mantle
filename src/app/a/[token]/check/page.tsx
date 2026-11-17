import { requireSessionPage } from "@/lib/candidate/pages";
import { getProctoringSettings, hasConsented } from "@/lib/proctoring/server";
import { LocalTime } from "../../local-time";
import { BrandAside, SplitPage } from "../../ui";
import { SystemCheck } from "./system-check";

// Candidate pages read the link token, the session cookie and the database on
// every request, so they wait on the server rather than show a prefetched shell.
export const instant = false;

export const metadata = { title: "Check your setup" };

export default async function CheckPage({ params }: PageProps<"/a/[token]/check">) {
  const { token } = await params;
  const { session, attempt } = await requireSessionPage(token, ["not_started", "in_progress"]);
  const [proctoring, consented] = await Promise.all([getProctoringSettings(session), hasConsented(attempt)]);
  const { invite } = session;
  return (
    <SplitPage
      aside={
        <BrandAside
          companyName={invite.companyName}
          jobTitle={invite.jobTitle}
          minutes={invite.timeLimitMinutes}
          deadline={
            <>
              finish by <LocalTime iso={invite.startBy.toISOString()} format="day" />
            </>
          }
          step={2}
        />
      }
      mainStyle={{ maxWidth: 1080 }}
    >
      <SystemCheck token={token} proctoring={proctoring} consented={consented} companyName={invite.companyName} autoFullscreen={!proctoring.fullscreenWaived} />
    </SplitPage>
  );
}
