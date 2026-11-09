import Link from "next/link";
import { requireOrgMembership } from "@/lib/auth";
import { getScenario } from "@/lib/engine/scenarios";
import { listAssessments, listLibraryScenarios } from "@/lib/jobs/queries";
import { LocalDate } from "../local-date";
import { CloneAssessmentButton, CreateAssessmentForm, EditAssessmentForm } from "./assessment-forms";

export const metadata = { title: "Assessments · Assessment Platform" };

/** The time limit the scenario was written for, if its code is known. */
function suggestedMinutes(slug: string, version: number): number {
  try {
    return getScenario(slug, version).timeLimitMinutes;
  } catch {
    return 45;
  }
}

export default async function AssessmentsPage({ params }: PageProps<"/app/[orgSlug]/jobs/assessments">) {
  const { orgSlug } = await params;
  const { orgId, role } = await requireOrgMembership(orgSlug);
  const canManage = role !== "viewer";
  const [scenarios, assessments] = await Promise.all([listLibraryScenarios(), listAssessments(orgId)]);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/app/${orgSlug}/jobs`} className="text-sm text-neutral-500 hover:underline">← Jobs</Link>
        <h1 className="text-2xl font-semibold tracking-tight">Assessments</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          An assessment is a library simulation with your settings: time limit, pass score, and proctoring. Settings lock once
          the first candidate starts, so everyone in a round gets the same rules.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="font-medium">Simulation library</h2>
        {scenarios.length === 0 ? (
          <p className="text-sm text-neutral-500">No published simulations yet.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {scenarios.map((s) => (
              <li key={s.id} className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                <p className="font-medium">{s.title}</p>
                <p className="text-xs capitalize text-neutral-500">
                  {s.roleFamily} · v{s.version} · written for {suggestedMinutes(s.slug, s.version)} min
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage && scenarios.length > 0 ? (
        <CreateAssessmentForm
          orgId={orgId}
          scenarios={scenarios.map((s) => ({
            id: s.id,
            label: `${s.title} (v${s.version})`,
            minutes: suggestedMinutes(s.slug, s.version),
          }))}
        />
      ) : null}

      <section className="space-y-2">
        <h2 className="font-medium">Your assessments</h2>
        {assessments.length === 0 ? (
          <p className="text-sm text-neutral-500">None yet.</p>
        ) : (
          <ul className="space-y-3">
            {assessments.map((a) => (
              <li key={a.id} className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {a.title}
                      {a.lockedAt ? (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                          locked
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {a.scenarioTitle} · {a.timeLimitMinutes} min · pass {a.passScore ?? "—"}
                      {a.passScore !== null ? "%" : ""} · camera {a.proctoring.camera ? "on" : "off"} · screen{" "}
                      {a.proctoring.screen ? "on" : "off"}
                    </p>
                    {a.lockedAt ? (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Locked since <LocalDate iso={a.lockedAt} withTime /> because a candidate started. Clone it to change settings.
                      </p>
                    ) : null}
                  </div>
                  {canManage ? <CloneAssessmentButton orgId={orgId} assessmentId={a.id} /> : null}
                </div>
                {canManage && !a.lockedAt ? <EditAssessmentForm orgId={orgId} assessment={a} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
