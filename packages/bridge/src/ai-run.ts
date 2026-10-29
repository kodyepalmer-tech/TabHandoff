import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  runAiCompletion,
  resolveAiProvider,
  type AiCompletionInput,
  type AiCompletionResult,
  type AiProviderDeps,
} from "@tabhandoff/runner";
import { receiptsDir, tabHandoffHome } from "./home.js";

export type AiRunRequest = AiCompletionInput & {
  /** Optional existing handoff id to attach result under */
  handoffId?: string;
};

export type AiRunResponse = AiCompletionResult & {
  handoffId?: string;
  resultPath?: string;
  /** Always false in ZIP/package payloads — keys never leave process env */
  apiKeyIncluded: false;
};

const MAX_PAGE_TEXT = 24_000;
const MAX_SELECTED = 8_000;
const MAX_INSTRUCTION = 8_000;
const MAX_TITLE = 500;

export function aiCompletionAvailable(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveAiProvider(env) !== null;
}

function clamp(s: string | undefined, max: number): string | undefined {
  if (s == null) return undefined;
  const t = String(s);
  return t.length <= max ? t : t.slice(0, max);
}

/**
 * Execute a single model completion from captured page context.
 * Persists result next to an existing receipt when handoffId is provided.
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

  const result = await runAiCompletion(input, options?.deps);

  const base: AiRunResponse = {
    ...result,
    apiKeyIncluded: false,
  };

  if (!request.handoffId?.trim()) {
    return base;
  }

  const handoffId = request.handoffId.trim();
  if (handoffId.includes("/") || handoffId.includes("..")) {
    return {
      ...base,
      ok: false,
      status: "failed",
      error: "invalid_handoff_id",
      message: "Invalid handoff id.",
      apiKeyIncluded: false,
    };
  }

  const home = tabHandoffHome(options?.home);
  const receiptDir = path.join(receiptsDir(home), handoffId);
  try {
    await mkdir(receiptDir, { recursive: true });
    const payload = {
      at: new Date().toISOString(),
      status: result.status,
      provider: result.provider,
      model: result.model,
      instruction: input.instruction,
      url: input.url,
      title: input.title,
      ok: result.ok,
      result: result.result,
      error: result.error,
      message: result.message,
      /** Explicit: secrets must never appear here */
      apiKeyIncluded: false as const,
    };
    const resultPath = path.join(receiptDir, "ai-result.json");
    await writeFile(resultPath, JSON.stringify(payload, null, 2), "utf8");
    if (result.ok && result.result) {
      await writeFile(
        path.join(receiptDir, "ai-result.md"),
        [
          `# TabHandoff AI result`,
          ``,
          `Status: **${result.status}**`,
          `Provider: \`${result.provider ?? "none"}\``,
          `Model: \`${result.model ?? "none"}\``,
          ``,
          `## Instruction`,
          input.instruction,
          ``,
          `## Result`,
          ``,
          result.result,
          ``,
        ].join("\n"),
        "utf8",
      );
    }
    return { ...base, handoffId, resultPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      handoffId,
      message: `${result.message} (could not persist result: ${message})`,
    };
  }
}
