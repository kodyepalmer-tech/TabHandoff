import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tabHandoffHome } from "./home.js";

/**
 * Local AI preferences — never stores API keys.
 * Keys stay in process env only.
 */
export type AiSettings = {
  version: 1;
  /** ollama | lmstudio | openai-compatible | anthropic | groq | auto */
  provider: string;
  /** Exact model id including tags */
  model: string;
  /** Optional OpenAI-compatible base URL override (local only recommended) */
  baseUrl?: string;
  updatedAt: string;
};

export function aiSettingsPath(home?: string): string {
  return path.join(tabHandoffHome(home), "ai-settings.json");
}

export async function loadAiSettings(home?: string): Promise<AiSettings | null> {
  try {
    const raw = await readFile(aiSettingsPath(home), "utf8");
    const parsed = JSON.parse(raw) as AiSettings;
    if (parsed?.version !== 1 || typeof parsed.model !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveAiSettings(
  settings: Omit<AiSettings, "version" | "updatedAt">,
  home?: string,
): Promise<AiSettings> {
  const root = tabHandoffHome(home);
  await mkdir(root, { recursive: true });
  const next: AiSettings = {
    version: 1,
    provider: (settings.provider || "auto").trim() || "auto",
    model: settings.model.trim(),
    baseUrl: settings.baseUrl?.trim() || undefined,
    updatedAt: new Date().toISOString(),
  };
  if (!next.model) {
    throw new Error("Model id is required.");
  }
  // Refuse obvious cloud key material if someone pastes into model/baseUrl by mistake
  const blob = `${next.model}${next.baseUrl ?? ""}`;
  if (/sk-[A-Za-z0-9]{10,}/.test(blob) || /gsk_/.test(blob)) {
    throw new Error("Do not put API keys in AI settings — use environment variables.");
  }
  await writeFile(aiSettingsPath(home), JSON.stringify(next, null, 2), "utf8");
  try {
    const { chmod } = await import("node:fs/promises");
    await chmod(aiSettingsPath(home), 0o600);
  } catch {
    /* ignore */
  }
  return next;
}

/** Merge settings into an env object for provider resolve (no secrets copied). */
export function envWithAiSettings(
  base: NodeJS.ProcessEnv,
  settings: AiSettings | null,
): NodeJS.ProcessEnv {
  if (!settings) return base;
  const env = { ...base };
  const p = settings.provider.toLowerCase();
  if (p && p !== "auto") {
    env.TABHANDOFF_AI_PROVIDER = p;
  }
  if (settings.model) {
    env.OLLAMA_MODEL = settings.model;
    env.OPENAI_MODEL = settings.model;
    env.LMSTUDIO_MODEL = settings.model;
  }
  if (settings.baseUrl) {
    env.OPENAI_BASE_URL = settings.baseUrl;
  }
  return env;
}
