import type { Page } from "playwright";
import { extractFromPage } from "./extract.js";

export type LlmProvider = "openai" | "anthropic" | null;

export function detectLlmProvider(): LlmProvider {
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  return null;
}

type ToolCall = {
  name: "click" | "type" | "extract" | "done";
  args: Record<string, string>;
};

/**
 * Minimal tool-calling agent loop. Falls back to DOM extract if the
 * provider call fails or no key is present.
 */
export async function runLlmAgent(
  page: Page,
  instruction: string,
  onAction: (tool: string, detail: string, ok: boolean) => void,
): Promise<{ markdown: string; title: string; mode: "dom" | "llm" }> {
  const provider = detectLlmProvider();
  if (!provider) {
    const r = await extractFromPage(page, instruction);
    onAction("extract", "dom fallback (no API key)", true);
    return r;
  }

  try {
    const snapshot = await page.evaluate(() => {
      const texts = Array.from(document.querySelectorAll("a, button, input, [role='button'], h1, h2, h3"))
        .slice(0, 80)
        .map((el) => {
          const tag = el.tagName.toLowerCase();
          const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
          const name = el.getAttribute("name") ?? el.getAttribute("aria-label") ?? "";
          const href = el.getAttribute("href") ?? "";
          return `- <${tag}> text="${text}" name="${name}" href="${href}"`;
        });
      return {
        title: document.title,
        url: location.href,
        elements: texts.join("\n"),
      };
    });

    const plan = await askModel(provider, instruction, snapshot);
    onAction("plan", `${provider}: ${plan.raw.slice(0, 200)}`, true);

    for (const step of plan.tools.slice(0, 8)) {
      try {
        if (step.name === "click" && step.args.selector) {
          await page.click(step.args.selector, { timeout: 8_000 });
          onAction("click", step.args.selector, true);
        } else if (step.name === "type" && step.args.selector && step.args.text) {
          await page.fill(step.args.selector, step.args.text, { timeout: 8_000 });
          onAction("type", `${step.args.selector} ← ${step.args.text}`, true);
        } else if (step.name === "done") {
          break;
        }
      } catch (err) {
        onAction(step.name, String(err), false);
      }
    }

    const extracted = await extractFromPage(page, instruction);
    onAction("extract", "post-llm dom extract", true);
    return { ...extracted, mode: "llm" };
  } catch (err) {
    onAction("llm", `failed: ${String(err)}; falling back to dom`, false);
    const r = await extractFromPage(page, instruction);
    return r;
  }
}

async function askModel(
  provider: "openai" | "anthropic",
  instruction: string,
  snapshot: { title: string; url: string; elements: string },
): Promise<{ tools: ToolCall[]; raw: string }> {
  const system = `You are a careful browser handoff agent. Return ONLY JSON:
{"tools":[{"name":"click|type|extract|done","args":{"selector":"...","text":"..."}}]}
Prefer CSS selectors. Prefer extract/done for read-only tasks. Never invent file:// or local URLs.`;

  const user = `URL: ${snapshot.url}
Title: ${snapshot.title}
Instruction: ${instruction}

Visible controls:
${snapshot.elements}`;

  if (provider === "openai") {
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    return { tools: parseTools(raw), raw };
  }

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const raw = json.content?.find((c) => c.type === "text")?.text ?? "{}";
  return { tools: parseTools(raw), raw };
}

function parseTools(raw: string): ToolCall[] {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const slice = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
    const parsed = JSON.parse(slice) as { tools?: ToolCall[] };
    return Array.isArray(parsed.tools) ? parsed.tools : [];
  } catch {
    return [{ name: "extract", args: {} }];
  }
}
