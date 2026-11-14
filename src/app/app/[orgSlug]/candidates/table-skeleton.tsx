/** Placeholder while a candidates table loads: the page title and striped rows (the prototype's .ph). */
export function TableSkeleton() {
  return (
    <div style={{ maxWidth: 1360, margin: "0 auto", padding: "20px 32px 40px", display: "flex", flexDirection: "column", gap: 16 }} aria-busy="true">
      <p className="sr">Loading…</p>
      <span className="ph" style={{ height: 16, width: 180 }} />
      <span className="ph" style={{ height: 32, width: 320 }} />
      <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="ph" style={{ height: 36 }} />
        ))}
      </div>
    </div>
  );
}
