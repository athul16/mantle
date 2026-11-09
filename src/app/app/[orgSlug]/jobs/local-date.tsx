"use client";

// Formats a timestamp in the viewer's own time zone. The server renders UTC;
// the browser re-renders it locally (hence suppressHydrationWarning).
export function LocalDate({ iso, withTime = false }: { iso: string | null; withTime?: boolean }) {
  if (!iso) return <span>—</span>;
  const date = new Date(iso);
  const text = date.toLocaleString("en-US", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
    ...(typeof window === "undefined" ? { timeZone: "UTC" } : {}),
  });
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
