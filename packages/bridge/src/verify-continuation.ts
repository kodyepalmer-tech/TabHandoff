import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  HASH_INTEGRITY_NOTE,
  validatePortableHandoffPackage,
  type PortableHandoffPackage,
  type TestCommandResult,
} from "@tabhandoff/protocol";
import {
  PortableError,
  readHandoffPackage,
  verifyFileArtifactIntegrity,
} from "./portable.js";

export type CheckOutcome = "pass" | "fail" | "unverified";

export type VerificationCheck = {
  id: string;
  name: string;
  outcome: CheckOutcome;
  detail: string;
};

export type ContinuationVerificationReport = {
  ok: boolean;
  /** Overall: pass only if every required check passed; fail if any failed; else unverified. */
  outcome: CheckOutcome;
  packageId: string;
  schemaVersion: string;
  previousHandoffId?: string;
  checkedAt: string;
  checks: VerificationCheck[];
  hashNote: string;
  limitations: string[];
};

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function overallOutcome(checks: VerificationCheck[]): CheckOutcome {
  if (checks.some((c) => c.outcome === "fail")) return "fail";
  if (checks.length === 0) return "unverified";
  if (checks.every((c) => c.outcome === "pass")) return "pass";
  return "unverified";
}

/**
 * Evaluate whether a destination package honestly received and continued work.
 * Does NOT invent success — missing evidence yields `unverified`, not pass.
 */
