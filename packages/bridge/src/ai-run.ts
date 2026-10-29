import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  runAiCompletion,
  resolveAiProvider,
  resolveAiProviderAsync,
  type AiCompletionInput,
  type AiCompletionResult,
  type AiProviderDeps,
} from "@tabhandoff/runner";
import { receiptsDir, tabHandoffHome } from "./home.js";
import { envWithAiSettings, loadAiSettings } from "./ai-settings.js";

export type AiRunRequest = AiCompletionInput & {
  /** Optional existing handoff id to attach result under */
  handoffId?: string;
  /** Optional client-supplied task id (extension history) */
  taskId?: string;
};

export type AiTaskRecord = {
  id: string;
  at: string;
  status: AiCompletionResult["status"];
  provider: AiCompletionResult["provider"];
  model: string | null;
  instruction: string;
  url?: string;
  title?: string;
  selectedText?: string;
  ok: boolean;
  result: string;
  error?: string;
  message: string;
  handoffId?: string;
  /** Explicit: secrets must never appear here */
  apiKeyIncluded: false;
};

export type AiRunResponse = AiCompletionResult & {
  handoffId?: string;
  taskId?: string;
  resultPath?: string;
  taskPath?: string;
  /** Always false in ZIP/package payloads — keys never leave process env */
  apiKeyIncluded: false;
};

const MAX_PAGE_TEXT = 24_000;
const MAX_SELECTED = 8_000;
const MAX_INSTRUCTION = 8_000;
const MAX_TITLE = 500;

export function aiTasksDir(home?: string): string {
  return path.join(tabHandoffHome(home), "ai-tasks");
}

export function aiCompletionAvailable(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveAiProvider(env) !== null;
}

export async function aiCompletionAvailableAsync(
  env: NodeJS.ProcessEnv = process.env,
  deps?: AiProviderDeps,
): Promise<boolean> {
  if (resolveAiProvider(env)) return true;
  const cfg = await resolveAiProviderAsync(env, { fetch: deps?.fetch });
  return cfg !== null;
}

function clamp(s: string | undefined, max: number): string | undefined {
  if (s == null) return undefined;
  const t = String(s);
  return t.length <= max ? t : t.slice(0, max);
}

function safeId(id: string | undefined): string | null {
  if (!id?.trim()) return null;
  const t = id.trim();
  if (t.includes("/") || t.includes("..") || t.length > 80) return null;
  return t;
}

async function writeTaskRecord(
  home: string,
  record: AiTaskRecord,
): Promise<{ taskPath: string; resultPath: string }> {
  const dir = path.join(aiTasksDir(home), record.id);
  await mkdir(dir, { recursive: true });
  const taskPath = path.join(dir, "task.json");
  await writeFile(taskPath, JSON.stringify(record, null, 2), "utf8");
  const resultPath = path.join(dir, "result.md");
  await writeFile(
    resultPath,
    [
      `# TabHandoff AI task`,
      ``,
      `Status: **${record.status}**`,
      `Provider: \`${record.provider ?? "none"}\``,
      `Model: \`${record.model ?? "none"}\``,
      record.url ? `URL: ${record.url}` : null,
      record.title ? `Title: ${record.title}` : null,
      ``,
      `## What you asked`,
      record.instruction,
      ``,
      `## Result`,
      ``,
      record.result || record.message || "(no result)",
      ``,
    ]
      .filter((line) => line !== null)
      .join("\n"),
    "utf8",
  );
  return { taskPath, resultPath };
}

/**
 * Execute a single model completion from captured page context.
 * Always persists under ~/.tabhandoff/ai-tasks/<id>/ so reopen finds work.
 * Optionally also writes next to an existing receipt when handoffId is set.
 * Never writes API keys to disk or into packages.
 */
