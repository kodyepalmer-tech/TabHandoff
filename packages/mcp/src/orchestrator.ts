import { runHandoff } from "@tabhandoff/runner";
import type { HandoffJob } from "@tabhandoff/protocol";
import { createJob, readJob, updateJob } from "./store.js";

const inflight = new Map<string, Promise<HandoffJob>>();

export async function createAndQueue(input: {
  url: string;
  instruction: string;
  note?: string;
  timeoutMs?: number;
}): Promise<HandoffJob> {
  const job = await createJob(input);
  // Fire and track — do not await completion for MCP create
  const run = executeJob(job.id, input.timeoutMs);
  inflight.set(job.id, run);
  void run.finally(() => inflight.delete(job.id));
  return job;
}

export async function createAndWait(input: {
  url: string;
  instruction: string;
  note?: string;
  timeoutMs?: number;
}): Promise<HandoffJob> {
  const job = await createJob(input);
  return executeJob(job.id, input.timeoutMs);
}

export async function getStatus(id: string): Promise<HandoffJob | null> {
  return readJob(id);
}

async function executeJob(id: string, timeoutMs?: number): Promise<HandoffJob> {
  const job = await readJob(id);
  if (!job) throw new Error(`Unknown handoff id: ${id}`);
  if (!job.receiptDir) throw new Error("Job missing receiptDir");
  if (!job.url) {
    throw new Error(
      "Job missing URL — isolated browser runner cannot execute file-only packages.",
    );
  }

  await updateJob(id, {
    status: "running",
    startedAt: new Date().toISOString(),
  });

  const result = await runHandoff({
    id,
    url: job.url,
    instruction: job.instruction,
    note: job.note,
    receiptDir: job.receiptDir,
    timeoutMs,
    onAction: async (action) => {
      const current = await readJob(id);
      if (!current) return;
      await updateJob(id, {
        actions: [...(current.actions ?? []), action],
      });
    },
  });

  return updateJob(id, {
    status: result.ok ? "succeeded" : "failed",
    finishedAt: new Date().toISOString(),
    resultSummary: result.resultSummary,
    error: result.error,
    actions: result.actions,
    screenshotPaths: result.screenshotPaths,
    receiptPath: result.receiptPath,
    cardPath: result.cardPath,
  });
}