export async function verifyContinuation(
  target: string,
  options?: {
    home?: string;
    /** Optional path to the previous package for chain checks. */
    previousPath?: string;
    /** Require at least one destination verified_event after continue. */
    requireDestinationExecution?: boolean;
  },
): Promise<ContinuationVerificationReport> {
  const checkedAt = new Date().toISOString();
  const checks: VerificationCheck[] = [];
  const limitations: string[] = [
    "Verification checks package structure, claim honesty, and recorded events — not model quality.",
    HASH_INTEGRITY_NOTE,
    "Prompt submission alone is never treated as successful continuation.",
  ];

  const { dir, package: pkg } = await readHandoffPackage(target, {
    home: options?.home,
  });

  // 1. Schema
  const schema = validatePortableHandoffPackage(pkg);
  checks.push({
    id: "schema",
    name: "Package validates against portable schema",
    outcome: schema.ok ? "pass" : "fail",
    detail: schema.ok
      ? `schemaVersion ${pkg.schemaVersion}`
      : schema.errors.join("; "),
  });

  // 2. Context receipt — destination must see instruction + remaining or prior results
  const hasContext =
    Boolean(pkg.instruction?.trim()) &&
    (pkg.remainingWork.length > 0 ||
      pkg.previousResults.length > 0 ||
      Boolean(pkg.previousHandoffId));
  checks.push({
    id: "context_receipt",
    name: "Destination package carries task context",
    outcome: hasContext ? "pass" : "fail",
    detail: hasContext
      ? `instruction + ${pkg.remainingWork.length} remaining / ${pkg.previousResults.length} prior results`
      : "Missing instruction or continuation context (remainingWork / previousResults / previousHandoffId).",
  });

  // 3. Remaining-work understanding
  const remainingOk =
    Array.isArray(pkg.remainingWork) &&
    (pkg.remainingWork.length > 0 ||
      pkg.execution.status === "succeeded" ||
      pkg.execution.status === "failed" ||
      pkg.execution.status === "cancelled");
  checks.push({
    id: "remaining_work",
    name: "Remaining work is explicit (or terminal status set)",
    outcome: remainingOk ? "pass" : "unverified",
    detail: remainingOk
      ? `remainingWork=${pkg.remainingWork.length}; status=${pkg.execution.status}`
      : "No remainingWork and non-terminal status — destination may not know what to do.",
  });

  // 4. Claim honesty — no observed_fact without a verified_event nearby (heuristic)
  const observedClaims = (pkg.claims ?? []).filter(
    (c) => c.kind === "observed_fact",
  );
  const verifiedEvents = pkg.execution.events.filter(
    (e) => e.kind === "verified_event",
  );
  if (observedClaims.length === 0) {
    checks.push({
      id: "claim_honesty",
      name: "Claim kinds present / honest",
      outcome: "pass",
      detail: "No observed_fact claims asserted.",
    });
  } else if (verifiedEvents.length === 0) {
    checks.push({
      id: "claim_honesty",
      name: "Claim kinds present / honest",
      outcome: "fail",
      detail:
        "observed_fact claims present without any verified_event — refuse false verification.",
    });
  } else {
    checks.push({
      id: "claim_honesty",
      name: "Claim kinds present / honest",
      outcome: "pass",
      detail: `${observedClaims.length} observed_fact claim(s); ${verifiedEvents.length} verified_event(s).`,
    });
  }

  // 5. Artifact integrity
  const integrity = await verifyFileArtifactIntegrity(dir, {
    home: options?.home,
  });
  checks.push({
    id: "artifacts",
    name: "File artifact SHA-256 integrity",
    outcome:
      integrity.checked === 0
        ? "pass"
        : integrity.ok
          ? "pass"
          : "fail",
    detail:
      integrity.checked === 0
        ? "No hashed file artifacts to check."
        : integrity.ok
          ? `Checked ${integrity.checked} artifact(s).`
          : integrity.mismatches.map((m) => m.reason).join("; "),
  });

  // 6. Chain to previous package when available
  if (pkg.previousHandoffId) {
    if (options?.previousPath) {
      try {
        const prev = await readHandoffPackage(options.previousPath, {
          home: options?.home,
        });
        const match = prev.package.id === pkg.previousHandoffId;
        checks.push({
          id: "chain",
          name: "previousHandoffId matches provided previous package",
          outcome: match ? "pass" : "fail",
          detail: match
            ? `Linked to ${prev.package.id}`
            : `Expected ${pkg.previousHandoffId}, previous package id is ${prev.package.id}`,
        });
        if (
          pkg.provenance?.previousPackageSha256 &&
          match
        ) {
          const raw = await readFile(
            path.join(prev.dir, "handoff.json"),
            "utf8",
          );
          const actual = sha256Hex(raw);
          const okHash = actual === pkg.provenance.previousPackageSha256;
          checks.push({
            id: "chain_hash",
            name: "Previous package SHA-256 matches provenance",
            outcome: okHash ? "pass" : "fail",
            detail: okHash
              ? "previousPackageSha256 matches."
              : "previousPackageSha256 mismatch — package may have been altered after transfer.",
          });
        }
      } catch (err) {
        checks.push({
          id: "chain",
          name: "previousHandoffId matches provided previous package",
          outcome: "fail",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      checks.push({
        id: "chain",
        name: "previousHandoffId present",
        outcome: "pass",
        detail: `previousHandoffId=${pkg.previousHandoffId} (previous package path not provided for deep chain check).`,
      });
      limitations.push(
        "Deep chain hash check skipped — pass --previous <path> to verify provenance.previousPackageSha256.",
      );
    }
  } else {
    checks.push({
      id: "chain",
      name: "Continuation chain",
      outcome: "pass",
      detail:
        "No previousHandoffId — source package (not a continuation). Chain N/A.",
    });
  }

  // 7. Destination execution — require real verified events when asked
  const destEvents = pkg.execution.events.filter(
    (e) =>
      e.kind === "verified_event" &&
      (e.tool?.includes("agent-b") ||
        e.tool?.includes("destination") ||
        e.tool?.includes("run-ai") ||
        e.tool?.includes("continuation") ||
        e.tool === "agent.continue"),
  );
  if (options?.requireDestinationExecution) {
    const launchedHonestly =
      pkg.execution.agentLaunched === true ||
      destEvents.some((e) => e.tool?.includes("run-ai") || e.ok === true);
    // Prompt-only: agentLaunched false and only continue event → unverified/fail
    const onlyContinue =
      destEvents.length > 0 &&
      destEvents.every((e) => e.tool === "agent.continue");
    if (onlyContinue || destEvents.length === 0) {
      checks.push({
        id: "destination_execution",
        name: "Destination executed continuation (not prompt-only)",
        outcome: "fail",
        detail:
          "No destination verified_event beyond package continue. Creating a successor package alone is not successful continuation.",
      });
    } else {
      checks.push({
        id: "destination_execution",
        name: "Destination executed continuation (not prompt-only)",
        outcome: launchedHonestly || destEvents.length > 0 ? "pass" : "unverified",
        detail: `${destEvents.length} destination-related verified_event(s); agentLaunched=${pkg.execution.agentLaunched}`,
      });
    }
  } else {
    checks.push({
      id: "destination_execution",
      name: "Destination execution evidence",
      outcome:
        destEvents.length > 1 ||
        (destEvents.length === 1 && destEvents[0]?.tool !== "agent.continue")
          ? "pass"
          : "unverified",
      detail:
        destEvents.length === 0
          ? "No destination verified_events yet."
          : `${destEvents.length} event(s); requireDestinationExecution not set.`,
    });
  }

  // 8. Declared tests — absent tests are N/A (pass), not a soft failure
  const tests = pkg.tests ?? [];
  if (tests.length === 0) {
    checks.push({
      id: "declared_tests",
      name: "Declared test commands",
      outcome: "pass",
      detail: "No tests[] declared (N/A).",
    });
  } else {
    const failed = tests.filter((t) => t.result === "fail");
    const passed = tests.filter((t) => t.result === "pass");
    const pending = tests.filter(
      (t) => t.result === "not_run" || t.result === "unverified",
    );
    checks.push({
      id: "declared_tests",
      name: "Declared test commands",
      outcome:
        failed.length > 0
          ? "fail"
          : pending.length > 0
            ? "unverified"
            : passed.length === tests.length
              ? "pass"
              : "unverified",
      detail: `pass=${passed.length} fail=${failed.length} pending=${pending.length} total=${tests.length}`,
    });
  }

  // 9. Permissions present for 0.2
  if (pkg.schemaVersion === "0.2") {
    checks.push({
      id: "permissions",
      name: "Explicit permissions on verified package",
      outcome: pkg.permissions ? "pass" : "fail",
      detail: pkg.permissions
        ? JSON.stringify({
            allowNetwork: pkg.permissions.allowNetwork,
            allowFileWrite: pkg.permissions.allowFileWrite,
            allowShell: pkg.permissions.allowShell,
            allowModelCall: pkg.permissions.allowModelCall,
          })
        : "Missing permissions object.",
    });
  }

  // 10. False success guard
  const claimsSuccess = pkg.execution.status === "succeeded";
  const hasVerifiedSuccess = pkg.execution.events.some(
    (e) => e.kind === "verified_event" && e.ok === true && e.detail.toLowerCase().includes("succeed"),
  );
  if (claimsSuccess && !hasVerifiedSuccess && verifiedEvents.length === 0) {
    checks.push({
      id: "false_success",
      name: "No false success claim",
      outcome: "fail",
      detail: "execution.status=succeeded without verifying events.",
    });
  } else {
    checks.push({
      id: "false_success",
      name: "No false success claim",
      outcome: "pass",
      detail: claimsSuccess
        ? "succeeded status accompanied by verified events or justified mark."
        : `status=${pkg.execution.status}`,
    });
  }

  const outcome = overallOutcome(checks);
  return {
    ok: outcome === "pass",
    outcome,
    packageId: pkg.id,
    schemaVersion: pkg.schemaVersion,
    previousHandoffId: pkg.previousHandoffId,
    checkedAt,
    checks,
    hashNote: HASH_INTEGRITY_NOTE,
    limitations,
  };
}

/**
 * Record a test command result onto the package (caller persists via rewrite).
 * Returns updated tests array — does not write disk by itself.
 */
export function applyTestResult(
  pkg: PortableHandoffPackage,
  testId: string,
  result: TestCommandResult,
  outputExcerpt?: string,
): PortableHandoffPackage["tests"] {
  const tests = [...(pkg.tests ?? [])];
  const idx = tests.findIndex((t) => t.id === testId);
  if (idx < 0) {
    throw new PortableError(
      `Unknown test id "${testId}" on package ${pkg.id}`,
      "invalid_input",
    );
  }
  tests[idx] = {
    ...tests[idx]!,
    result,
    outputExcerpt,
    ranAt: new Date().toISOString(),
  };
  return tests;
}

export type EvalHarnessCaseResult = {
  caseId: string;
  metrics: {
    contextReceived: boolean;
    remainingWorkUnderstood: boolean;
    unnecessaryRework: boolean;
    expectedOutputPresent: boolean;
    postContinuationTests: CheckOutcome;
    honestErrors: boolean;
  };
  verification: ContinuationVerificationReport;
};

/**
 * Baseline evaluation metrics for a continuation package.
 * Used by the verified-handoff harness — does not claim product improvement.
 */
export function evaluateContinuationBaseline(
  pkg: PortableHandoffPackage,
  verification: ContinuationVerificationReport,
  options?: { expectedSubstring?: string },
): EvalHarnessCaseResult {
  const contextReceived = verification.checks.some(
    (c) => c.id === "context_receipt" && c.outcome === "pass",
  );
  const remainingWorkUnderstood = verification.checks.some(
    (c) => c.id === "remaining_work" && c.outcome === "pass",
  );
  // Heuristic: rework = destination re-listed completed previousResults as remaining
  const unnecessaryRework = pkg.remainingWork.some((r) =>
    pkg.previousResults.some(
      (p) => p.toLowerCase().includes(r.toLowerCase().slice(0, 40)),
    ),
  );
  const expectedOutputPresent = options?.expectedSubstring
    ? pkg.previousResults.some((r) =>
        r.toLowerCase().includes(options.expectedSubstring!.toLowerCase()),
      ) ||
      pkg.execution.events.some((e) =>
        e.detail.toLowerCase().includes(options.expectedSubstring!.toLowerCase()),
      )
    : pkg.previousResults.length > 0 ||
      pkg.execution.events.some(
        (e) => e.kind === "verified_event" && e.tool?.includes("run-ai"),
      );
  const postContinuationTests =
    verification.checks.find((c) => c.id === "declared_tests")?.outcome ??
    "unverified";
  const honestErrors =
    !verification.checks.some(
      (c) => c.id === "false_success" && c.outcome === "fail",
    ) &&
    !(
      pkg.execution.status === "succeeded" &&
      pkg.execution.agentLaunched === false &&
      !pkg.execution.events.some((e) => e.kind === "verified_event")
    );

  return {
    caseId: pkg.id,
    metrics: {
      contextReceived,
      remainingWorkUnderstood,
      unnecessaryRework,
      expectedOutputPresent: Boolean(expectedOutputPresent),
      postContinuationTests,
      honestErrors,
    },
    verification,
  };
}
