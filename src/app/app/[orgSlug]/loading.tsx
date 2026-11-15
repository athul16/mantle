// Suspense boundary for every /app page, so navigating between them shows this
// instantly while the session-dependent content streams in.
export default function Loading() {
  return (
    <main style={{ maxWidth: 1360, margin: "0 auto", padding: "28px 32px" }}>
      <p className="row g8 small muted">
        <span className="spin" aria-hidden="true" />
        Loading…
      </p>
    </main>
  );
}
