import { randomInt } from "node:crypto";

export type PairingSession = {
  code: string;
  expiresAt: number;
  used: boolean;
};

/** In-memory single-use pairing codes — never log the code after mint. */
let current: PairingSession | null = null;
let failCount = 0;
let failWindowStart = 0;

const CODE_TTL_MS = 120_000;
const MAX_FAILS = 8;
const FAIL_WINDOW_MS = 60_000;

/** Mint an 8-char numeric code (easy to type). Overwrites any prior unused code. */
export function mintPairingCode(now = Date.now()): {
  code: string;
  expiresAt: number;
  expiresInSec: number;
} {
  const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
  current = {
    code,
    expiresAt: now + CODE_TTL_MS,
    used: false,
  };
  failCount = 0;
  failWindowStart = now;
  return {
    code,
    expiresAt: current.expiresAt,
    expiresInSec: Math.floor(CODE_TTL_MS / 1000),
  };
}

export function pairingStatus(now = Date.now()): {
  active: boolean;
  expiresInSec: number;
} {
  if (!current || current.used || current.expiresAt <= now) {
    return { active: false, expiresInSec: 0 };
  }
  return {
    active: true,
    expiresInSec: Math.max(0, Math.floor((current.expiresAt - now) / 1000)),
  };
}

/**
 * Redeem a pairing code for the bridge token (once).
 * Auth stays required for all other endpoints — this only bootstraps the token.
 */
export function redeemPairingCode(
  code: string,
  now = Date.now(),
): { ok: true } | { ok: false; error: string; message: string } {
  if (now - failWindowStart > FAIL_WINDOW_MS) {
    failCount = 0;
    failWindowStart = now;
  }
  if (failCount >= MAX_FAILS) {
    return {
      ok: false,
      error: "rate_limited",
      message: "Too many pairing attempts. Wait a minute and try again.",
    };
  }

  const trimmed = (code || "").trim();
  if (!/^\d{8}$/.test(trimmed)) {
    failCount += 1;
    return {
      ok: false,
      error: "invalid_code",
      message: "Pairing code must be 8 digits.",
    };
  }
  if (!current || current.used || current.expiresAt <= now) {
    failCount += 1;
    return {
      ok: false,
      error: "expired",
      message: "No active pairing code. Generate a new one in the desktop app.",
    };
  }
  if (trimmed !== current.code) {
    failCount += 1;
    return {
      ok: false,
      error: "mismatch",
      message: "That pairing code does not match.",
    };
  }

  current.used = true;
  current = null;
  failCount = 0;
  return { ok: true };
}

/** Test helper */
export function clearPairingState(): void {
  current = null;
  failCount = 0;
  failWindowStart = 0;
}
