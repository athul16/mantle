import "server-only";

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** A random URL-safe token (32 bytes, base64url). Store only its hash. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** sha256 hex of a token, for storing and looking up invite tokens. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A 6-digit email code, zero-padded ("004219"). */
export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/**
 * sha256 hex of a code bound to its invite, so the same 6 digits hash
 * differently per invite and a stored hash can't be checked against another.
 */
export function hashCode(code: string, inviteId: string): string {
  return createHash("sha256").update(`${inviteId}:${code}`).digest("hex");
}

/** Constant-time string comparison. Different lengths are simply unequal. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
