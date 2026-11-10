import type { InviteStatus } from "@/lib/jobs/status";

const STATUS_STYLES: Record<InviteStatus, string> = {
  invited: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  started: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  completed: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  expired: "bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200",
  revoked: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
};

export function StatusBadge({ status, needsReview = false }: { status: InviteStatus; needsReview?: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLES[status]}`}>{status}</span>
      {needsReview ? (
        <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-900 dark:bg-purple-950 dark:text-purple-200">needs review</span>
      ) : null}
    </span>
  );
}
