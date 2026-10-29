import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveAiProvider,
  resolveAiProviderAsync,
  preserveExactModelId,
  runAiCompletion,
  sanitizeError,
} from "../src/provider.ts";

describe("AI provider abstraction", () => {
  it("prefers OpenAI-compatible when OPENAI_API_KEY is set", () => {
    const cfg = resolveAiProvider({
      OPENAI_API_KEY: "sk-test",
      ANTHROPIC_API_KEY: "anth-test",
      OPENAI_MODEL: "gpt-4o-mini",
      OPENAI_BASE_URL: "https://example.local/v1/",
    });
    assert.ok(cfg);
    assert.equal(cfg!.id, "openai-compatible");
    assert.equal(cfg!.model, "gpt-4o-mini");
    assert.equal(cfg!.baseUrl, "https://example.local/v1");
  });

  it("falls back to Anthropic when only that key exists", () => {
    const cfg = resolveAiProvider({ ANTHROPIC_API_KEY: "anth-test" });
    assert.ok(cfg);
    assert.equal(cfg!.id, "anthropic");
  });

  it("returns null when no keys", () => {
    assert.equal(resolveAiProvider({}), null);
  });

  it("resolves Ollama when TABHANDOFF_AI_PROVIDER=ollama without a cloud key", () => {
    const cfg = resolveAiProvider({
      TABHANDOFF_AI_PROVIDER: "ollama",
      OLLAMA_MODEL: "smollm2:135m",
    });
    assert.ok(cfg);
    assert.equal(cfg!.id, "ollama");
    assert.equal(cfg!.model, "smollm2:135m");
    assert.match(cfg!.baseUrl ?? "", /11434/);
  });

  it("preserveExactModelId never strips :tag", () => {
    assert.equal(
      preserveExactModelId(undefined, ["smollm2:135m", "llama3.2:latest"], "x"),
      "smollm2:135m",
    );
    assert.equal(
      preserveExactModelId("llama3.2:latest", ["smollm2:135m"], "x"),
      "llama3.2:latest",
    );
    assert.equal(preserveExactModelId(undefined, [], "fallback:tag"), "fallback:tag");
  });

  it("auto-detect Ollama keeps full model tag (regression for 404)", async () => {
    const fakeFetch: typeof fetch = async (url) => {
      if (String(url).includes("/api/tags")) {
        return new Response(
          JSON.stringify({ models: [{ name: "smollm2:135m" }] }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected ${url}`);
    };
    const cfg = await resolveAiProviderAsync({}, { fetch: fakeFetch });
    assert.ok(cfg);
    assert.equal(cfg!.id, "ollama");
    assert.equal(cfg!.model, "smollm2:135m");
    assert.equal(cfg!.model.includes(":"), true);
  });

  it("resolves Groq from GROQ_API_KEY", () => {
    const cfg = resolveAiProvider({ GROQ_API_KEY: "gsk-test" });
    assert.ok(cfg);
    assert.equal(cfg!.id, "groq");
  });

  it("resolves LM Studio when TABHANDOFF_AI_PROVIDER=lmstudio", () => {
    const cfg = resolveAiProvider({
      TABHANDOFF_AI_PROVIDER: "lmstudio",
      LMSTUDIO_MODEL: "my-local:latest",
    });
    assert.ok(cfg);
    assert.equal(cfg!.id, "lmstudio");
    assert.equal(cfg!.model, "my-local:latest");
  });

  it("runAiCompletion with mock fetch", async () => {
    const fakeFetch: typeof fetch = async (url) => {
      assert.match(String(url), /chat\/completions$/);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok-from-mock" } }],
        }),
        { status: 200 },
      );
    };
    const result = await runAiCompletion(
      {
        instruction: "Say ok",
        url: "https://example.com",
        pageText: "body",
      },
      {
        fetch: fakeFetch,
        env: { OPENAI_API_KEY: "k", OPENAI_MODEL: "gpt-4o-mini" },
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.status, "done");
    assert.equal(result.result, "ok-from-mock");
  });

  it("propagates provider HTTP failures honestly", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response("Bearer sk-should-redact boom", { status: 401 });
    const result = await runAiCompletion(
      { instruction: "x" },
      {
        fetch: fakeFetch,
        env: { OPENAI_API_KEY: "sk-should-redact" },
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, "failed");
    assert.equal(result.message.includes("sk-should-redact"), false);
  });

  it("sanitizeError truncates and redacts", () => {
    const out = sanitizeError(`Bearer sk-abcdef ${"x".repeat(2000)}`);
    assert.ok(out.length <= 800);
    assert.equal(out.includes("sk-abcdef"), false);
  });
});
