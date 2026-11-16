import type { Rng } from "../../server/rng";

/**
 * Fictional name pools for legal scenarios: people, law firms, companies for
 * case names and businesses for clients, vendors and third parties. Any match
 * with a real person or business is a coincidence of common words. Firm email
 * domains use the reserved `.example` top-level domain, so none can be real.
 */

export const FIRST_NAMES = [
  "Avery", "Blake", "Camila", "Darius", "Elena", "Farid", "Greta", "Hector", "Imani", "Jonah",
  "Keiko", "Lena", "Mateo", "Nadia", "Owen", "Priya", "Quinn", "Rosa", "Silas", "Tamsin",
  "Uma", "Victor", "Wren", "Yusuf",
] as const;

export const LAST_NAMES = [
  "Abernathy", "Brightwater", "Castellan", "Delacroix", "Ellery", "Fairbanks", "Galloway", "Haverford", "Ingram", "Jessup",
  "Kettering", "Lindqvist", "Marchetti", "Northcott", "Okonkwo", "Pemberton", "Quintero", "Rasmussen", "Sorensen", "Thackeray",
  "Underhill", "Valdivia", "Whitlock", "Yarborough", "Zeller", "Ashdown", "Birchfield", "Corrigan", "Dunmore", "Everly",
] as const;

/** Law firms with a fictional email domain. */
export const LAW_FIRMS = [
  { name: "Halloran & Pike LLP", domain: "halloranpike.example" },
  { name: "Brandt Okafor LLP", domain: "brandtokafor.example" },
  { name: "Castellane Ruiz & Webb LLP", domain: "castellaneruiz.example" },
  { name: "Merriweather Stokes LLP", domain: "merriweatherstokes.example" },
  { name: "Ostrander & Vail LLP", domain: "ostrandervail.example" },
  { name: "Penhallow Grant LLP", domain: "penhallowgrant.example" },
  { name: "Tarrant Ellis & Moore LLP", domain: "tarrantellis.example" },
  { name: "Whitcombe Hale LLP", domain: "whitcombehale.example" },
] as const;

/** Companies for case names (the second party in "Surname v. Company"). */
export const CASE_COMPANIES = [
  "Corliss Marine Supply, Inc.", "Garrow Cold Storage Co.", "Harrowgate Grain Co.", "Bellhaven Logistics, LLC",
  "Stonebridge Carriers, Inc.", "Pelham Produce Co.", "Kestrel Container Lines", "Marlow Dairy Cooperative",
  "Thornbury Transfer Co.", "Wexley Trucking, Inc.", "Avonlea Fisheries, LLC", "Redfern Warehousing Co.",
  "Calder Point Shipping", "Osprey Reefer Services", "Larkspur Foods, Inc.", "Northgate Rail Freight",
  "Ridley Brokerage, LLC", "Fenwick Fruit Exchange", "Tolland Express, Inc.", "Granger Ice & Cold Co.",
  "Halsey Packing Co.", "Brookmere Distributors", "Sable Run Hauling", "Quarry Lane Movers, Inc.",
] as const;

/** Businesses that can play clients, vendors or third parties. */
export const CLIENT_COMPANIES = [
  "Polar Reach Refrigeration", "Coldline Unit Services", "Frostgate Equipment Co.", "Arctic Spur Repair",
  "Cedar Hollow Insurance Brokers", "Bluefen Cold Chain Consulting", "Tamarack Sensor Systems", "Driftwood Pallet Co.",
  "Silverlake Fleet Services", "Ironvale Trailer Leasing", "Harbor Mist Packaging", "Glenrock Food Safety Labs",
] as const;

/** The email domain for a fictional company: letters of its name plus `.example`. */
export function companyDomain(name: string): string {
  return `${name.toLowerCase().replace(/&/g, "and").replace(/\b(inc|llc|co|llp)\b\.?/g, "").replace(/[^a-z]/g, "")}.example`;
}

/** `n` different items from `pool`, in random order. Throws when the pool is too small. */
export function pickDistinct<T>(rng: Rng, pool: readonly T[], n: number): T[] {
  if (n > pool.length) throw new RangeError(`pickDistinct: asked for ${n} from a pool of ${pool.length}`);
  return rng.shuffle(pool).slice(0, n);
}

export interface PersonName {
  first: string;
  last: string;
  full: string;
}

/** A random fictional person. */
export function personName(rng: Rng): PersonName {
  const first = rng.pick(FIRST_NAMES);
  const last = rng.pick(LAST_NAMES);
  return { first, last, full: `${first} ${last}` };
}

/** `n` people with different first and last names, so no two can be confused. */
export function distinctPeople(rng: Rng, n: number): PersonName[] {
  const firsts = pickDistinct(rng, FIRST_NAMES, n);
  const lasts = pickDistinct(rng, LAST_NAMES, n);
  return firsts.map((first, i) => ({ first, last: lasts[i], full: `${first} ${lasts[i]}` }));
}

/** "jhale@domain" style address: first initial + last name. */
export function emailFor(person: PersonName, domain: string): string {
  return `${person.first[0].toLowerCase()}${person.last.toLowerCase()}@${domain}`;
}
