import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  HandoffJob,
  PortableHandoffPackage,
  PortableExecutionStatus,
} from "@tabhandoff/protocol";
import {
  closeSharedBrowser,
  detectLlmProvider,
  runHandoff,
  type RunHandoffResult,
} from "@tabhandoff/runner";
import { probeBridgeCapabilities } from "./capabilities.js";
import { jobsDir, receiptsDir, tabHandoffHome } from "./home.js";
import {
  packageForDisk,
  renderSummaryMarkdown,
  renderTaskCardYaml,
} from "./package.js";

export type LiveHandoffStatus = {
  id: string;
  ok: true;
  executionStatus: PortableExecutionStatus | "package_created";
  jobStatus: HandoffJob["status"];
  agentLaunched: boolean;
  workflowStarted: boolean;
  mode?: "dom" | "llm";
  workflow?: PortableHandoffPackage["execution"]["workflow"];
  workflowLabel?: string;
  resultSummary?: string;
  error?: string;
  receiptDir: string;
  screenshotCount: number;
  message: string;
  events: PortableHandoffPackage["execution"]["events"];
};

const inflight = new Map<string, Promise<void>>();

function logLine(msg: string): void {
  console.log(`[tabhandoff-bridge ${new Date().toISOString()}] ${msg}`);
}

function workflowMeta(mode: "dom" | "llm"): {
  workflow: "page_extraction" | "llm_browser";
  workflowLabel: string;
  agentLaunched: boolean;
} {
  if (mode === "llm") {
    return {
      workflow: "llm_browser",
      workflowLabel: "Model-assisted isolated browser",
      agentLaunched: true,
    };
  }
  return {
    workflow: "page_extraction",
    workflowLabel: "Page extraction (deterministic DOM — not autonomous AI)",
    agentLaunched: false,
  };
}

async function readHandoffJson(
  receiptDir: string,
): Promise<PortableHandoffPackage | null> {
  try {
    const raw = await readFile(path.join(receiptDir, "handoff.json"), "utf8");
    return JSON.parse(raw) as PortableHandoffPackage;
  } catch {
    return null;
  }
}

async function writeJob(home: string, job: HandoffJob): Promise<void> {
  const p = path.join(jobsDir(home), `${job.id}.json`);
  await writeFile(p, JSON.stringify(job, null, 2), "utf8");
  if (job.receiptDir) {
    await writeFile(
      path.join(job.receiptDir, "job.json"),
      JSON.stringify(job, null, 2),
      "utf8",
    );
  }
}

async function readJob(home: string, id: string): Promise<HandoffJob | null> {
  try {
    const raw = await readFile(path.join(jobsDir(home), `${id}.json`), "utf8");
    return JSON.parse(raw) as HandoffJob;
  } catch {
    return null;
  }
}

function honestMessage(opts: {
  status: PortableExecutionStatus | "package_created";
  mode?: "dom" | "llm";
  workflowStarted: boolean;
  error?: string;
}): string {
  if (!opts.workflowStarted && opts.status === "package_created") {
    return "Package created and saved locally. No workflow was started.";
  }
  if (opts.status === "queued" || opts.status === "running") {
    return opts.mode === "llm"
      ? "Model-assisted browser steps are running in an isolated Chromium…"
      : "Page extraction is running in an isolated Chromium…";
  }
  if (opts.status === "succeeded") {
    return opts.mode === "llm"
      ? "Model-assisted browser steps finished. Review the receipt and screenshots in My Activity."
      : "Page extraction finished (deterministic DOM — not autonomous AI). Review evidence in My Activity.";
  }
  if (opts.status === "failed") {
    return `Workflow failed: ${opts.error || "unknown error"}. The package and any partial evidence were kept.`;
  }
  return `Status: ${opts.status}`;
}

/**
 * Persist execution progress into handoff.json + jobs without inventing history.
 */
