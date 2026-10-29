import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  clearPairingState,
  mintPairingCode,
  redeemPairingCode,
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
