/**
 * Light-mode `text-neutral-400` on white is about 2.5:1; WCAG AA needs 4.5:1
 * for body-size text. Use `text-neutral-500` or darker (a `dark:` variant is
 * fine: that shade sits on a dark background). Candidate pages and the
 * candidate report are fixed separately and are skipped here for now.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SKIP = [path.join("src", "app", "a", "[token]"), path.join("src", "app", "app", "[orgSlug]", "candidates", "[inviteId]")];
const FAINT = /(?<![\w:-])text-neutral-(?:300|400)\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(tsx|ts)$/.test(e.name) ? [p] : [];
  });
}

describe("faint text", () => {
  it("no light-mode text-neutral-300/400 in app pages and components", () => {
    const hits = sourceFiles(path.join(ROOT, "src"))
      .filter((f) => !SKIP.some((s) => path.relative(ROOT, f).startsWith(s)))
      .flatMap((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .flatMap((line, i) => (FAINT.test(line) ? [`${path.relative(ROOT, f)}:${i + 1}`] : [])),
      );
    expect(hits).toEqual([]);
  });

  it("ignores dark-mode and hover variants", () => {
    expect(FAINT.test('className="text-neutral-600 dark:text-neutral-400"')).toBe(false);
    expect(FAINT.test('className="hover:text-neutral-400"')).toBe(false);
    expect(FAINT.test('className="text-xs text-neutral-400"')).toBe(true);
  });
});