export async function patchHandoffExecution(
  home: string,
  id: string,
  patch: {
    status: PortableExecutionStatus;
    mode?: "dom" | "llm";
    workflow?: PortableHandoffPackage["execution"]["workflow"];
    workflowLabel?: string;
    agentLaunched: boolean;
    events?: PortableHandoffPackage["execution"]["events"];
    previousResults?: string[];
    remainingWork?: string[];
    resultSummary?: string;
    error?: string;
    screenshotPaths?: string[];
    startedAt?: string;
    finishedAt?: string;
  },
): Promise<void> {
  const receiptDir = path.join(receiptsDir(home), id);
  const pkg = await readHandoffJson(receiptDir);
  if (!pkg) return;

  const events = patch.events ?? pkg.execution.events;
  const next: PortableHandoffPackage = {
    ...pkg,
    previousResults: patch.previousResults ?? pkg.previousResults,
    remainingWork: patch.remainingWork ?? pkg.remainingWork,
    execution: {
      ...pkg.execution,
      status: patch.status,
      agentLaunched: patch.agentLaunched,
      events,
      mode: patch.mode ?? pkg.execution.mode,
      workflow: patch.workflow ?? pkg.execution.workflow,
      workflowLabel: patch.workflowLabel ?? pkg.execution.workflowLabel,
    },
  };

  const onDisk = packageForDisk(next);
  const summary = renderSummaryMarkdown(onDisk);
  await writeFile(path.join(receiptDir, "handoff.json"), JSON.stringify(onDisk, null, 2), "utf8");
  await writeFile(path.join(receiptDir, "summary.md"), summary, "utf8");
  // Prefer runner receipt.md when present after success; otherwise keep summary
  if (patch.status === "queued" || patch.status === "running" || !patch.resultSummary) {
    await writeFile(path.join(receiptDir, "receipt.md"), summary, "utf8");
  }
  await writeFile(path.join(receiptDir, "card.yaml"), renderTaskCardYaml(onDisk), "utf8");

  const job = (await readJob(home, id)) ?? {
    id,
    url: pkg.page.url,
    instruction: pkg.instruction,
    status: "queued" as const,
    createdAt: pkg.capturedAt,
    updatedAt: new Date().toISOString(),
    actions: [],
    screenshotPaths: [],
    receiptDir,
  };

  const jobStatus: HandoffJob["status"] =
    patch.status === "package_created"
      ? "package_created"
      : patch.status === "awaiting_input"
        ? "queued"
        : (patch.status as HandoffJob["status"]);

  await writeJob(home, {
    ...job,
    status: jobStatus,
    startedAt: patch.startedAt ?? job.startedAt,
    finishedAt: patch.finishedAt ?? job.finishedAt,
    resultSummary: patch.resultSummary ?? job.resultSummary,
    error: patch.error,
    actions: events.map((e) => ({
      at: e.at,
      tool: e.tool ?? "bridge",
      detail: e.detail,
      ok: e.ok ?? true,
    })),
    screenshotPaths: patch.screenshotPaths ?? job.screenshotPaths,
    receiptDir,
    receiptPath: path.join(receiptDir, "receipt.md"),
    cardPath: path.join(receiptDir, "card.yaml"),
    note:
      patch.mode === "dom"
        ? "Page extraction (DOM) — not autonomous AI completion."
        : patch.mode === "llm"
          ? "Model-assisted isolated browser run."
          : job.note,
    updatedAt: new Date().toISOString(),
  });
}

export async function getLiveHandoffStatus(
  homeInput: string | undefined,
  id: string,
): Promise<LiveHandoffStatus | null> {
  const home = tabHandoffHome(homeInput);
  const receiptDir = path.join(receiptsDir(home), id);
  const pkg = await readHandoffJson(receiptDir);
  const job = await readJob(home, id);
  if (!pkg && !job) return null;

  const executionStatus =
    pkg?.execution.status ??
    (job?.status === "queued" || job?.status === "package_created"
      ? "package_created"
      : job?.status) ??
    "package_created";
  const mode = pkg?.execution.mode;
  const workflowStarted =
    Boolean(pkg?.execution.workflow && pkg.execution.workflow !== "none") ||
    Boolean(
      job &&
        job.status !== "queued" &&
        job.status !== "package_created",
    ) ||
    inflight.has(id);

  return {
    id,
    ok: true,
    executionStatus,
    jobStatus: job?.status ?? "package_created",
    agentLaunched: pkg?.execution.agentLaunched ?? false,
    workflowStarted,
    mode,
    workflow: pkg?.execution.workflow,
    workflowLabel: pkg?.execution.workflowLabel,
    resultSummary: job?.resultSummary,
    error: job?.error,
    receiptDir,
    screenshotCount: job?.screenshotPaths?.length ?? pkg?.screenshots.length ?? 0,
    message: honestMessage({
      status: executionStatus,
      mode,
      workflowStarted,
      error: job?.error,
    }),
    events: pkg?.execution.events ?? [],
  };
}

/**
 * Start a supported workflow for an already-stored package.
 * Returns immediately; poll getLiveHandoffStatus for progress.
 */
