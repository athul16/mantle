import Link from "next/link";
import { requireOrgMembership } from "@/lib/auth";
import { getScenario } from "@/lib/engine/scenarios";
import { listAssessments, listJobs, listLibraryScenarios, type LibraryScenario } from "@/lib/jobs/queries";
import { Icon } from "@/components/icons";
import { STEP_LABELS, roleFamilyLabel, simulationName } from "../format";
import { LibraryTable, type LibraryRow } from "./library-table";
import { YourAssessmentsTable, type YourAssessmentRow } from "./yours-table";

export const metadata = { title: "Assessments · Mantle" };

/** Length, steps and intro from the scenario's code, when it's known. */
function libraryRow(s: LibraryScenario): LibraryRow {
  let minutes = 45;
  let activities: string[] = [];
  let intro = "";
  try {
    const sc = getScenario(s.slug, s.version);
    minutes = sc.timeLimitMinutes;
    activities = [...new Set(sc.definition.steps.map((st) => STEP_LABELS[st.type] ?? st.type))];
    intro = sc.definition.intro;
  } catch {
    // A published scenario whose code isn't in this build: show what the row has.
  }
  return { id: s.id, title: s.title, family: s.roleFamily, familyLabel: roleFamilyLabel(s.roleFamily), minutes, activities, intro };
}

export default async function AssessmentsPage({ params, searchParams }: PageProps<"/app/[orgSlug]/jobs/assessments">) {
  const { orgSlug } = await params;
  const { tab } = await searchParams;
  const { orgId, role } = await requireOrgMembership(orgSlug);
  const canManage = role !== "viewer";
  const [scenarios, assessments, jobs] = await Promise.all([listLibraryScenarios(), listAssessments(orgId), listJobs(orgId)]);
  const base = `/app/${orgSlug}/jobs/assessments`;
  const yours = tab === "yours";

  const jobCounts = new Map<string, number>();
  for (const j of jobs) jobCounts.set(j.assessmentId, (jobCounts.get(j.assessmentId) ?? 0) + 1);

  const tabs = (
    <nav className="tabs" aria-label="Library" style={{ border: 0 }}>
      <Link className={yours ? "tab" : "tab on"} href={base} aria-current={yours ? undefined : "page"}>
        Ready-made <span className="count">{scenarios.length}</span>
      </Link>
      <Link className={yours ? "tab on" : "tab"} href={`${base}?tab=yours`} aria-current={yours ? "page" : undefined}>
        In use by your jobs <span className="count">{assessments.length}</span>
      </Link>
    </nav>
  );

  const yourRows: YourAssessmentRow[] = assessments.map((a) => ({
    id: a.id,
    title: a.title,
    simulation: simulationName(a.scenarioTitle),
    minutes: a.timeLimitMinutes,
    passScore: a.passScore,
    camera: a.proctoring.camera,
    screen: a.proctoring.screen,
    lockedAt: a.lockedAt,
    jobs: jobCounts.get(a.id) ?? 0,
  }));

  return (
    <main style={{ maxWidth: 1360, margin: "0 auto", padding: "28px 32px 48px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28 }}>Assessments</h1>
          <p className="ink2" style={{ marginTop: 4 }}>
            Ready-made job simulations. Pick one, set it up for your round, then use it for a job.
          </p>
        </div>
        <span style={{ flex: 1 }} />
        <button className="btn" disabled title="Coming later">
          <Icon name="plus" />
          Build your own <span className="soon">Soon</span>
        </button>
      </div>
      {yours ? (
        <YourAssessmentsTable orgId={orgId} rows={yourRows} configureBase={base} canManage={canManage} tabs={tabs} />
      ) : (
        <LibraryTable rows={scenarios.map(libraryRow)} configureBase={base} canManage={canManage} tabs={tabs} />
      )}
    </main>
  );
}
