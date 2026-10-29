import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import type { HandoffAction, TaskCard } from "@tabhandoff/protocol";
import { assertSafeUrl } from "./security.js";
import { runLlmAgent } from "./llm.js";

export type RunHandoffInput = {
  id: string;
  url: string;
  instruction: string;
  note?: string;
  receiptDir: string;
  timeoutMs?: number;
  /** May be sync or async — always awaited so job updates cannot race. */
  onAction?: (action: HandoffAction) => void | Promise<void>;
};

export type RunHandoffResult = {
  ok: boolean;
  resultSummary: string;
  receiptPath: string;
  cardPath: string;
  screenshotPaths: string[];
  actions: HandoffAction[];
  error?: string;
  mode: "dom" | "llm";
};

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  sharedBrowser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  return sharedBrowser;
}

export async function closeSharedBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => undefined);
    sharedBrowser = null;
  }
}

async function pushAction(
  actions: HandoffAction[],
  onAction: RunHandoffInput["onAction"],
  tool: string,
  detail: string,
  ok: boolean,
): Promise<void> {
  const action: HandoffAction = {
    at: new Date().toISOString(),
    tool,
    detail,
    ok,
  };
  actions.push(action);
  await onAction?.(action);
}

/**
 * Isolated Chromium context — never clones the user's daily-driver profile
 * or cookies. Ephemeral storage only.
 */
export async function runHandoff(input: RunHandoffInput): Promise<RunHandoffResult> {
  const actions: HandoffAction[] = [];
  const screenshotPaths: string[] = [];
  const timeoutMs = input.timeoutMs ?? 90_000;
  const started = Date.now();

  await mkdir(input.receiptDir, { recursive: true });
  await mkdir(path.join(input.receiptDir, "screenshots"), { recursive: true });

  let browser: Browser | undefined;
  try {
    const safeUrl = assertSafeUrl(input.url);
    await pushAction(actions, input.onAction, "validate_url", safeUrl.toString(), true);

    browser = await getBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        "Mozilla/5.0 (compatible; TabHandoff/0.1; +https://github.com/tabhandoff/tabhandoff) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
      // Explicitly empty — no storageState, no cookies from host
      ignoreHTTPSErrors: false,
    });
    context.setDefaultTimeout(Math.min(timeoutMs, 30_000));

    const page = await context.newPage();
    await pushAction(actions, input.onAction, "browser", "ephemeral chromium context", true);

    await page.goto(safeUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: Math.min(timeoutMs, 45_000),
    });
    await pushAction(actions, input.onAction, "goto", safeUrl.toString(), true);

    const shot1 = path.join(input.receiptDir, "screenshots", "01-loaded.png");
    await page.screenshot({ path: shot1, fullPage: true });
    screenshotPaths.push(shot1);
    await pushAction(actions, input.onAction, "screenshot", shot1, true);

    const remaining = timeoutMs - (Date.now() - started);
    if (remaining < 5_000) {
      throw new Error("Timed out before extraction");
    }

    const extraction = await Promise.race([
      runLlmAgent(page, input.instruction, async (tool, detail, ok) => {
        await pushAction(actions, input.onAction, tool, detail, ok);
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Extraction timed out")), remaining),
      ),
    ]);

    const shot2 = path.join(input.receiptDir, "screenshots", "02-result.png");
    await page.screenshot({ path: shot2, fullPage: true });
    screenshotPaths.push(shot2);
    await pushAction(actions, input.onAction, "screenshot", shot2, true);

    const receiptPath = path.join(input.receiptDir, "receipt.md");
    const cardPath = path.join(input.receiptDir, "card.yaml");
    const receiptMarkdown = renderReceipt({
      id: input.id,
      url: safeUrl.toString(),
      instruction: input.instruction,
      note: input.note,
      actions,
      resultMarkdown: extraction.markdown,
      screenshotPaths,
      mode: extraction.mode,
      status: "succeeded",
    });
    await writeFile(receiptPath, receiptMarkdown, "utf8");

    const card: TaskCard = {
      schemaVersion: "0.1",
      name: `tabhandoff-${input.id.slice(0, 8)}`,
      description: input.instruction.slice(0, 160),
      startUrl: safeUrl.toString(),
      sourceTypes: ["browser"],
      instruction: input.instruction,
      successHints: ["Receipt markdown produced", "At least one screenshot"],
      tags: ["tabhandoff", "generated"],
      sourceHandoffId: input.id,
      createdAt: new Date().toISOString(),
    };
    await writeFile(cardPath, toYaml(card), "utf8");
    await writeFile(
      path.join(input.receiptDir, "job.json"),
      JSON.stringify(
        {
          id: input.id,
          url: safeUrl.toString(),
          instruction: input.instruction,
          note: input.note,
          mode: extraction.mode,
          actions,
          screenshotPaths,
          receiptPath,
          cardPath,
        },
        null,
        2,
      ),
      "utf8",
    );

    await pushAction(actions, input.onAction, "receipt", receiptPath, true);
    await context.close();

    return {
      ok: true,
      resultSummary: extraction.markdown.slice(0, 500),
      receiptPath,
      cardPath,
      screenshotPaths,
      actions,
      mode: extraction.mode,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pushAction(actions, input.onAction, "error", message, false);

    const receiptPath = path.join(input.receiptDir, "receipt.md");
    const cardPath = path.join(input.receiptDir, "card.yaml");
    const receiptMarkdown = renderReceipt({
      id: input.id,
      url: input.url,
      instruction: input.instruction,
      note: input.note,
      actions,
      resultMarkdown: `_Failed: ${message}_`,
      screenshotPaths,
      mode: "dom",
      status: "failed",
      error: message,
    });
    await writeFile(receiptPath, receiptMarkdown, "utf8").catch(() => undefined);
    await writeFile(
      cardPath,
      toYaml({
        schemaVersion: "0.1",
        name: `tabhandoff-failed-${input.id.slice(0, 8)}`,
        description: input.instruction.slice(0, 160),
        startUrl: input.url.startsWith("http") ? input.url : "https://example.com",
        sourceTypes: ["browser"],
        instruction: input.instruction,
        successHints: [],
        tags: ["tabhandoff", "failed"],
        sourceHandoffId: input.id,
        createdAt: new Date().toISOString(),
      } satisfies TaskCard),
      "utf8",
    ).catch(() => undefined);

    return {
      ok: false,
      resultSummary: message,
      receiptPath,
      cardPath,
      screenshotPaths,
      actions,
      error: message,
      mode: "dom",
    };
  }
}

