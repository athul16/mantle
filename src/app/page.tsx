import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 py-24">
      <div className="space-y-4">
        <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">Assessment Platform</p>
        <h1 className="text-4xl font-semibold tracking-tight">See who can do the job before the interview.</h1>
        <p className="text-lg text-neutral-600 dark:text-neutral-400">
          Candidates spend 30 to 45 minutes on a realistic slice of the work: an inbox of requests, a reconciliation
          that doesn&apos;t tie, a client asking a hard question. You get a ranked list with scores, evidence, and
          integrity labels.
        </p>
        <p className="text-neutral-600 dark:text-neutral-400">Starting with accounting and pharmaceutical interns.</p>
      </div>
      <div className="flex gap-3">
        <Link href="/signup" className="rounded-md bg-neutral-900 px-4 py-2 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900">
          Create a company account
        </Link>
        <Link href="/login" className="rounded-md border border-neutral-300 px-4 py-2 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900">
          Sign in
        </Link>
      </div>
    </main>
  );
}
