import { requireSessionPage } from "@/lib/candidate/pages";
import { getProctoringSettings, hasConsented } from "@/lib/proctoring/server";
import { CandidateCard } from "../../ui";
import { SystemCheck } from "./system-check";

// Candidate pages read the link token, the session cookie and the database on
// every request, so they wait on the server rather than show a prefetched shell.
export const instant = false;

export const metadata = { title: "System check" };

export default async function CheckPage({ params }: PageProps<"/a/[token]/check">) {
  const { token } = await params;
  const { session, attempt } = await requireSessionPage(token, ["not_started", "in_progress"]);
  const [proctoring, consented] = await Promise.all([getProctoringSettings(session), hasConsented(attempt)]);
  return (
    <CandidateCard title="System check" wide>
      <SystemCheck token={token} proctoring={proctoring} consented={consented} companyName={session.invite.companyName} />
    </CandidateCard>
  );
}
