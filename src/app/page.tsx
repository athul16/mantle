import Link from "next/link";
import { MantleMark } from "@/components/brand";

// Public home. Not in the prototype; kept as a short pitch with the sign-in
// and sign-up entry points, styled with the design system.
export default function Home() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <header style={{ height: 56, display: "flex", alignItems: "center", gap: 16, padding: "0 24px", background: "#fff", borderBottom: "1px solid var(--line)" }}>
        <MantleMark />
        <span style={{ flex: 1 }} />
        <Link href="/login" className="btn btn-ghost">Sign in</Link>
      </header>
      <main style={{ width: "100%", maxWidth: 760, margin: "0 auto", padding: "96px 24px", display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <span className="eyebrow">Work simulations for hiring</span>
          <h1 style={{ fontSize: 44, lineHeight: 1.1 }}>See who can do the job before the interview.</h1>
          <p className="ink2" style={{ fontSize: 17, lineHeight: 1.55 }}>
            Candidates spend 30 to 45 minutes on a realistic slice of the work: an inbox of requests, a reconciliation that doesn&apos;t tie, a client asking a
            hard question. You get a ranked list with scores, evidence, and integrity labels.
          </p>
          <p className="ink2">Starting with accounting and pharmaceutical interns.</p>
        </div>
        <div className="row g10">
          <Link href="/signup" className="btn btn-primary btn-lg">Create a company account</Link>
          <Link href="/login" className="btn btn-lg">Sign in</Link>
        </div>
      </main>
    </div>
  );
}
