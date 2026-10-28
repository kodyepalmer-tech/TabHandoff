#!/usr/bin/env node
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAndWait,
  createAndQueue,
  getStatus,
  tabHandoffHome,
  configPath,
  receiptsDir,
} from "@tabhandoff/mcp";
import { detectLlmProvider, closeSharedBrowser } from "@tabhandoff/runner";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

type Args = {
  _: string[];
  flags: Record<string, string | boolean>;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        out.flags[key] = true;
      } else {
        out.flags[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function flag(args: Args, name: string): string | undefined {
  const v = args.flags[name];
  return typeof v === "string" ? v : undefined;
}

function bool(args: Args, name: string): boolean {
  return args.flags[name] === true;
}

async function cmdHelp(): Promise<void> {
  console.log(`🕊️ TabHandoff — the open handoff protocol for AI agents
Your AI was here. Now the next one can pick up.

Usage:
  tabhandoff init                 Prepare ~/.tabhandoff + print MCP client snippets
  tabhandoff doctor               Check Node, Playwright, store, optional LLM keys
  tabhandoff run --url <url> --instruction <text> [--wait] [--note <text>]
  tabhandoff capture --url <url> [--note <text>] [--instruction <text>]
  tabhandoff status <id>
  tabhandoff receipt <id>
  tabhandoff mcp                  Start MCP server on stdio (for Cursor/Claude)

Loop: Capture → Package → Continue (any agent) + receipt
No cookies/creds by default · MIT · OSS protocol first

One-liner (stranger install):
  curl -fsSL https://raw.githubusercontent.com/kodyepalmer-tech/TabHandoff/main/scripts/install.sh | bash
`);
}

async function cmdInit(): Promise<void> {
  const home = tabHandoffHome();
  await mkdir(home, { recursive: true });
  await mkdir(receiptsDir(), { recursive: true });

  const cfg = {
    version: "0.1.0",
    createdAt: new Date().toISOString(),
    mcpCommand: "node",
    mcpArgs: [path.join(repoRoot, "packages/mcp/dist/stdio.js")],
  };
  await writeFile(configPath(), JSON.stringify(cfg, null, 2), "utf8");

  const mcpEntry = path.join(repoRoot, "packages/mcp/dist/stdio.js");
  console.log(`✅ tabhandoff home ready: ${home}`);
  console.log(`✅ Config written: ${configPath()}`);
  console.log(``);
  console.log(`Add this MCP server to your client (stdio):`);
  console.log(``);
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          tabhandoff: {
            command: "node",
            args: [mcpEntry],
          },
        },
      },
      null,
      2,
    ),
  );
  console.log(``);
  console.log(`Snippets also in: ${path.join(repoRoot, "docs/clients/")}`);
  console.log(`Next: tabhandoff doctor && tabhandoff run --url https://example.com --instruction "Extract the main heading" --wait`);
}

async function cmdDoctor(): Promise<void> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  checks.push({
    name: "node",
    ok: Number(process.versions.node.split(".")[0]) >= 22,
    detail: `v${process.versions.node}`,
  });

  try {
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    await browser.close();
    checks.push({ name: "playwright-chromium", ok: true, detail: "launches" });
  } catch (err) {
    checks.push({
      name: "playwright-chromium",
      ok: false,
      detail: `fail: ${err instanceof Error ? err.message : String(err)} — run: pnpm exec playwright install chromium`,
    });
  }

  const home = tabHandoffHome();
  try {
    await mkdir(home, { recursive: true });
    await access(home);
    checks.push({ name: "tabhandoff-home", ok: true, detail: home });
  } catch {
    checks.push({ name: "tabhandoff-home", ok: false, detail: home });
  }

  const mcpDist = path.join(repoRoot, "packages/mcp/dist/stdio.js");
  try {
    await access(mcpDist);
    checks.push({ name: "mcp-build", ok: true, detail: mcpDist });
  } catch {
    checks.push({
      name: "mcp-build",
      ok: false,
      detail: `missing ${mcpDist} — run pnpm build`,
    });
  }

  const llm = detectLlmProvider();
  checks.push({
    name: "llm-key",
    ok: true,
    detail: llm
      ? `${llm} detected — agent loop enabled`
      : "none — DOM extractor only (fine for v0.1 public extracts)",
  });

  let failed = false;
  console.log(`🕊️ tabhandoff doctor\n`);
  for (const c of checks) {
    console.log(`${c.ok ? "✅" : "❌"} ${c.name}: ${c.detail}`);
    if (!c.ok && c.name !== "llm-key") failed = true;
  }
  if (failed) process.exitCode = 1;
}

