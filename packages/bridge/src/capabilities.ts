import { access } from "node:fs/promises";
import {
  detectLlmProvider,
  resolveAiProvider,
  resolveAiProviderAsync,
} from "@tabhandoff/runner";

export type SupportedWorkflow = {
  id: "page_extraction" | "llm_browser" | "ai_completion";
  label: string;
  description: string;
};

export type BridgeCapabilities = {
  /** Isolated Playwright page extract (no API key) */
  pageExtraction: boolean;
  /** Model-assisted isolated browser when OPENAI_/ANTHROPIC_ key is set */
  llmAgent: boolean;
  /**
   * Context→model completion via /v1/ai/run (no Playwright required).
   * True when env keys OR a live local Ollama daemon is available.
   */
  aiCompletion: boolean;
  /** Detected provider id when known (never includes secrets) */
  aiProvider?: string | null;
  aiModel?: string | null;
  workflows: SupportedWorkflow[];
  /** Honest summary for /v1/status */
  message: string;
};

let cached: { at: number; value: BridgeCapabilities } | null = null;
const CACHE_MS = 15_000;
/** Test-only override — null means use real probe */
let testOverride: BridgeCapabilities | null = null;

async function chromiumReady(): Promise<boolean> {
  try {
    const pw = await import("playwright");
    if (!pw.chromium) return false;
    const exe = pw.chromium.executablePath();
    await access(exe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe what the bridge can run right now. Never claims success — only capability.
 */
/** Test helper — force capabilities without launching Chromium */
export function setCapabilitiesOverride(
  value: BridgeCapabilities | null,
): void {
  testOverride = value;
  cached = null;
}

export async function probeBridgeCapabilities(options?: {
  /** Bypass cache (tests) */
  fresh?: boolean;
}): Promise<BridgeCapabilities> {
  if (testOverride) return testOverride;
  if (!options?.fresh && cached && Date.now() - cached.at < CACHE_MS) {
    return cached.value;
  }

  const pageExtraction = await chromiumReady();
  const provider = await resolveAiProviderAsync();
  const hasProvider = provider !== null;
  const llmAgent = pageExtraction && detectLlmProvider() !== null;
  const aiCompletion = hasProvider;
  const workflows: SupportedWorkflow[] = [];

  if (pageExtraction) {
    workflows.push({
      id: "page_extraction",
      label: "Page extraction",
      description:
        "Open the URL in an isolated browser and extract page content. Not autonomous AI — no API key required.",
    });
  }
  if (pageExtraction && llmAgent) {
    workflows.push({
      id: "llm_browser",
      label: "Model-assisted browser",
      description:
        "Isolated browser with model-assisted steps (API key detected). Still no cookie/credential clone.",
    });
  }
  if (aiCompletion) {
    workflows.push({
      id: "ai_completion",
      label: "Run with AI",
      description:
        "Send captured page context + instruction to the configured model via loopback /v1/ai/run. Key stays in bridge env — never in the extension or ZIP.",
    });
  }

  let message: string;
  if (workflows.length === 0) {
    message =
      "Bridge can store packages only. Playwright/Chromium is not available and no AI provider is configured — no extraction or AI run.";
  } else if (aiCompletion && llmAgent) {
    message = `Bridge can store packages, run page extraction / model-assisted browser steps, and Run with AI (${provider?.id}/${provider?.model}).`;
  } else if (aiCompletion && pageExtraction) {
    message = `Bridge can store packages, run page extraction (DOM), and Run with AI (${provider?.id}/${provider?.model}).`;
  } else if (aiCompletion) {
    message = `Bridge can store packages and Run with AI (${provider?.id}/${provider?.model}). Playwright/Chromium not available for page extraction.`;
  } else if (llmAgent) {
    message =
      "Bridge can store packages and run page extraction or model-assisted browser steps in an isolated Chromium.";
  } else {
    message =
      "Bridge can store packages and run page extraction (deterministic DOM) in an isolated Chromium. No AI provider — Run with AI unavailable.";
  }

  // Keep resolveAiProvider sync path in message when only sync keys exist
  void resolveAiProvider;

  const value: BridgeCapabilities = {
    pageExtraction,
    llmAgent,
    aiCompletion,
    aiProvider: provider?.id ?? null,
    aiModel: provider?.model ?? null,
    workflows,
    message,
  };
  cached = { at: Date.now(), value };
  return value;
}

/** Test helper */
export function clearCapabilitiesCache(): void {
  cached = null;
  testOverride = null;
}
