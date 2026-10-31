import type { AiProviderDeps } from "@tabhandoff/runner";
import {
  aiCompletionAvailableAsync,
  executeAiRun,
  type AiRunResponse,
} from "./ai-run.js";
import {
  continueHandoff,
  createFilePortableHandoff,
  createVerifiedHandoff,
  PortableError,
  readHandoffPackage,
} from "./portable.js";
import {
  verifyContinuation,
  type ContinuationVerificationReport,
} from "./verify-continuation.js";

export type TransferStepStatus = "done" | "failed" | "skipped" | "blocked";

export type TransferStep = {
  id: "create" | "continue" | "run_ai" | "verify";
  label: string;
  status: TransferStepStatus;
  detail?: string;
};

export type OneButtonTransferInput = {
  instruction: string;
  intendedOutcome?: string;
  url?: string;
  title?: string;
  selectedText?: string;
  /** Free-form note / context when there is no URL. */
  note?: string;
  /** Optional files already chosen by the user (desktop picker/drop). */
  files?: Array<{
    absolutePath: string;
    bytes: Buffer;
    displayPath?: string;
  }>;
  destinationAgent?: string;
  sourceAgent?: string;
  home?: string;
  /** Injected for tests — never required for the desktop happy path. */
  aiDeps?: AiProviderDeps;
};

export type OneButtonTransferResult = {
  ok: boolean;
  /**
   * Highest completed honest stage. `verified` only when Stage checks pass.
   * `blocked` means no local AI provider — never claimed as verified.
   */
  stage:
    | "created"
    | "continued"
    | "executed"
    | "verified"
    | "blocked"
    | "failed";
  plainStatus:
    | "verified"
    | "unverified"
    | "not_verified"
    | "blocked"
    | "failed";
  sourceId?: string;
  successorId?: string;
  verificationOutcome?: ContinuationVerificationReport["outcome"];
  verification?: ContinuationVerificationReport;
  aiResult?: string;
  aiProvider?: string | null;
  aiModel?: string | null;
  executionRecorded?: boolean;
  agentLaunched?: boolean;
  taskId?: string;
  message: string;
  steps: TransferStep[];
};

const DEFAULT_SOURCE = "desktop-transfer";
const DEFAULT_DEST = "desktop-run-ai";

function step(
  id: TransferStep["id"],
  label: string,
  status: TransferStepStatus,
  detail?: string,
): TransferStep {
  return { id, label, status, detail };
}

function plainFromVerification(
  outcome: ContinuationVerificationReport["outcome"] | undefined,
): OneButtonTransferResult["plainStatus"] {
  if (outcome === "pass") return "verified";
  if (outcome === "fail") return "not_verified";
  return "unverified";
}

function fileContextNote(
  files: NonNullable<OneButtonTransferInput["files"]>,
): string {
  const lines = files.map((f) => {
    const name = f.displayPath || f.absolutePath;
    const text = f.bytes.toString("utf8");
    const looksBinary = text.includes("\u0000");
    if (looksBinary) {
      return `File: ${name} (${f.bytes.length} bytes, binary — attached, not inlined)`;
    }
    const excerpt = text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text;
    return `File: ${name}\n${excerpt}`;
  });
  return lines.join("\n\n");
}

/**
 * One-button transfer: create package → continue to destination → run-ai →
 * verify-continuation (--require-continuation + --require-execution).
 *
 * Never claims verified unless Stage checks pass. Without a local AI provider,
 * returns `blocked` after an honest create (so the user still has a package).
 */
