/** Brand pieces from the prototype: the Mantle mark and a company's logo tile. */

const MARK_PATH =
  "M443.5 173H898A100 100 0 0 1 998 273V664A100 100 0 0 1 898 764H668C664 742 625 710 606 687A58 58 0 0 1 650 596H680A144 144 0 0 0 680 307H443.5A67 67 0 0 1 443.5 173ZM330 322A112 112 0 0 0 440 390H680A61 61 0 0 1 680 512H648A145 145 0 0 0 511.7 706.6C520 730 548 752 578 764H430A100 100 0 0 1 330 664Z";

/** The Mantle wordmark. `large` is the auth-page size. */
export function MantleMark({ large = false }: { large?: boolean }) {
  return (
    <span className={large ? "mark mark-lg" : "mark"}>
      <svg className="mark-ic" viewBox="330 134 668 668" aria-hidden="true">
        <path fill="#1B45CA" d={MARK_PATH} />
      </svg>
      Mantle
    </span>
  );
}

/** Up to two initials, e.g. "Calder & Finch" → "CF", "jordan.ellis@x.com" → "JE". */
export function initials(name: string): string {
  const words = name
    .split("@")[0]
    .split(/[\s._&-]+/)
    .filter((w) => /^[a-z0-9]/i.test(w));
  const letters = (words.length > 1 ? [words[0], words[words.length - 1]] : words).map((w) => w[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}

/**
 * A company's logo tile. Companies don't upload logos yet, so this shows
 * their initials on the brand navy (the prototype's .logo-co). `inverse` is the
 * white tile used on the dark candidate sidebar.
 */
export function CompanyLogo({ name, size, inverse = false }: { name: string; size?: number; inverse?: boolean }) {
  const style = size ? { width: size, height: size, fontSize: Math.round(size * 0.34), borderRadius: Math.round(size / 4.5) } : undefined;
  return (
    <span className={inverse ? "logo-co inv" : "logo-co"} style={style} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** A person's initials in a circle (.avatar). */
export function Avatar({ name, size }: { name: string; size?: number }) {
  const style = size ? { width: size, height: size, fontSize: Math.round(size * 0.38) } : undefined;
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
