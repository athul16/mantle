"use client";

import { useRouter } from "next/navigation";

/** Switches the Candidates tab between jobs (?job=<id>). */
export function JobPicker({ base, jobs, current }: { base: string; jobs: { id: string; title: string; count: number }[]; current: string }) {
  const router = useRouter();
  return (
    <select
      className="select"
      style={{ width: "auto", height: 30, fontSize: 13 }}
      aria-label="Job"
      value={current}
      onChange={(e) => router.push(`${base}?job=${e.target.value}`)}
    >
      {jobs.map((j) => (
        <option key={j.id} value={j.id}>
          {j.title} ({j.count})
        </option>
      ))}
    </select>
  );
}
