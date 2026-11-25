import type { Rng } from "../../server/rng";
import { pickDistinct } from "../legal/names";

/**
 * Fictional name pools for HR scenarios. People-operations work touches many
 * people at once (a cohort of new hires, a payroll run, a values call), so the
 * pools are larger than the legal ones: up to 48 people with different first
 * and last names. Any match with a real person is a coincidence.
 */

export const HR_FIRST_NAMES = [
  "Adaeze",
  "Bram",
  "Carmen",
  "Dmitri",
  "Esme",
  "Fintan",
  "Gloria",
  "Hiro",
  "Ines",
  "Jasper",
  "Kalani",
  "Leon",
  "Marisol",
  "Nikhil",
  "Oona",
  "Pablo",
  "Rhea",
  "Soren",
  "Talia",
  "Ulric",
  "Vera",
  "Wesley",
  "Ximena",
  "Yara",
  "Zane",
  "Anouk",
  "Bodhi",
  "Celeste",
  "Dorian",
  "Eitan",
  "Fatima",
  "Gideon",
  "Hollis",
  "Ivo",
  "Juniper",
  "Kenji",
  "Lucia",
  "Malik",
  "Noor",
  "Otis",
  "Paloma",
  "Rafferty",
  "Saoirse",
  "Tobias",
  "Valentina",
  "Wyatt",
  "Yusra",
  "Zofia",
] as const;

export const HR_LAST_NAMES = [
  "Achterberg",
  "Bellweather",
  "Calloway",
  "Dunleavy",
  "Eastwick",
  "Fairweather",
  "Gallagher",
  "Holloway",
  "Iverson",
  "Jardine",
  "Kowalczyk",
  "Lachance",
  "Mbeki",
  "Nakamura",
  "Oduya",
  "Prescott",
  "Quill",
  "Rutherford",
  "Strand",
  "Tolliver",
  "Umberto",
  "Vance",
  "Winslow",
  "Xu",
  "Yeoman",
  "Zamora",
  "Ashby",
  "Brannigan",
  "Copeland",
  "Dewhurst",
  "Ellsworth",
  "Fitzroy",
  "Granger",
  "Hartigan",
  "Ibarra",
  "Jennings",
  "Kilbride",
  "Lockwood",
  "Moreau",
  "Nightingale",
  "Ormsby",
  "Penrose",
  "Radcliffe",
  "Sandoval",
  "Thornton",
  "Upchurch",
  "Vasquez",
  "Wexford",
] as const;

export interface HrPerson {
  first: string;
  last: string;
  full: string;
}

/** `n` people (at most 48) with different first and last names, so no two can be confused. */
export function hrPeople(rng: Rng, n: number): HrPerson[] {
  const firsts = pickDistinct(rng, HR_FIRST_NAMES, n);
  const lasts = pickDistinct(rng, HR_LAST_NAMES, n);
  return firsts.map((first, i) => ({
    first,
    last: lasts[i],
    full: `${first} ${lasts[i]}`,
  }));
}
