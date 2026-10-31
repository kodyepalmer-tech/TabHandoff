import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  approvePairingRequest,
  clearPairingState,
  consumeApprovedPairingRequest,
  listPairingRequests,
  mintPairingCode,
  pairingRequestStatus,
  redeemPairingCode,
  requestPairing,
} from "../src/pairing.ts";
import { preserveExactModelId } from "@tabhandoff/runner";

describe("pairing + model tags", () => {
  beforeEach(() => clearPairingState());

  it("mints and redeems a code once", () => {
    const { code } = mintPairingCode(1_000);
    const first = redeemPairingCode(code, 1_500);
    assert.equal(first.ok, true);
    const second = redeemPairingCode(code, 1_600);
    assert.equal(second.ok, false);
  });

  it("rejects expired codes", () => {
    const { code, expiresAt } = mintPairingCode(1_000);
    const res = redeemPairingCode(code, expiresAt + 1);
    assert.equal(res.ok, false);
    assert.equal(res.error, "expired");
  });

  it("one-click pairing: request stays pending until desktop approves, then consumes once", () => {
    const req = requestPairing(1_000);
    assert.equal(req.status, "pending");
    assert.equal(pairingRequestStatus(req.id, 1_100)?.status, "pending");
    assert.equal(listPairingRequests(1_100).length, 1);
    // Consuming before approval must fail — approval is the security step.
    assert.equal(consumeApprovedPairingRequest(req.id, 1_200).ok, false);
    assert.equal(approvePairingRequest(req.id, 1_300).ok, true);
    assert.equal(pairingRequestStatus(req.id, 1_400)?.status, "approved");
    assert.equal(consumeApprovedPairingRequest(req.id, 1_500).ok, true);
    // Second consume fails — single use.
    assert.equal(consumeApprovedPairingRequest(req.id, 1_600).ok, false);
    assert.equal(listPairingRequests(1_700).length, 0);
  });

  it("pairing requests expire", () => {
    const req = requestPairing(1_000);
    assert.equal(pairingRequestStatus(req.id, req.expiresAt + 1), undefined);
    assert.equal(approvePairingRequest(req.id, req.expiresAt + 1).ok, false);
  });

  it("preserveExactModelId keeps :135m and :latest", () => {
    assert.equal(
      preserveExactModelId(undefined, ["smollm2:135m"], "x"),
      "smollm2:135m",
    );
    assert.equal(
      preserveExactModelId(undefined, ["llama3.2:latest"], "x"),
      "llama3.2:latest",
    );
  });
});
