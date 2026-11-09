import "server-only";

/**
 * Deterministic seeded RNG for variant generation. Same seed, same sequence,
 * on every machine and Node version.
 *
 * cyrb128 hashes the seed string to 128 bits; sfc32 is a small, fast PRNG with
 * a 128-bit state that passes PractRand. Not cryptographic, and doesn't need to
 * be: the seed itself is server-only (attempt_secrets.seed).
 */

function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** A shuffled copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[];
  /** Money amount in whole cents between min and max dollars, inclusive. */
  cents(minDollars: number, maxDollars: number): number;
}

export function createRng(seed: string): Rng {
  const next = sfc32(...cyrb128(seed));
  // Discard the first outputs; sfc32 needs a few rounds to mix a fresh state.
  for (let i = 0; i < 12; i++) next();

  const int = (min: number, max: number) => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`int(${min}, ${max}): need integers with min <= max`);
    }
    return min + Math.floor(next() * (max - min + 1));
  };

  return {
    next,
    int,
    pick(items) {
      if (items.length === 0) throw new RangeError("pick() from an empty array");
      return items[int(0, items.length - 1)];
    },
    shuffle(items) {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    cents(minDollars, maxDollars) {
      return int(Math.round(minDollars * 100), Math.round(maxDollars * 100));
    },
  };
}