export async function executeAiRun(
  request: AiRunRequest,
  options?: {
    home?: string;
    deps?: AiProviderDeps;
  },
): Promise<AiRunResponse> {
  const instruction = clamp(request.instruction, MAX_INSTRUCTION)?.trim() ?? "";
  const input: AiCompletionInput = {
    instruction,
    url: clamp(request.url, 2048),
    title: clamp(request.title, MAX_TITLE),
    selectedText: clamp(request.selectedText, MAX_SELECTED),
    pageText: clamp(request.pageText, MAX_PAGE_TEXT),
    maxTokens: request.maxTokens,
  };

  const home = tabHandoffHome(options?.home);
  const settings = await loadAiSettings(home);
  const baseEnv = options?.deps?.env ?? process.env;
  const mergedDeps: AiProviderDeps = {
    ...options?.deps,
    env: envWithAiSettings(baseEnv, settings),
    // When caller injected a test env, still allow local probe only if they opted in
    allowLocalProbe:
      options?.deps?.allowLocalProbe ??
      options?.deps?.allowOllamaProbe ??
      options?.deps?.env === undefined,
  };
  const result = await runAiCompletion(input, mergedDeps);
  const taskId = safeId(request.taskId) || `ai-${randomUUID().slice(0, 12)}`;
  const handoffId = safeId(request.handoffId) || undefined;

  const record: AiTaskRecord = {
    id: taskId,
    at: new Date().toISOString(),
    status: result.status,
    provider: result.provider,
    model: result.model,
    instruction: input.instruction,
    url: input.url,
    title: input.title,
    selectedText: input.selectedText,
    ok: result.ok,
    result: result.result,
    error: result.error,
    message: result.message,
    handoffId,
    apiKeyIncluded: false,
  };

  let taskPath: string | undefined;
  let resultPath: string | undefined;
  try {
    const written = await writeTaskRecord(home, record);
    taskPath = written.taskPath;
    resultPath = written.resultPath;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...result,
      taskId,
      handoffId,
      apiKeyIncluded: false,
      message: `${result.message} (could not persist task: ${message})`,
    };
  }

  if (handoffId) {
    const receiptDir = path.join(receiptsDir(home), handoffId);
    try {
      await mkdir(receiptDir, { recursive: true });
      await writeFile(
        path.join(receiptDir, "ai-result.json"),
        JSON.stringify({ ...record, taskPath }, null, 2),
        "utf8",
      );
      if (result.ok && result.result) {
        await writeFile(
          path.join(receiptDir, "ai-result.md"),
          await readFile(resultPath, "utf8"),
          "utf8",
        );
      }
      resultPath = path.join(receiptDir, "ai-result.json");
    } catch {
      /* task already persisted under ai-tasks */
    }
  }

  return {
    ...result,
    taskId,
    handoffId,
    resultPath,
    taskPath,
    apiKeyIncluded: false,
  };
}

/** List recent AI tasks (newest first). */
export async function listAiTasks(options?: {
  home?: string;
  limit?: number;
}): Promise<AiTaskRecord[]> {
  const root = aiTasksDir(options?.home);
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  const records: AiTaskRecord[] = [];
  for (const id of entries) {
    if (id.includes("..") || id.includes("/")) continue;
    try {
      const raw = await readFile(path.join(root, id, "task.json"), "utf8");
      const parsed = JSON.parse(raw) as AiTaskRecord;
      if (parsed?.id) records.push({ ...parsed, apiKeyIncluded: false });
    } catch {
      /* skip corrupt */
    }
  }

  records.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const limit = options?.limit ?? 50;
  return records.slice(0, limit);
}

export async function getAiTask(
  id: string,
  options?: { home?: string },
): Promise<AiTaskRecord | null> {
  const safe = safeId(id);
  if (!safe) return null;
  try {
    const raw = await readFile(
      path.join(aiTasksDir(options?.home), safe, "task.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as AiTaskRecord;
    return { ...parsed, apiKeyIncluded: false };
  } catch {
    return null;
  }
}
