import { randomInt, randomUUID } from "node:crypto";

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

export type PairingRequest = {
  id: string;
  status: "pending" | "approved" | "consumed";
  createdAt: number;
  expiresAt: number;
};

const pendingRequests = new Map<string, PairingRequest>();

/**
 * One-click pairing, no typed code or token.
 *
 * Flow: extension POSTs /v1/pair/request (extension/local origin only) and
 * gets a request id. The desktop app, which already holds the bridge token,
 * lists pending requests (authenticated) and approves one with a click.
 * The extension then polls its request; once approved, the bridge returns
 * the token once to that same extension-origin caller and consumes the
 * request. An attacker extension could also create a request, but it
 * cannot get the token unless the desktop user approves that specific
 * request — approval is the security step, not the code.
 */
export function requestPairing(now = Date.now()): PairingRequest {
  const req: PairingRequest = {
    id: randomUUID(),
    status: "pending",
    createdAt: now,
    expiresAt: now + CODE_TTL_MS,
  };
  pendingRequests.set(req.id, req);
  return req;
}

export function listPairingRequests(now = Date.now()): PairingRequest[] {
  for (const [id, req] of [...pendingRequests]) {
    if (req.expiresAt <= now) pendingRequests.delete(id);
  }
  return [...pendingRequests.values()].filter((r) => r.status === "pending");
}

export function approvePairingRequest(
  id: string,
  now = Date.now(),
): { ok: true } | { ok: false; error: string } {
  const req = pendingRequests.get(id);
  if (!req || req.expiresAt <= now || req.status !== "pending") {
    return { ok: false, error: "not_found" };
  }
  req.status = "approved";
  return { ok: true };
}

export function consumeApprovedPairingRequest(
  id: string,
  now = Date.now(),
): { ok: true } | { ok: false; error: string } {
  const req = pendingRequests.get(id);
  if (!req || req.expiresAt <= now) {
    if (req) pendingRequests.delete(id);
    return { ok: false, error: "not_found" };
  }
  if (req.status !== "approved") {
    return { ok: false, error: "not_approved" };
  }
  req.status = "consumed";
  pendingRequests.delete(id);
  return { ok: true };
}

export function pairingRequestStatus(
  id: string,
  now = Date.now(),
): PairingRequest | undefined {
  const req = pendingRequests.get(id);
  if (!req || req.expiresAt <= now) return undefined;
  return req;
}

/** Test helper */
export function clearPairingState(): void {
  current = null;
  failCount = 0;
  failWindowStart = 0;
  pendingRequests.clear();
}
