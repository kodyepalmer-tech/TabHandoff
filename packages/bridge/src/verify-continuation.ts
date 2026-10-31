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
    /**
     * Require corroborated destination continuation (see destination_continuation
     * check). This is a LOWER bar than --require-execution: it proves the
     * destination did meaningful work on the task, not that it ran an AI model.
     * It never, by itself, claims AI execution happened.
     */
    requireContinuation?: boolean;
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

  // 7. Destination continuation vs destination execution — two different bars.
  //
  // Stage 0 — Import: validate + chain + context only. Importing, reading, or
  // creating a successor (agent.continue) is NEVER continuation or execution.
  //
  // Stage 1 — Continuation (--require-continuation): the destination did
  // meaningful work on the task. It must be CORROBORATED, not just asserted
  // in a progress message. Corroboration is at least one of, compared with
  // the previous package when --previous is given, otherwise checked inside
  // the successor package:
  //   - a new previousResults line beyond the automatic "Continued from..." line
  //   - remainingWork changed (not a verbatim copy)
  //   - a declared test moved from not_run/unverified to pass or fail
  //   - a new attached artifact that passes SHA integrity
  // A progress event with detail text alone, with none of the above, FAILS
  // --require-continuation. That is the false-positive guard: writing
  // "I did work" is not work.
  //
  // Stage 2 — Execution (--require-execution, UNCHANGED strictness, tightened
  // here): a model-assisted destination execution actually ran. It requires
  // ALL of: agentLaunched === true, a verified_event whose tool contains
  // "run-ai" (or execution workflow llm_browser / mode llm), ok === true,
  // and a result (new previousResults line). A progress event that merely
  // MENTIONS run-ai in its detail, with agentLaunched false and no llm
  // workflow, FAILS. CLI progress can never set agentLaunched, workflow, or
  // mode, so it can never fabricate execution through this path.
  //
  // Stage 3 — Independent verification: this report itself, run with
  // --previous, chain hash, and artifact integrity. It checks package
  // honesty, not model quality, and SHA integrity does not prove an event
  // occurred — it only proves artifacts were not altered after packaging.
  // Corroboration is evidence that can be audited against the destination
  // branch/files, not cryptographic proof of work.

  // Load the previous package once for corroboration comparison, if given.
  let prevPkg: PortableHandoffPackage | null = null;
  if (options?.previousPath) {
    try {
      prevPkg = (await readHandoffPackage(options.previousPath, {
        home: options?.home,
      })).package;
    } catch {
      prevPkg = null;
    }
  }

  const continueIdx = pkg.execution.events.findIndex(
    (e) => e.tool === "agent.continue",
  );
  const postContinueEvents =
    continueIdx >= 0
      ? pkg.execution.events.slice(continueIdx + 1)
      : pkg.previousHandoffId
        ? []
        : pkg.execution.events;
  const postContinueWorkEvents = postContinueEvents.filter(
    (e) =>
      (e.kind === "verified_event" || e.kind === "agent_reported") &&
      Boolean(e.detail?.trim()),
  );

  const autoContinueLine = (r: string) =>
    r.startsWith("Continued from handoff ");
  const prevResults = prevPkg?.previousResults ?? [];
  const newResultLines = pkg.previousResults.filter(
    (r) => !autoContinueLine(r) && !prevResults.includes(r),
  );
  // Without a previous package, a successor always carries the previous
  // results forward, so a bare count cannot prove a new result. In that
  // case only artifact/test/remaining evidence counts, and the check is
  // unverified unless --previous was given for the result-line path.
  const remainingChanged =
    prevPkg !== null &&
    JSON.stringify(pkg.remainingWork) !==
      JSON.stringify(prevPkg.remainingWork);
  const testResultsChanged = (pkg.tests ?? []).some(
    (t) => t.result === "pass" || t.result === "fail",
  );
  const artifactChanged =
    integrity.checked > 0 && integrity.ok && pkg.screenshots.length > 0
      ? prevPkg === null
        ? true
        : pkg.screenshots.some(
            (s) =>
              !prevPkg!.screenshots.some((p) => p.filename === s.filename),
          )
      : false;
  // Artifact evidence only counts if there is actually a new artifact
  // compared with the previous package, or, when no previous is given, if
  // the successor carries artifacts at all and integrity passed.
  const corroborationTypes: string[] = [];
  if (newResultLines.length > 0 && prevPkg !== null)
    corroborationTypes.push(`newResultLines=${newResultLines.length}`);
  if (remainingChanged) corroborationTypes.push("remainingWorkChanged");
  if (testResultsChanged) corroborationTypes.push("testResultPassOrFail");
  if (artifactChanged) corroborationTypes.push("newArtifactIntegrityOk");
  const corroborated = corroborationTypes.length > 0;
  const linked =
    Boolean(pkg.previousHandoffId) &&
    (prevPkg === null || prevPkg.id === pkg.previousHandoffId);
  const continuationPass =
    linked &&
    postContinueWorkEvents.length > 0 &&
    corroborated;

  checks.push({
    id: "destination_continuation",
    name: "Destination continued work (corroborated, not import-only)",
    outcome: options?.requireContinuation
      ? continuationPass
        ? "pass"
        : "fail"
      : continuationPass
        ? "pass"
        : "unverified",
    detail: !pkg.previousHandoffId
      ? "No previousHandoffId — this is a source package, not a continuation."
      : !linked
        ? "previousHandoffId does not match the provided previous package."
        : postContinueWorkEvents.length === 0
          ? "No post-continue destination work event. Import / continue alone is not continuation."
          : !corroborated
            ? "Post-continue event present, but no corroboration: no new result line, remainingWork change, test pass/fail, or new artifact. Progress text alone does not pass."
            : `Corroborated by: ${corroborationTypes.join(", ")}; post-continue events=${postContinueWorkEvents.length}. This proves continuation, NOT AI execution.`,
  });
  if (options?.requireContinuation && prevPkg === null) {
    limitations.push(
      "Continuation result-line corroboration requires --previous <path>; without it, result lines alone cannot be distinguished from carried-forward results.",
    );
  }

  // Destination execution — strict, preserved, and tightened.
  const destEvents = pkg.execution.events.filter(
    (e) =>
      e.kind === "verified_event" &&
      (e.tool?.includes("agent-b") ||
        e.tool?.includes("destination") ||
        e.tool?.includes("run-ai") ||
        e.tool?.includes("continuation") ||
        e.tool === "agent.continue"),
  );
  const executionEvents = pkg.execution.events.filter(
    (e) =>
      e.kind === "verified_event" &&
      e.tool?.includes("run-ai") &&
      e.ok === true,
  );
  const executionPass =
    pkg.execution.agentLaunched === true &&
    (pkg.execution.workflow === "llm_browser" ||
      pkg.execution.mode === "llm" ||
      executionEvents.length > 0) &&
    executionEvents.length > 0 &&
    newResultLines.length > 0;
  // For execution, newResultLines must be checked against the previous
  // package when available; when no previous is given, a run-ai event with
  // a result is still required, and the result line is the event's own
  // previousResults addition — approximate by requiring at least one
  // non-auto previousResults entry. That approximation is only used when
  // --previous was not supplied, and is noted in limitations.
  const executionPassNoPrev =
    prevPkg === null &&
    pkg.execution.agentLaunched === true &&
    executionEvents.length > 0 &&
    pkg.previousResults.some((r) => !autoContinueLine(r));
  if (options?.requireDestinationExecution) {
    if (executionPass || executionPassNoPrev) {
      checks.push({
        id: "destination_execution",
        name: "Destination AI execution (not prompt-only, not progress-only)",
        outcome: "pass",
        detail: `run-ai verified_event(s)=${executionEvents.length}; agentLaunched=true; workflow=${pkg.execution.workflow ?? "n/a"}; mode=${pkg.execution.mode ?? "n/a"}. Continuation also required separately — see destination_continuation.`,
      });
    } else {
      checks.push({
        id: "destination_execution",
        name: "Destination AI execution (not prompt-only, not progress-only)",
        outcome: "fail",
        detail:
          pkg.execution.agentLaunched !== true
            ? "No AI execution: agentLaunched is not true. A progress message mentioning run-ai, without a system-recorded run-ai event and agentLaunched=true, does not count."
            : executionEvents.length === 0
              ? "No verified run-ai event with ok=true. Progress events (agent.progress) do not count as execution."
              : "Run-ai event present, but no corroborating result line. Execution without an output does not pass.",
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

  // Overall outcome reflects the modes actually requested, not every
  // informational check. Without any --require-* flag, the old behaviour
  // is preserved: an unverified informational check keeps the overall
  // result unverified, so a bare verify never claims a pass.
  // With --require-continuation only, destination_execution (unverified,
  // because execution was not requested) does not block a continuation
  // pass. With --require-execution, destination_continuation is also a
  // gate, because execution should imply continuation.
  const gatedChecks =
    options?.requireContinuation || options?.requireDestinationExecution
      ? checks.filter((c) => {
          if (c.id === "destination_continuation")
            return Boolean(
              options?.requireContinuation ||
                options?.requireDestinationExecution,
            );
          if (c.id === "destination_execution")
            return Boolean(options?.requireDestinationExecution);
          return true;
        })
      : checks;
  const outcome = overallOutcome(gatedChecks);
  if (options?.requireContinuation && !options?.requireDestinationExecution) {
    limitations.push(
      "Overall outcome in --require-continuation mode reflects continuation and base checks only; it does not claim AI execution. Run --require-execution separately for that claim.",
    );
  }
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
