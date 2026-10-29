import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { HandoffJob } from "@tabhandoff/protocol";
import { jobsDir, receiptsDir } from "./home.js";

async function ensureDirs(): Promise<void> {
  await mkdir(jobsDir(), { recursive: true });
  await mkdir(receiptsDir(), { recursive: true });
}

function jobPath(id: string): string {
  return path.join(jobsDir(), `${id}.json`);
}

export async function createJob(input: {
  url: string;
  instruction: string;
  note?: string;
}): Promise<HandoffJob> {
  await ensureDirs();
  const id = randomUUID();
  const now = new Date().toISOString();
  const receiptDir = path.join(receiptsDir(), id);
  await mkdir(receiptDir, { recursive: true });

  const job: HandoffJob = {
    id,
    url: input.url,
    instruction: input.instruction,
    note: input.note,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    actions: [],
    screenshotPaths: [],
    receiptDir,
  };
  await writeFile(jobPath(id), JSON.stringify(job, null, 2), "utf8");
  return job;
}

export async function readJob(id: string): Promise<HandoffJob | null> {
  try {
    const raw = await readFile(jobPath(id), "utf8");
    return JSON.parse(raw) as HandoffJob;
  } catch {
    return null;
  }
}

/** Serialize per-id writes so concurrent action + final status updates cannot race. */
const updateChains = new Map<string, Promise<unknown>>();

export async function updateJob(
  id: string,
  patch: Partial<HandoffJob>,
): Promise<HandoffJob> {
  const prev = updateChains.get(id) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const chained = prev.then(() => gate);
  updateChains.set(id, chained);

  try {
    await prev.catch(() => undefined);
    const current = await readJob(id);
    if (!current) throw new Error(`Unknown handoff id: ${id}`);
    const next: HandoffJob = {
      ...current,
      ...patch,
      id: current.id,
      updatedAt: new Date().toISOString(),
    };
    await writeFile(jobPath(id), JSON.stringify(next, null, 2), "utf8");
    return next;
  } finally {
    release();
    if (updateChains.get(id) === chained) updateChains.delete(id);
  }
}

export async function listJobs(limit = 20): Promise<HandoffJob[]> {
  await ensureDirs();
  const files = (await readdir(jobsDir())).filter((f) => f.endsWith(".json"));
  const jobs: HandoffJob[] = [];
  for (const f of files) {
    try {
      const raw = await readFile(path.join(jobsDir(), f), "utf8");
      jobs.push(JSON.parse(raw) as HandoffJob);
    } catch {
      /* skip corrupt */
    }
  }
  return jobs
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}
