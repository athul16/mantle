/**
 * Shared helpers for legal scenarios (litigation, corporate, real estate,
 * personal injury, immigration): court-day deadline math under FRCP 6, the
 * firm's own citation guide, and fictional name pools. Pure and deterministic;
 * randomness only comes in through the scenario's seeded `Rng`.
 */
export * from "./citations";
export * from "./dates";
export * from "./names";