async function cmdRun(args: Args): Promise<void> {
  const url = flag(args, "url");
  const instruction = flag(args, "instruction");
  const note = flag(args, "note");
  const wait = bool(args, "wait");
  if (!url || !instruction) {
    console.error("Usage: tabhandoff run --url <url> --instruction <text> [--wait] [--note <text>]");
    process.exitCode = 1;
    return;
  }

  console.log(`🕊️ Creating handoff…`);
  if (wait) {
    const job = await createAndWait({ url, instruction, note });
    console.log(JSON.stringify({
      id: job.id,
      status: job.status,
      receiptPath: job.receiptPath,
      cardPath: job.cardPath,
      screenshotPaths: job.screenshotPaths,
      error: job.error,
      resultSummary: job.resultSummary?.slice(0, 300),
    }, null, 2));
    if (job.status !== "succeeded") process.exitCode = 1;
  } else {
    const job = await createAndQueue({ url, instruction, note });
    console.log(JSON.stringify({ id: job.id, status: job.status, receiptDir: job.receiptDir }, null, 2));
    console.log(`Poll: tabhandoff status ${job.id}`);
  }
  await closeSharedBrowser();
}

async function cmdCapture(args: Args): Promise<void> {
  const url = flag(args, "url");
  const note = flag(args, "note");
  const instruction =
    flag(args, "instruction") ||
    "Capture the page: extract main heading, first paragraph, and a short outline of headings as markdown.";
  if (!url) {
    console.error("Usage: tabhandoff capture --url <url> [--note <text>] [--instruction <text>]");
    process.exitCode = 1;
    return;
  }
  // Capture path = create job with default extract instruction, wait for receipt
  args.flags.instruction = instruction;
  if (note) args.flags.note = note;
  args.flags.wait = true;
  await cmdRun(args);
}

async function cmdStatus(args: Args): Promise<void> {
  const id = args._[1];
  if (!id) {
    console.error("Usage: tabhandoff status <id>");
    process.exitCode = 1;
    return;
  }
  const job = await getStatus(id);
  if (!job) {
    console.error(`Unknown id: ${id}`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(job, null, 2));
}

async function cmdReceipt(args: Args): Promise<void> {
  const id = args._[1];
  if (!id) {
    console.error("Usage: tabhandoff receipt <id>");
    process.exitCode = 1;
    return;
  }
  const job = await getStatus(id);
  if (!job) {
    console.error(`Unknown id: ${id}`);
    process.exitCode = 1;
    return;
  }
  if (job.receiptPath) {
    try {
      const md = await readFile(job.receiptPath, "utf8");
      console.log(md);
      return;
    } catch {
      /* fall through */
    }
  }
  console.log(JSON.stringify({
    id: job.id,
    status: job.status,
    receiptPath: job.receiptPath,
    cardPath: job.cardPath,
    screenshotPaths: job.screenshotPaths,
    error: job.error,
  }, null, 2));
}

async function cmdMcp(): Promise<void> {
  const { pathToFileURL } = await import("node:url");
  const entry = path.join(repoRoot, "packages/mcp/dist/stdio.js");
  await import(pathToFileURL(entry).href);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] ?? "help";
  switch (cmd) {
    case "help":
    case "-h":
    case "--help":
      await cmdHelp();
      break;
    case "init":
      await cmdInit();
      break;
    case "doctor":
      await cmdDoctor();
      break;
    case "run":
      await cmdRun(args);
      break;
    case "capture":
      await cmdCapture(args);
      break;
    case "status":
      await cmdStatus(args);
      break;
    case "receipt":
      await cmdReceipt(args);
      break;
    case "mcp":
      await cmdMcp();
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      await cmdHelp();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
