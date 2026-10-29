import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { HandoffAction, HandoffJob, HandoffStatus } from "@tabhandoff/protocol";
import { jobsDir, receiptsDir, tabHandoffHome } from "./home.js";
import {
  asStatus,
  hostnameOf,
  parseCardYaml,
  parseReceiptMarkdown,
  safeJsonParse,
} from "./parse.js";
import {
  UNTRUSTED_CONTENT_WARNING,
  type ActivityRecord,
  type IndexResult,
  type ReceiptJobSnapshot,
  type TimelineEvent,
} from "./types.js";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function listScreenshotFiles(receiptDir: string): Promise<string[]> {
  const dir = path.join(receiptDir, "screenshots");
  if (!(await exists(dir))) return [];
  const names = await readdir(dir);
  return names
    .filter((n) => /\.(png|jpe?g|webp|gif)$/i.test(n))
    .sort()
    .map((n) => path.join(dir, n));
}

function resolveShotPaths(
  receiptDir: string,
  candidates: string[],
  onDisk: string[],
): string[] {
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const base = path.basename(c);
    const local = path.join(receiptDir, "screenshots", base);
    const pick = onDisk.includes(local) ? local : onDisk.find((p) => path.basename(p) === base) ?? c;
    if (!seen.has(pick)) {
      seen.add(pick);
      resolved.push(pick);
    }
  }
  for (const p of onDisk) {
    if (!seen.has(p)) {
      seen.add(p);
      resolved.push(p);
    }
  }
  return resolved;
}

