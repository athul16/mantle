// Suspense boundary for every /app page, so navigating between them shows this
// instantly while the session-dependent content streams in.
export default function Loading() {
  return (
    <p className="row g8 small muted" style={{ padding: "28px 32px" }}>
      <span className="spin" aria-hidden="true" />
      Loading…
    </p>
  );
}