export async function startSupportedWorkflow(options: {
  home?: string;
  id: string;
  url: string;
  instruction: string;
  note?: string;
  timeoutMs?: number;
  /** Inject runner for tests */
  runner?: typeof runHandoff;
}): Promise<{ started: boolean; reason?: string; status: LiveHandoffStatus }> {
  const home = tabHandoffHome(options.home);
  const caps = await probeBridgeCapabilities();

  if (!caps.pageExtraction) {
    const status = (await getLiveHandoffStatus(home, options.id))!;
    return {
      started: false,
      reason: "playwright_unavailable",
      status: {
        ...status,
        message:
          "Package saved. No supported workflow could run (Playwright/Chromium missing).",
      },
    };
  }

  if (inflight.has(options.id)) {
    const status = (await getLiveHandoffStatus(home, options.id))!;
    return { started: true, status };
  }

  const preferredMode: "dom" | "llm" = caps.llmAgent ? "llm" : "dom";
  const meta = workflowMeta(preferredMode);
  // Actual mode comes from runner result; announce intended path honestly
  const intendedLabel =
    preferredMode === "llm"
      ? meta.workflowLabel
      : "Page extraction (deterministic DOM — not autonomous AI)";

  const startedAt = new Date().toISOString();
  const startEvent = {
    at: startedAt,
    kind: "verified_event" as const,
    tool: "bridge.workflow",
    detail: `Starting supported workflow: ${intendedLabel}`,
    ok: true,
  };

  const existing = await readHandoffJson(path.join(receiptsDir(home), options.id));
  const priorEvents = existing?.execution.events ?? [];

  await patchHandoffExecution(home, options.id, {
    status: "running",
    mode: preferredMode === "llm" ? undefined : "dom",
    workflow: preferredMode === "llm" ? "llm_browser" : "page_extraction",
    workflowLabel: intendedLabel,
    agentLaunched: preferredMode === "llm",
    events: [...priorEvents, startEvent],
    remainingWork: ["Finish the supported workflow and record results."],
    startedAt,
  });

  const run = (async () => {
    try {
      const runner = options.runner ?? runHandoff;
      const receiptDir = path.join(receiptsDir(home), options.id);
      const result: RunHandoffResult = await runner({
        id: options.id,
        url: options.url,
        instruction: options.instruction,
        note:
          options.note ??
          (detectLlmProvider()
            ? "Isolated browser run from TabHandoff bridge."
            : "Page extraction from TabHandoff bridge (DOM — not autonomous AI)."),
        receiptDir,
        timeoutMs: options.timeoutMs,
      });

      const finishedAt = new Date().toISOString();
      const metaDone = workflowMeta(result.mode);
      const pkgNow = await readHandoffJson(receiptDir);
      const baseEvents = pkgNow?.execution.events ?? [...priorEvents, startEvent];
      const runEvents = result.actions.map((a) => ({
        at: a.at,
        kind: "verified_event" as const,
        tool: a.tool,
        detail: a.detail,
        ok: a.ok,
      }));

      const resultEvent = {
        at: finishedAt,
        kind: "agent_reported" as const,
        tool: result.mode === "dom" ? "page_extraction" : "llm_browser",
        detail:
          result.mode === "dom"
            ? `Page extraction ${result.ok ? "completed" : "failed"} (DOM — not autonomous AI).`
            : `Model-assisted browser ${result.ok ? "completed" : "failed"}.`,
        ok: result.ok,
      };

      await patchHandoffExecution(home, options.id, {
        status: result.ok ? "succeeded" : "failed",
        mode: result.mode,
        workflow: metaDone.workflow,
        workflowLabel: metaDone.workflowLabel,
        agentLaunched: metaDone.agentLaunched,
        events: [...baseEvents, ...runEvents, resultEvent],
        previousResults: result.ok
          ? [result.resultSummary.slice(0, 2000)]
          : [],
        remainingWork: result.ok
          ? []
          : ["Retry page extraction or continue manually from the package."],
        resultSummary: result.resultSummary,
        error: result.error,
        screenshotPaths: result.screenshotPaths,
        finishedAt,
      });

      // Re-sync handoff summary after runner overwrote receipt.md
      const finalPkg = await readHandoffJson(receiptDir);
      if (finalPkg) {
        const onDisk = packageForDisk(finalPkg);
        await writeFile(
          path.join(receiptDir, "summary.md"),
          renderSummaryMarkdown(onDisk),
          "utf8",
        );
        await writeFile(
          path.join(receiptDir, "handoff.json"),
          JSON.stringify(onDisk, null, 2),
          "utf8",
        );
      }

      logLine(
        `workflow id=${options.id} ok=${result.ok} mode=${result.mode}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logLine(`workflow id=${options.id} error=${(err as Error).name}`);
      const finishedAt = new Date().toISOString();
      const pkgNow = await readHandoffJson(
        path.join(receiptsDir(home), options.id),
      );
      await patchHandoffExecution(home, options.id, {
        status: "failed",
        workflow: "page_extraction",
        workflowLabel: "Page extraction (failed to start)",
        agentLaunched: false,
        events: [
          ...(pkgNow?.execution.events ?? []),
          {
            at: finishedAt,
            kind: "verified_event",
            tool: "bridge.workflow",
            detail: `Workflow could not finish: ${message}`,
            ok: false,
          },
        ],
        remainingWork: [
          "Package remains available — continue manually or fix runner setup.",
        ],
        error: message,
        finishedAt,
      });
    } finally {
      inflight.delete(options.id);
      await closeSharedBrowser().catch(() => undefined);
    }
  })();

  inflight.set(options.id, run);
  void run;

  const status = (await getLiveHandoffStatus(home, options.id))!;
  return { started: true, status };
}

export function workflowInflightCount(): number {
  return inflight.size;
}