function renderReceipt(opts: {
  id: string;
  url: string;
  instruction: string;
  note?: string;
  actions: HandoffAction[];
  resultMarkdown: string;
  screenshotPaths: string[];
  mode: "dom" | "llm";
  status: "succeeded" | "failed";
  error?: string;
}): string {
  const check = opts.status === "succeeded" ? "✅" : "❌";
  const lines = [
    `# TabHandoff Receipt ${check}`,
    ``,
    `> 🕊️ **Your AI was here. Now the next one can pick up.**`,
    `> Isolated browser · every action logged · no cookies/creds transferred · remix the Task Card.`,
    ``,
    `| | |`,
    `|---|---|`,
    `| **ID** | \`${opts.id}\` |`,
    `| **Status** | ${opts.status} |`,
    `| **URL** | ${opts.url} |`,
    `| **Mode** | \`${opts.mode}\` |`,
    `| **When** | ${new Date().toISOString()} |`,
    ``,
    `## Instruction`,
    opts.instruction,
    ``,
  ];
  if (opts.note) {
    lines.push(`## Note`, opts.note, ``);
  }
  if (opts.error) {
    lines.push(`## Error`, opts.error, ``);
  }
  lines.push(`## Actions`);
  for (const a of opts.actions) {
    lines.push(`- ${a.ok ? "✓" : "✗"} \`${a.tool}\` — ${a.detail} _(${a.at})_`);
  }
  lines.push(``, `## Screenshots`);
  for (const p of opts.screenshotPaths) {
    lines.push(`- \`${p}\``);
  }
  lines.push(``, `## Result`, ``, opts.resultMarkdown, ``);
  lines.push(
    `---`,
    `_TabHandoff v0.1 — the open handoff protocol for AI agents · MIT · no cookie clone_`,
    ``,
  );
  return lines.join("\n");
}

/** Tiny YAML serializer for Task Cards (no dep). */
function toYaml(card: TaskCard): string {
  const esc = (s: string) =>
    s.includes("\n") || /[:#{}[\],&*?|>!%@`]/.test(s)
      ? `|\n${s
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n")}`
      : JSON.stringify(s);

  const lines = [
    `schemaVersion: "0.1"`,
    `name: ${esc(card.name)}`,
    `description: ${esc(card.description ?? "")}`,
  ];
  if (card.startUrl) lines.push(`startUrl: ${esc(card.startUrl)}`);
  if (card.sourceTypes?.length) {
    lines.push(`sourceTypes:`);
    for (const t of card.sourceTypes) lines.push(`  - ${esc(t)}`);
  }
  lines.push(
    `instruction: ${esc(card.instruction)}`,
    `successHints:`,
    ...card.successHints.map((h) => `  - ${esc(h)}`),
    `tags:`,
    ...card.tags.map((t) => `  - ${esc(t)}`),
    `sourceHandoffId: ${esc(card.sourceHandoffId ?? "")}`,
    `createdAt: ${esc(card.createdAt)}`,
    ``,
  );
  return lines.join("\n");
}
