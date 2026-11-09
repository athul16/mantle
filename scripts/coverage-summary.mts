/**
 * Prints coverage/coverage-summary.json (from `pnpm test:coverage`) as a
 * Markdown table: totals, then one row per directory. CI appends it to the
 * job summary: `tsx scripts/coverage-summary.mts >> "$GITHUB_STEP_SUMMARY"`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

type Metric = { total: number; covered: number; pct: number };
type Entry = Record<"lines" | "statements" | "functions" | "branches", Metric>;

const summary = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8")) as Record<string, Entry>;
const keys = ["lines", "statements", "functions", "branches"] as const;
const pct = (m: Metric) => (m.total === 0 ? "–" : `${((m.covered / m.total) * 100).toFixed(1)}%`);

const dirs = new Map<string, Entry>();
for (const [file, entry] of Object.entries(summary)) {
  if (file === "total") continue;
  const rel = path.relative(process.cwd(), file);
  const dir = rel.split(path.sep).slice(0, 3).join("/");
  const acc = dirs.get(dir) ?? (Object.fromEntries(keys.map((k) => [k, { total: 0, covered: 0, pct: 0 }])) as Entry);
  for (const k of keys) {
    acc[k].total += entry[k].total;
    acc[k].covered += entry[k].covered;
  }
  dirs.set(dir, acc);
}

const row = (name: string, e: Entry) => `| ${name} | ${keys.map((k) => pct(e[k])).join(" | ")} |`;
console.log("### Coverage (all Vitest projects, local test database)\n");
console.log(`| | ${keys.join(" | ")} |`);
console.log(`|---|${keys.map(() => "---:").join("|")}|`);
console.log(row("**total**", summary.total));
for (const [dir, e] of [...dirs].sort(([a], [b]) => a.localeCompare(b))) console.log(row(`\`${dir}\``, e));
console.log("\nReported only; no thresholds yet.");