function buildTimeline(
  actions: HandoffAction[],
  resultSummary?: string,
  error?: string,
): TimelineEvent[] {
  const events: TimelineEvent[] = actions.map((a) => ({
    at: a.at,
    kind: "verified_event" as const,
    tool: a.tool,
    detail: a.detail,
    ok: a.ok,
  }));
  if (resultSummary?.trim()) {
    events.push({
      at: actions.at(-1)?.at ?? new Date().toISOString(),
      kind: "agent_reported",
      tool: "result",
      detail: resultSummary.slice(0, 500),
      ok: !error,
    });
  }
  if (error?.trim()) {
    events.push({
      at: actions.at(-1)?.at ?? new Date().toISOString(),
      kind: "agent_reported",
      tool: "error",
      detail: error,
      ok: false,
    });
  }
  // Suggestions are never invented at index time (Phase 4 / agents may append).
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

async function loadStoreJob(
  home: string,
  id: string,
): Promise<{ job: HandoffJob | null; path: string; note?: string }> {
  const p = path.join(jobsDir(home), `${id}.json`);
  if (!(await exists(p))) return { job: null, path: p };
  const raw = await readFile(p, "utf8");
  const job = safeJsonParse<HandoffJob>(raw);
  if (!job) return { job: null, path: p, note: `Corrupt store job JSON: ${p}` };
  return { job, path: p };
}

/**
 * Import/index local evidence. Never writes into receipts/ or jobs/ (preserve history).
 */
export async function indexReceipts(options?: {
  home?: string;
}): Promise<IndexResult> {
  const home = tabHandoffHome(options?.home);
  const jDir = jobsDir(home);
  const rDir = receiptsDir(home);
  const skipped: string[] = [];
  const byId = new Map<string, ActivityRecord>();

  const jobIds = new Set<string>();
  if (await exists(jDir)) {
    for (const f of await readdir(jDir)) {
      if (f.endsWith(".json")) jobIds.add(f.replace(/\.json$/, ""));
    }
  }

  const receiptIds = new Set<string>();
  if (await exists(rDir)) {
    for (const name of await readdir(rDir)) {
      const full = path.join(rDir, name);
      try {
        const st = await stat(full);
        if (st.isDirectory()) receiptIds.add(name);
      } catch {
        skipped.push(full);
      }
    }
  }

  const ids = new Set([...jobIds, ...receiptIds]);

  for (const id of ids) {
    try {
      const record = await buildRecord(home, id);
      if (record) byId.set(id, record);
      else skipped.push(id);
    } catch (err) {
      skipped.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const records = [...byId.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  return {
    home,
    jobsDir: jDir,
    receiptsDir: rDir,
    records,
    importedCount: records.length,
    partialCount: records.filter((r) => r.partial).length,
    skipped,
  };
}

async function buildRecord(home: string, id: string): Promise<ActivityRecord | null> {
  const indexNotes: string[] = [];
  const receiptDir = path.join(receiptsDir(home), id);
  const { job: storeJob, path: storeJobPath, note } = await loadStoreJob(home, id);
  if (note) indexNotes.push(note);

  const receiptPath = path.join(receiptDir, "receipt.md");
  const cardPath = path.join(receiptDir, "card.yaml");
  const receiptJobPath = path.join(receiptDir, "job.json");

  let receiptMd: string | undefined;
  let receiptParsed: ReturnType<typeof parseReceiptMarkdown> | undefined;
  if (await exists(receiptPath)) {
    receiptMd = await readFile(receiptPath, "utf8");
    receiptParsed = parseReceiptMarkdown(receiptMd);
  } else if (await exists(receiptDir)) {
    indexNotes.push("Missing receipt.md");
  }

  let snap: ReceiptJobSnapshot | null = null;
  if (await exists(receiptJobPath)) {
    snap = safeJsonParse<ReceiptJobSnapshot>(await readFile(receiptJobPath, "utf8"));
    if (!snap) indexNotes.push("Corrupt receipt job.json");
  }

  const handoffPath = path.join(receiptDir, "handoff.json");
  let portableStatus: string | undefined;
  let handoffPageUrl: string | undefined;
  let handoffPageTitle: string | undefined;
  let handoffInstruction: string | undefined;
  let handoffFileSources: ActivityRecord["fileSources"] = [];
  if (await exists(handoffPath)) {
    const handoff = safeJsonParse<{
      execution?: { status?: string };
      page?: { title?: string; url?: string; selectedText?: string };
      instruction?: string;
      sources?: Array<{
        type?: string;
        filename?: string;
        displayPath?: string;
        mediaType?: string;
        byteSize?: number;
        sha256?: string;
        contentStatus?: "excerpted" | "attached_not_analyzed";
        artifactFilename?: string;
        textExcerpt?: string;
      }>;
    }>(await readFile(handoffPath, "utf8"));
    portableStatus = handoff?.execution?.status;
    handoffPageUrl = handoff?.page?.url;
    handoffPageTitle = handoff?.page?.title;
    handoffInstruction = handoff?.instruction;
    handoffFileSources = (handoff?.sources ?? [])
      .filter((s) => s?.type === "file" && s.filename)
      .map((s) => ({
        filename: s.filename!,
        displayPath: s.displayPath,
        mediaType: s.mediaType,
        byteSize: s.byteSize,
        sha256: s.sha256,
        contentStatus: s.contentStatus,
        artifactFilename: s.artifactFilename,
        textExcerpt: s.textExcerpt,
      }));
  }

  let card = undefined as ReturnType<typeof parseCardYaml> | undefined;
  if (await exists(cardPath)) {
    card = parseCardYaml(await readFile(cardPath, "utf8"));
  }

  const onDiskShots = (await exists(receiptDir))
    ? await listScreenshotFiles(receiptDir)
    : [];

  const url =
    storeJob?.url ||
    snap?.url ||
    receiptParsed?.url ||
    card?.startUrl ||
    handoffPageUrl ||
    "";
  if (
    !url &&
    handoffFileSources.length === 0 &&
    !storeJob &&
    !(await exists(receiptDir))
  ) {
    return null;
  }

  const instruction =
    storeJob?.instruction ||
    snap?.instruction ||
    receiptParsed?.instruction ||
    card?.instruction ||
    handoffInstruction ||
    "(missing instruction)";

  // Prefer honest package_created over a misleading queued job snapshot.
  const status: HandoffStatus = asStatus(
    portableStatus === "package_created"
      ? "package_created"
      : storeJob?.status ?? snap?.status ?? portableStatus ?? receiptParsed?.status,
    storeJob
      ? storeJob.status
      : receiptParsed?.status === "failed"
        ? "failed"
        : "succeeded",
  );

  const actions: HandoffAction[] =
    (storeJob?.actions?.length ? storeJob.actions : undefined) ||
    (snap?.actions?.length ? snap.actions : undefined) ||
    receiptParsed?.actions ||
    [];

  const resultSummary =
    storeJob?.resultSummary ||
    snap?.resultSummary ||
    receiptParsed?.result?.slice(0, 500);

  const error = storeJob?.error || snap?.error || receiptParsed?.error;

  const candidateShots =
    (storeJob?.screenshotPaths?.length ? storeJob.screenshotPaths : undefined) ||
    (snap?.screenshotPaths?.length ? snap.screenshotPaths : undefined) ||
    receiptParsed?.screenshotPaths ||
    [];

  const screenshotPaths = resolveShotPaths(receiptDir, candidateShots, onDiskShots);

  const createdAt =
    storeJob?.createdAt ||
    card?.createdAt ||
    receiptParsed?.when ||
    actions[0]?.at ||
    new Date(0).toISOString();

  const updatedAt = storeJob?.updatedAt || createdAt;
  const mode = snap?.mode || receiptParsed?.mode;

  const partial =
    status !== "package_created" &&
    (!storeJob ||
      !(await exists(receiptPath)) ||
      screenshotPaths.length === 0 ||
      indexNotes.length > 0);

  if (!(await exists(receiptDir))) {
    indexNotes.push("Receipt folder missing; using store job only");
  }

  const pageExcerpt = receiptParsed?.result?.slice(0, 2000);

  const hasBrowser = Boolean(url);
  const hasFiles = handoffFileSources.length > 0;
  const primarySourceType: ActivityRecord["primarySourceType"] = hasBrowser
    ? hasFiles
      ? "mixed"
      : "browser"
    : hasFiles
      ? "file"
      : "unknown";

  const fileLabel =
    handoffFileSources.length === 0
      ? ""
      : handoffFileSources.length === 1
        ? handoffFileSources[0]!.filename
        : `${handoffFileSources[0]!.filename} +${handoffFileSources.length - 1}`;

  const hostname = hasBrowser
    ? hostnameOf(url)
    : hasFiles
      ? "files"
      : "local";
  const displayLabel = hasBrowser
    ? hostnameOf(url)
    : fileLabel || card?.name || "File handoff";

  const record: ActivityRecord = {
    id,
    schemaVersion: "0.1",
    ...(hasBrowser ? { url } : {}),
    hostname,
    primarySourceType,
    displayLabel,
    pageTitle:
      handoffPageTitle ||
      receiptParsed?.pageTitle ||
      card?.name ||
      (hasFiles ? fileLabel : undefined),
    instruction,
    note: storeJob?.note || snap?.note || receiptParsed?.note,
    status,
    createdAt,
    updatedAt,
    startedAt: storeJob?.startedAt,
    finishedAt: storeJob?.finishedAt,
    mode,
    resultSummary,
    error,
    screenshotCount: screenshotPaths.length,
    screenshotPaths,
    thumbnailPath: screenshotPaths[0],
    fileSources: handoffFileSources,
    receiptDir,
    receiptPath: (await exists(receiptPath)) ? receiptPath : storeJob?.receiptPath,
    cardPath: (await exists(cardPath)) ? cardPath : storeJob?.cardPath,
    jobPath: (await exists(receiptJobPath)) ? receiptJobPath : undefined,
    storeJobPath: storeJob ? storeJobPath : undefined,
    tags: card?.tags ?? [],
    cardName: card?.name,
    timeline: buildTimeline(actions, resultSummary, error),
    untrustedContent: {
      pageExcerpt,
      warning: UNTRUSTED_CONTENT_WARNING,
    },
    partial,
    indexNotes,
  };

  return record;
}

export async function getActivityById(
  id: string,
  options?: { home?: string },
): Promise<ActivityRecord | null> {
  const home = tabHandoffHome(options?.home);
  return buildRecord(home, id);
}

export async function readReceiptMarkdown(
  id: string,
  options?: { home?: string },
): Promise<string | null> {
  const home = tabHandoffHome(options?.home);
  const p = path.join(receiptsDir(home), id, "receipt.md");
  if (!(await exists(p))) return null;
  return readFile(p, "utf8");
}

export async function readCardYaml(
  id: string,
  options?: { home?: string },
): Promise<string | null> {
  const home = tabHandoffHome(options?.home);
  const p = path.join(receiptsDir(home), id, "card.yaml");
  if (!(await exists(p))) return null;
  return readFile(p, "utf8");
}
