import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, after, beforeEach } from "node:test";
import {
  clearCapabilitiesCache,
  setCapabilitiesOverride,
} from "../src/capabilities.ts";
import { loadOrCreateBridgeConfig } from "../src/config.ts";
import { startBridgeServer } from "../src/server.ts";
import { executeAiRun } from "../src/ai-run.ts";
import { sanitizeError } from "@tabhandoff/runner";

describe("Priority 4 AI execution slice", () => {
  const temps: string[] = [];

  beforeEach(() => {
    clearCapabilitiesCache();
  });

  after(async () => {
    clearCapabilitiesCache();
    for (const t of temps) {
      await rm(t, { recursive: true, force: true });
    }
  });

  it("sanitizeError redacts key-shaped strings", () => {
    const raw =
      'Bearer sk-abc123XYZ and x-api-key: secret-value and token sk-proj-hello';
    const cleaned = sanitizeError(raw);
    assert.equal(cleaned.includes("sk-abc123XYZ"), false);
    assert.equal(cleaned.includes("secret-value"), false);
    assert.match(cleaned, /redacted/i);
  });

  it("executeAiRun is honestly unavailable without a key", async () => {
    // Isolated home so ~/.tabhandoff/ai-settings.json cannot inject a local provider
    const home = await mkdtemp(path.join(os.tmpdir(), "th-ai-none-"));
    temps.push(home);
    const result = await executeAiRun(
      {
        instruction: "Summarize",
        url: "https://example.com",
        pageText: "Hello world",
      },
      { home, deps: { env: {}, allowLocalProbe: false } },
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, "unavailable");
    assert.equal(result.apiKeyIncluded, false);
    assert.equal(result.provider, null);
    assert.match(result.message, /No AI provider configured/i);
  });

  it("executeAiRun uses mocked OpenAI-compatible provider", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "th-ai-mock-"));
    temps.push(home);

    const fakeFetch: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ role: string; content: string }>;
      };
      assert.equal(body.messages?.[0]?.role, "system");
      assert.match(body.messages?.[1]?.content ?? "", /Instruction: Summarize/);
      assert.match(body.messages?.[1]?.content ?? "", /Hello from page/);
      // Ensure Authorization header exists but we never assert the key into logs
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      assert.match(auth ?? "", /^Bearer test-key$/);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "## Summary\n\nMocked OK" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const result = await executeAiRun(
      {
        instruction: "Summarize",
        url: "https://example.com",
        title: "Example",
        pageText: "Hello from page",
        handoffId: "ai-mock-001",
      },
      {
        home,
        deps: {
          fetch: fakeFetch,
          env: {
            OPENAI_API_KEY: "test-key",
            OPENAI_MODEL: "gpt-4o-mini",
          },
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.status, "done");
    assert.equal(result.provider, "openai-compatible");
    assert.equal(result.model, "gpt-4o-mini");
    assert.match(result.result, /Mocked OK/);
    assert.equal(result.apiKeyIncluded, false);
    assert.ok(result.resultPath);

    assert.ok(result.taskPath);
    const onDisk = JSON.parse(await readFile(result.taskPath!, "utf8")) as {
      apiKeyIncluded: boolean;
      result: string;
      provider: string;
    };
    assert.equal(onDisk.apiKeyIncluded, false);
    assert.match(onDisk.result, /Mocked OK/);
    assert.equal(onDisk.provider, "openai-compatible");

    const rawDisk = await readFile(result.taskPath!, "utf8");
    assert.equal(rawDisk.includes("test-key"), false);
  });

  it("POST /v1/ai/run returns 503 without key and never fakes success", async () => {
    setCapabilitiesOverride({
      pageExtraction: false,
      llmAgent: false,
      aiCompletion: false,
      workflows: [],
      message: "no ai",
    });
    const home = await mkdtemp(path.join(os.tmpdir(), "th-ai-http-"));
    temps.push(home);
    const port = 23000 + Math.floor(Math.random() * 1000);
    const config = await loadOrCreateBridgeConfig({ home, port });
    config.port = port;

    const server = await startBridgeServer({
      config,
      home,
      aiDeps: { env: {} },
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/ai/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "chrome-extension://abcdef",
          Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify({
          url: "https://example.com",
          instruction: "Summarize this",
          pageText: "Page body",
        }),
      });
      assert.equal(res.status, 503);
      const body = (await res.json()) as {
        ok: boolean;
        status: string;
        apiKeyIncluded: boolean;
      };
      assert.equal(body.ok, false);
      assert.equal(body.status, "unavailable");
      assert.equal(body.apiKeyIncluded, false);
    } finally {
      await server.close();
      clearCapabilitiesCache();
    }
  });

  it("POST /v1/ai/run succeeds with mocked provider", async () => {
    setCapabilitiesOverride({
      pageExtraction: false,
      llmAgent: false,
      aiCompletion: true,
      workflows: [
        {
          id: "ai_completion",
          label: "Run with AI",
          description: "test",
        },
      ],
      message: "ai ready",
    });
    const home = await mkdtemp(path.join(os.tmpdir(), "th-ai-ok-"));
    temps.push(home);
    const port = 24000 + Math.floor(Math.random() * 1000);
    const config = await loadOrCreateBridgeConfig({ home, port });
    config.port = port;

    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Bridge mock result" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const server = await startBridgeServer({
      config,
      home,
      aiDeps: {
        fetch: fakeFetch,
        env: { OPENAI_API_KEY: "bridge-test-key" },
      },
    });
    try {
      const statusRes = await fetch(`http://127.0.0.1:${port}/v1/status`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      const statusBody = (await statusRes.json()) as { aiCompletion: boolean };
      assert.equal(statusBody.aiCompletion, true);

      const res = await fetch(`http://127.0.0.1:${port}/v1/ai/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "chrome-extension://abcdef",
          Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify({
          url: "https://example.com",
          title: "Example",
          instruction: "List next steps",
          pageText: "Step one then step two",
          handoffId: "http-ai-001",
        }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        ok: boolean;
        status: string;
        result: string;
        apiKeyIncluded: boolean;
        provider: string;
      };
      assert.equal(body.ok, true);
      assert.equal(body.status, "done");
      assert.match(body.result, /Bridge mock result/);
      assert.equal(body.apiKeyIncluded, false);
      assert.equal(body.provider, "openai-compatible");
    } finally {
      await server.close();
      clearCapabilitiesCache();
    }
  });

  it("persists task under ai-tasks even without handoffId", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "th-ai-task-"));
    temps.push(home);
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Persisted task OK" } }],
        }),
        { status: 200 },
      );
    const result = await executeAiRun(
      {
        instruction: "Summarize",
        url: "https://example.com",
        pageText: "Hello",
      },
      {
        home,
        deps: {
          fetch: fakeFetch,
          env: { OPENAI_API_KEY: "k", OPENAI_MODEL: "gpt-4o-mini" },
        },
      },
    );
    assert.equal(result.ok, true);
    assert.ok(result.taskId);
    assert.ok(result.taskPath);
    const disk = JSON.parse(await readFile(result.taskPath!, "utf8")) as {
      result: string;
      apiKeyIncluded: boolean;
    };
    assert.match(disk.result, /Persisted task OK/);
    assert.equal(disk.apiKeyIncluded, false);
  });

  it("real provider call when OPENAI_API_KEY or Ollama available (skip otherwise)", async () => {
    const key = process.env.OPENAI_API_KEY?.trim();
    let ollamaOk = false;
    try {
      const tags = await fetch("http://127.0.0.1:11434/api/tags");
      ollamaOk = tags.ok;
    } catch {
      ollamaOk = false;
    }
    if (!key && !ollamaOk) {
      // Honest skip — do not fake an external success
      assert.ok(true, "skipped: no OPENAI_API_KEY and no local Ollama");
      return;
    }
    const home = await mkdtemp(path.join(os.tmpdir(), "th-ai-live-"));
    temps.push(home);
    const result = await executeAiRun(
      {
        instruction: "Reply with exactly the word PONG and nothing else.",
        url: "https://example.com",
        title: "ping",
        pageText: "ping fixture",
      },
      {
        home,
        deps: key
          ? undefined
          : {
              env: {
                TABHANDOFF_AI_PROVIDER: "ollama",
                OLLAMA_MODEL: "smollm2:135m",
              },
              allowOllamaProbe: true,
            },
      },
    );
    assert.equal(result.status === "done" || result.status === "failed", true);
    assert.equal(result.apiKeyIncluded, false);
    assert.ok(result.taskId);
    if (result.ok) {
      assert.ok(result.result.length > 0);
    }
  });
});
