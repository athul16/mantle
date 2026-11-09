// Suspense boundary for every candidate page: they read the link token and
// the session cookie at request time.
export default function Loading() {
  return (
    <main className="flex-1">
      <p className="px-6 py-16 text-center text-sm text-neutral-500">Loading…</p>
    </main>
  );
}
