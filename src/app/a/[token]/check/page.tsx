import { requireSessionPage } from "@/lib/candidate/pages";
import { CandidateCard } from "../../ui";
import { SystemCheck } from "./system-check";

export const metadata = { title: "System check" };

export default async function CheckPage({ params }: PageProps<"/a/[token]/check">) {
  const { token } = await params;
  await requireSessionPage(token, ["not_started", "in_progress"]);
  return (
    <CandidateCard title="System check" wide>
      <SystemCheck token={token} />
    </CandidateCard>
  );
}