export async function transferAndRun(
  input: OneButtonTransferInput,
): Promise<OneButtonTransferResult> {
  const instruction = (input.instruction ?? "").trim();
  if (!instruction) {
    throw new PortableError(
      "Write a short instruction for the destination agent.",
      "invalid_input",
    );
  }

  const sourceAgent = (input.sourceAgent ?? DEFAULT_SOURCE).trim() || DEFAULT_SOURCE;
  const destinationAgent =
    (input.destinationAgent ?? DEFAULT_DEST).trim() || DEFAULT_DEST;
  const home = input.home;
  const steps: TransferStep[] = [];

  // --- 1. Create source package ---
  let sourceId: string;
  let pageText: string | undefined;
  let url = input.url?.trim() || undefined;
  let title = input.title?.trim() || undefined;
  let selectedText = input.selectedText?.trim() || undefined;

  try {
    if (input.files?.length) {
      const stored = await createFilePortableHandoff(
        {
          files: input.files,
          instruction,
          intendedOutcome: input.intendedOutcome?.trim() || undefined,
          source: { kind: "desktop", userAgent: "tabhandoff-desktop-transfer" },
        },
        { home },
      );
      sourceId = stored.id;
      pageText = fileContextNote(input.files);
      steps.push(
        step(
          "create",
          "Create package",
          "done",
          `File package ${sourceId.slice(0, 8)}… (package only so far)`,
        ),
      );
    } else {
      const note =
        input.note?.trim() ||
        (!url
          ? "Desktop one-button transfer — instruction-only task (no page URL)."
          : undefined);
      const stored = await createVerifiedHandoff({
        instruction,
        url,
        title,
        selectedText,
        note,
        intendedOutcome: input.intendedOutcome?.trim() || undefined,
        sourceIdentity: {
          name: sourceAgent,
          interface: "bridge",
          tool: "desktop.transfer",
        },
        destinationIdentity: {
          name: destinationAgent,
          interface: "bridge",
          tool: "tabhandoff.run-ai",
        },
        home,
      });
      sourceId = stored.id;
      pageText = selectedText || note;
      steps.push(
        step(
          "create",
          "Create package",
          "done",
          `Verified package ${sourceId.slice(0, 8)}… (package only so far)`,
        ),
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    steps.push(step("create", "Create package", "failed", message));
    return {
      ok: false,
      stage: "failed",
      plainStatus: "failed",
      message,
      steps,
    };
  }

  // --- Provider gate (honest block — do not fake run-ai) ---
  const providerReady = await aiCompletionAvailableAsync(
    input.aiDeps?.env ?? process.env,
    input.aiDeps,
  );
  if (!providerReady) {
    steps.push(
      step(
        "continue",
        "Hand off to destination",
        "skipped",
        "No destination run without a local AI provider.",
      ),
    );
    steps.push(
      step(
        "run_ai",
        "Run destination AI",
        "blocked",
        "No AI provider. Install Ollama (or set a local provider in Settings) and try Transfer again.",
      ),
    );
    steps.push(
      step(
        "verify",
        "Verify continuation",
        "skipped",
        "Verification skipped — destination AI did not run.",
      ),
    );
    return {
      ok: false,
      stage: "blocked",
      plainStatus: "blocked",
      sourceId,
      message:
        "Package created, but Transfer is blocked: no local AI provider is available. Install Ollama or configure a provider in Settings. This is not a verified handoff.",
      steps,
    };
  }

  // --- 2. Continue to destination ---
  let successorId: string;
  try {
    const continued = await continueHandoff({
      target: sourceId,
      destinationAgent,
      verified: true,
      destinationIdentity: {
        name: destinationAgent,
        interface: "bridge",
        tool: "tabhandoff.run-ai",
      },
      home,
    });
    successorId = continued.id;
    steps.push(
      step(
        "continue",
        "Hand off to destination",
        "done",
        `Successor ${successorId.slice(0, 8)}… (continue alone is not verified yet)`,
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    steps.push(step("continue", "Hand off to destination", "failed", message));
    steps.push(step("run_ai", "Run destination AI", "skipped"));
    steps.push(step("verify", "Verify continuation", "skipped"));
    return {
      ok: false,
      stage: "created",
      plainStatus: "failed",
      sourceId,
      message: `Package created, but handoff to destination failed: ${message}`,
      steps,
    };
  }

  // --- 3. Destination run-ai ---
  let ai: AiRunResponse;
  try {
    const { package: srcPkg } = await readHandoffPackage(sourceId, { home });
    const contextFromPkg =
      srcPkg.page?.selectedText ||
      srcPkg.sources
        ?.map((s) =>
          s.type === "note"
            ? s.text
            : s.type === "file"
              ? s.textExcerpt || `${s.filename} (${s.contentStatus})`
              : "",
        )
        .filter(Boolean)
        .join("\n\n");
    ai = await executeAiRun(
      {
        instruction,
        url: url || srcPkg.page?.url,
        title: title || srcPkg.page?.title,
        selectedText: selectedText || srcPkg.page?.selectedText,
        pageText: pageText || contextFromPkg || instruction,
        handoffId: successorId,
      },
      { home, deps: input.aiDeps },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    steps.push(step("run_ai", "Run destination AI", "failed", message));
    steps.push(step("verify", "Verify continuation", "skipped"));
    return {
      ok: false,
      stage: "continued",
      plainStatus: "failed",
      sourceId,
      successorId,
      message: `Destination handoff created, but AI run failed: ${message}`,
      steps,
    };
  }

  if (!ai.ok || !ai.executionRecorded) {
    const detail = !ai.ok
      ? ai.message || ai.error || "AI run did not succeed."
      : "AI returned a result, but no run-ai verified_event was recorded into the package — execution is NOT claimed.";
    steps.push(step("run_ai", "Run destination AI", "failed", detail));
    steps.push(
      step(
        "verify",
        "Verify continuation",
        "skipped",
        "Skipped because destination execution was not recorded.",
      ),
    );
    return {
      ok: false,
      stage: "continued",
      plainStatus: "not_verified",
      sourceId,
      successorId,
      aiResult: ai.result || undefined,
      aiProvider: ai.provider,
      aiModel: ai.model,
      executionRecorded: Boolean(ai.executionRecorded),
      agentLaunched: false,
      taskId: ai.taskId,
      message: detail,
      steps,
    };
  }

  steps.push(
    step(
      "run_ai",
      "Run destination AI",
      "done",
      `${ai.provider ?? "provider"} / ${ai.model ?? "model"} — execution recorded`,
    ),
  );

  // --- 4. Independent verify (continuation + execution) ---
  let verification: ContinuationVerificationReport;
  try {
    verification = await verifyContinuation(successorId, {
      home,
      previousPath: sourceId,
      requireContinuation: true,
      requireDestinationExecution: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    steps.push(step("verify", "Verify continuation", "failed", message));
    return {
      ok: false,
      stage: "executed",
      plainStatus: "unverified",
      sourceId,
      successorId,
      aiResult: ai.result,
      aiProvider: ai.provider,
      aiModel: ai.model,
      executionRecorded: true,
      agentLaunched: true,
      taskId: ai.taskId,
      message: `Destination ran, but verification could not finish: ${message}`,
      steps,
    };
  }

  const plainStatus = plainFromVerification(verification.outcome);
  const verified = verification.outcome === "pass";
  steps.push(
    step(
      "verify",
      "Verify continuation",
      verified ? "done" : "failed",
      `outcome=${verification.outcome}; checks=${verification.checks
        .map((c) => `${c.id}:${c.outcome}`)
        .join(", ")}`,
    ),
  );

  return {
    ok: verified,
    stage: verified ? "verified" : "executed",
    plainStatus,
    sourceId,
    successorId,
    verificationOutcome: verification.outcome,
    verification,
    aiResult: ai.result,
    aiProvider: ai.provider,
    aiModel: ai.model,
    executionRecorded: true,
    agentLaunched: true,
    taskId: ai.taskId,
    message: verified
      ? "Transfer verified: destination AI ran and Stage checks passed."
      : `Destination AI ran, but verification outcome is ${verification.outcome} — not claiming verified.`,
    steps,
  };
}
