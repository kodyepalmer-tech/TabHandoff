#!/usr/bin/env node
/**
 * Local proof for one-button transfer (create → continue → run-ai → verify).
 * Uses a mocked OpenAI-compatible provider so CI/sandboxes without Ollama
 * can still prove the Stage path. When Ollama is up, also tries a live run.
 *
 * Never claims verified without Stage checks.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { transferAndRun } from "../packages/bridge/dist/index.js";

async function probeOllama() {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = await res.json();
    const models = (body.models || []).map((m) => m.name);
    return { ok: true, models };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function mockProof() {
  const home = await mkdtemp(path.join(os.tmpdir(), "th-ob-proof-"));
  const fakeFetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                "TabHandoff moves task state to another agent and verifies the destination actually ran.",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  const result = await transferAndRun({
    instruction: "Summarize TabHandoff in one sentence.",
    intendedOutcome: "One honest summary sentence.",
    url: "https://example.com/",
    title: "Example",
    selectedText: "TabHandoff is a local handoff layer for AI agents.",
    destinationAgent: "proof-dest-ai",
    sourceAgent: "proof-desktop",
    home,
    aiDeps: {
      fetch: fakeFetch,
      env: { OPENAI_API_KEY: "proof-key", OPENAI_MODEL: "gpt-4o-mini" },
      allowLocalProbe: false,
    },
  });

  return { home, result, mode: "mocked-provider" };
}

async function liveOllamaProof(model) {
  const home = await mkdtemp(path.join(os.tmpdir(), "th-ob-ollama-"));
  const result = await transferAndRun({
    instruction: "Reply with one short sentence about TabHandoff.",
    intendedOutcome: "One short sentence.",
    note: "TabHandoff transfers task state between compatible AI agents.",
    destinationAgent: `ollama-${model}`,
    sourceAgent: "proof-desktop",
    home,
    aiDeps: {
      env: {
        TABHANDOFF_AI_PROVIDER: "ollama",
        OLLAMA_MODEL: model,
      },
      allowLocalProbe: true,
    },
  });
  return { home, result, mode: `ollama:${model}` };
}

function summarize(label, { result, mode }) {
  return {
    label,
    mode,
    ok: result.ok,
    stage: result.stage,
    plainStatus: result.plainStatus,
    verificationOutcome: result.verificationOutcome ?? null,
    sourceId: result.sourceId ?? null,
    successorId: result.successorId ?? null,
    executionRecorded: Boolean(result.executionRecorded),
    agentLaunched: Boolean(result.agentLaunched),
    aiProvider: result.aiProvider ?? null,
    aiModel: result.aiModel ?? null,
    aiResultPreview: (result.aiResult || "").slice(0, 200),
    message: result.message,
    steps: result.steps,
  };
}

const ollama = await probeOllama();
const mock = await mockProof();
const report = {
  at: new Date().toISOString(),
  ollama,
  mock: summarize("mocked transfer path", mock),
  live: null,
  liveBlocker: null,
};

if (ollama.ok && ollama.models?.length) {
  const preferred =
    ollama.models.find((m) => /smollm2:135m/i.test(m)) ||
    ollama.models.find((m) => /smollm/i.test(m)) ||
    ollama.models[0];
  try {
    const live = await liveOllamaProof(preferred);
    report.live = summarize("live Ollama transfer path", live);
    await rm(live.home, { recursive: true, force: true });
  } catch (err) {
    report.liveBlocker = err instanceof Error ? err.message : String(err);
  }
} else {
  report.liveBlocker =
    "Ollama not available in this environment — live model proof blocked. Mocked Stage path still proves create → continue → run-ai → verify.";
}

await rm(mock.home, { recursive: true, force: true });

const payload = JSON.stringify(report, null, 2);
console.log(payload);

if (!report.mock.ok || report.mock.plainStatus !== "verified") {
  console.error("Mocked one-button transfer did not reach verified.");
  process.exitCode = 1;
}
