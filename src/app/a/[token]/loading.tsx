// Suspense boundary for every candidate page: they read the link token and
// the session cookie at request time.
export default function Loading() {
  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span className="row g8 small muted" role="status">
        <span className="spin" />
        Loading…
      </span>
    </main>
  );
}
