/**
 * The firm's own short citation guide for legal scenarios, and a formatter
 * that follows it. Written for these simulations: it is not, and doesn't copy,
 * any published citation manual. The courts and reporters are fictional (the
 * State of Wexford, the Fourteenth Circuit), so no citation produced here can
 * point at a real case.
 *
 * A full case citation under the guide:
 *
 *   Name v. Name, volume Reporter first-page, pin (court-abbreviation year)
 *   Ashby v. Corliss Marine Supply, Inc., 41 N.F.R. 3d 212, 219 (14th Cir. 2019)
 *
 * When the reporter only publishes one court (Wex., Wex. 2d) the parenthetical
 * holds the year alone: Quill v. Harrowgate Grain Co., 217 Wex. 2d 55, 61 (2016).
 */

export type CourtId = "14th-cir" | "d-wex" | "wex-sup";

export interface Court {
  id: CourtId;
  /** Full name, as a research file or opinion caption gives it. */
  name: string;
  /** What goes in the parenthetical before the year. */
  abbr: string;
  /** Reporters this court's decisions are published in, oldest series first. */
  reporters: readonly string[];
  /** The reporter already names the court, so the parenthetical is the year alone. */
  yearOnly: boolean;
}

export const COURTS: Readonly<Record<CourtId, Court>> = {
  "14th-cir": {
    id: "14th-cir",
    name: "U.S. Court of Appeals for the Fourteenth Circuit",
    abbr: "14th Cir.",
    reporters: ["N.F.R. 2d", "N.F.R. 3d"],
    yearOnly: false,
  },
  "d-wex": {
    id: "d-wex",
    name: "U.S. District Court for the District of Wexford",
    abbr: "D. Wex.",
    reporters: ["N.F. Supp. 2d", "N.F. Supp. 3d"],
    yearOnly: false,
  },
  "wex-sup": {
    id: "wex-sup",
    name: "Supreme Court of Wexford",
    abbr: "Wex.",
    reporters: ["Wex.", "Wex. 2d"],
    yearOnly: true,
  },
};

/** One reported decision. `name` is the full case name with " v. " (e.g. "Ashby v. Corliss Marine Supply, Inc."). */
export interface CaseCite {
  name: string;
  volume: number;
  reporter: string;
  firstPage: number;
  court: CourtId;
  year: number;
}

/** The firm's guide, rule by rule, in our own words. */
export const CITATION_GUIDE: readonly { id: string; rule: string }[] = [
  { id: "order", rule: "Full citation: case name, volume, reporter, first page, pin cite, then the court and year in parentheses." },
  { id: "name", rule: 'Case name: the parties as the research file gives them, joined by "v." with a period. Never "vs." or "v" alone.' },
  { id: "pin", rule: "Pin cite: the page the point is on, after the first page and a comma. Every citation in a brief gets one." },
  {
    id: "court",
    rule: `Court: ${Object.values(COURTS)
      .filter((c) => !c.yearOnly)
      .map((c) => `${c.name} = ${c.abbr}`)
      .join("; ")}.`,
  },
  {
    id: "year-only",
    rule: `${COURTS["wex-sup"].name}: its reporters (${COURTS["wex-sup"].reporters.join(", ")}) already name the court, so the parentheses hold the year alone.`,
  },
  { id: "year", rule: "Year: the year the decision was issued, as the research file gives it." },
  { id: "short", rule: 'Short form, after the first full citation: first party\'s name, volume, reporter, "at" and the pin, e.g. "Ashby, 41 N.F.R. 3d at 219".' },
];

/** The guide as one block of text, one rule per line, for an exhibit or footnote. */
export function citationGuideText(): string {
  return ["Firm citation guide", ...CITATION_GUIDE.map((r) => `• ${r.rule}`)].join("\n");
}

/** "(14th Cir. 2019)", or "(2016)" for a court whose reporter names it. */
export function citationParenthetical(court: CourtId, year: number): string {
  const c = COURTS[court];
  return c.yearOnly ? `(${year})` : `(${c.abbr} ${year})`;
}

function check(c: CaseCite, pin?: number) {
  const court = COURTS[c.court];
  if (!court) throw new Error(`unknown court "${c.court}"`);
  if (!court.reporters.includes(c.reporter)) throw new Error(`${court.name} isn't reported in "${c.reporter}"`);
  if (!/ v\. /.test(c.name)) throw new Error(`case name needs " v. ": "${c.name}"`);
  if (pin !== undefined && pin < c.firstPage) throw new Error(`pin ${pin} is before the first page ${c.firstPage}`);
}

/** Full citation per the guide, without a trailing period: "Name v. Name, 41 N.F.R. 3d 212, 219 (14th Cir. 2019)". */
export function formatCaseCitation(c: CaseCite, pin?: number): string {
  check(c, pin);
  const pages = pin === undefined ? `${c.firstPage}` : `${c.firstPage}, ${pin}`;
  return `${c.name}, ${c.volume} ${c.reporter} ${pages} ${citationParenthetical(c.court, c.year)}`;
}

/** Short form per the guide: "Ashby, 41 N.F.R. 3d at 219". */
export function shortCaseCitation(c: CaseCite, pin: number): string {
  check(c, pin);
  return `${c.name.split(" v. ")[0]}, ${c.volume} ${c.reporter} at ${pin}`;
}
