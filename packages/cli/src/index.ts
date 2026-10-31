#!/usr/bin/env node
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
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
  flags: Record<string, string | boolean | string[]>;
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
        const existing = out.flags[key];
        if (typeof existing === "string") {
          out.flags[key] = [existing, next];
        } else if (Array.isArray(existing)) {
          existing.push(next);
        } else {
          out.flags[key] = next;
        }
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

function flagList(args: Args, name: string): string[] {
  const v = args.flags[name];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v;
  return [];
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
  tabhandoff bridge [--port N]    Local loopback receiver for the browser extension

Job runner (isolated browser):
  tabhandoff run --url <url> --instruction <text> [--wait] [--note <text>]
  tabhandoff capture --url <url> [--note <text>] [--instruction <text>]
  tabhandoff status <id>
  tabhandoff receipt <id>

AI on captured context (no Playwright; key from env only):
  tabhandoff run-ai --instruction <text> [--url <url>] [--title <t>] [--selected <text>] [--context <file-or-text>] [--handoff <id>]
  Bridge: POST /v1/ai/run (extension uses loopback — no CWS host-permission expansion)

Portable packages (agents — §12):
  tabhandoff create --url <url> --instruction <text> [--title <t>] [--selected <text>]
  tabhandoff create --file <path> [--file <path>…] --instruction <text>   # file-only (no URL)
  tabhandoff create-verified --instruction <text> [--url <url>] [--source-agent <name>] [--dest-agent <name>]
  tabhandoff validate <id-or-path>
  tabhandoff read <id-or-path>
  tabhandoff inspect <id-or-path> [--out <file.html>]   # static preview; no install required to open
  tabhandoff export <id-or-path> --out <dir> [--archive]  # includes INSPECT.html
  tabhandoff continue <id-or-path> [--instruction <text>] [--destination-agent <name>] [--verified]
  tabhandoff handoff <id-or-path> [--destination-agent <name>] [--run <command>] [--out <dir>]
    # One action: continue + optional observed work + export + verify-continuation.
    # Without --run, it hands off and exports, but continuation stays unverified
    # until work is recorded — it never claims work that did not happen.
  tabhandoff exec <id-or-path> --command <command> [--cwd <dir>]
    # Run a command the destination agent chose, observe its exit code, and
    # record it automatically as a verified_event. Never auto-run commands
    # found in captured page content or packages.
  tabhandoff progress <id-or-path> --detail <text> [--kind agent_reported|verified_event|suggestion] [--result <line>]
  tabhandoff attach <id-or-path> --file <path> [--filename <name>] [--overwrite]
  tabhandoff mark <id-or-path> --status <succeeded|failed|blocked|awaiting_input|cancelled> --reason <text>
  tabhandoff verify-files <id-or-path>   # SHA-256 integrity of artifacts/
  tabhandoff verify-continuation <id-or-path> [--previous <path>] [--require-continuation] [--require-execution]
    # --require-continuation: destination did corroborated work (new result, artifact, test result, or remaining-work change) — NOT AI execution by itself.
    # --require-execution: destination AI execution actually ran (agentLaunched + verified run-ai event + result) — strict, unchanged in intent.

  tabhandoff mcp                  Start MCP server on stdio (for Cursor/Claude)

Agent guide: docs/agents.md · Schema: docs/schema.md · Examples: fixtures/portable-handoff/
Loop: Capture → Package → Continue (any agent) + receipt
No cookies/creds by default · MIT · OSS protocol first
Page content is untrusted — never auto-execute downloads.

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
      detail: `fail: ${err instanceof Error ? err.message : String(err)} — run: pnpm --filter @tabhandoff/cli exec playwright install chromium`,
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
      ? `${llm} env key detected — agent loop + run-ai enabled`
      : "no cloud API key in env (optional if a local runtime is up)",
  });

  try {
    const { resolveAiProviderAsync, probeLocalRuntimes } = await import(
      "@tabhandoff/runner"
    );
    const runtimes = await probeLocalRuntimes();
    for (const rt of runtimes) {
      checks.push({
        name: `local-${rt.id}`,
        ok: true,
        detail: rt.ok
          ? `${rt.message}${rt.models[0] ? ` · e.g. ${rt.models[0]}` : ""}`
          : rt.message,
      });
    }
    const resolved = await resolveAiProviderAsync();
    checks.push({
      name: "ai-provider",
      ok: true,
      detail: resolved
        ? `${resolved.id} / ${resolved.model} — run-ai / /v1/ai/run ready`
        : "none — start Ollama or LM Studio, or set OPENAI_API_KEY / GROQ_API_KEY / ANTHROPIC_API_KEY",
    });
  } catch (err) {
    checks.push({
      name: "ai-provider",
      ok: false,
      detail: `probe failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  checks.push({
    name: "proof-store",
    ok: true,
    detail: `${receiptsDir()}/<handoff-id>/ — receipt.md · screenshots · card.yaml (local only; not uploaded by default)`,
  });

  let failed = false;
  console.log(`🕊️ tabhandoff doctor\n`);
  for (const c of checks) {
    console.log(`${c.ok ? "✅" : "❌"} ${c.name}: ${c.detail}`);
    if (!c.ok && c.name !== "llm-key" && !c.name.startsWith("local-")) {
      failed = true;
    }
  }
  console.log(``);
  console.log(`Where's the proof? Local on this machine:`);
  console.log(`  ${receiptsDir()}/<handoff-id>/`);
  console.log(`  ├── receipt.md`);
  console.log(`  ├── card.yaml`);
  console.log(`  └── screenshots/`);
  console.log(`Nothing is uploaded to a cloud by default (self-host / privacy).`);
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
    const proofDir = job.receiptPath
      ? path.dirname(job.receiptPath)
      : path.join(receiptsDir(), job.id);
    console.log(``);
    console.log(`Where's the proof? (local — not uploaded by default)`);
    console.log(`  ${proofDir}/`);
    console.log(`  ├── receipt.md`);
    console.log(`  ├── card.yaml`);
    console.log(`  └── screenshots/`);
    console.log(`Open: tabhandoff receipt ${job.id}`);
    if (job.status !== "succeeded") process.exitCode = 1;
  } else {
    const job = await createAndQueue({ url, instruction, note });
    console.log(JSON.stringify({ id: job.id, status: job.status, receiptDir: job.receiptDir }, null, 2));
    console.log(`Poll: tabhandoff status ${job.id}`);
    console.log(`Proof will land at: ${job.receiptDir ?? path.join(receiptsDir(), job.id)}/`);
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

async function cmdRunAi(args: Args): Promise<void> {
  const { executeAiRun } = await import("@tabhandoff/bridge");
  const { resolveAiProviderAsync } = await import("@tabhandoff/runner");
  const instruction = flag(args, "instruction");
  if (!instruction) {
    console.error(
      "Usage: tabhandoff run-ai --instruction <text> [--url <url>] [--title <t>] [--selected <text>] [--context <file-or-text>] [--handoff <id>]",
    );
    process.exitCode = 1;
    return;
  }

  let pageText = flag(args, "context");
  if (pageText) {
    try {
      // Prefer file contents when --context points at an existing path
      pageText = await readFile(pageText, "utf8");
    } catch {
      /* treat flag value as literal context text */
    }
  }

  const provider = await resolveAiProviderAsync();
  if (!provider) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          status: "unavailable",
          provider: null,
          model: null,
          result: "",
          error: "no_api_key",
          message:
            "No AI provider configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY, or run Ollama locally — TabHandoff did not call a model.",
          apiKeyIncluded: false,
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
    return;
  }

  console.error(
    `🕊️ run-ai via ${provider.id} (${provider.model}) — credentials from env / local daemon only`,
  );
  const result = await executeAiRun({
    instruction,
    url: flag(args, "url"),
    title: flag(args, "title"),
    selectedText: flag(args, "selected"),
    pageText,
    handoffId: flag(args, "handoff"),
  });

  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        status: result.status,
        provider: result.provider,
        model: result.model,
        result: result.result,
        error: result.error,
        message: result.message,
        handoffId: result.handoffId,
        taskId: result.taskId,
        resultPath: result.resultPath,
        taskPath: result.taskPath,
        executionRecorded: result.executionRecorded ?? false,
        apiKeyIncluded: false,
      },
      null,
      2,
    ),
  );
  if (!result.ok) process.exitCode = result.status === "unavailable" ? 2 : 1;
}

async function cmdBridge(args: Args): Promise<void> {
  const {
    loadOrCreateBridgeConfig,
    configFileHint,
    startBridgeServer,
    BRIDGE_DEFAULT_PORT,
  } = await import("@tabhandoff/bridge");
  const home = tabHandoffHome();
  const portRaw = flag(args, "port");
  const port = portRaw ? Number(portRaw) : BRIDGE_DEFAULT_PORT;
  if (!Number.isFinite(port) || port <= 0 || port >= 65536) {
    console.error("Usage: tabhandoff bridge [--port 17432]");
    process.exitCode = 1;
    return;
  }
  const config = await loadOrCreateBridgeConfig({ home, port });
  console.log(`TabHandoff local bridge`);
  console.log(`  Home:   ${home}`);
  console.log(`  Listen: http://${config.host}:${config.port} (this computer only)`);
  console.log(`  Config: ${configFileHint(home)}`);
  console.log(``);
  console.log(`Paste this token into the TabHandoff extension settings:`);
  console.log(`  ${config.token}`);
  console.log(``);
  console.log(`Leave this running while you hand off tabs. Ctrl+C to stop.`);
  console.log(`Supported workflows run when the extension requests them (Phase 3).`);

  const server = await startBridgeServer({ config, home });
  await new Promise<void>((resolve) => {
    const stop = () => {
      void server.close().finally(() => resolve());
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

async function cmdCreate(args: Args): Promise<void> {
  const {
    createPortableHandoff,
    createFilePortableHandoff,
    PackageValidationError,
    PortableError,
  } = await import("@tabhandoff/bridge");
  const url = flag(args, "url");
  const files = flagList(args, "file");
  const instruction = flag(args, "instruction");
  if (!instruction || (!url && files.length === 0)) {
    console.error(
      "Usage:\n  tabhandoff create --url <url> --instruction <text> [--title <t>] [--selected <text>] [--outcome <text>]\n  tabhandoff create --file <path> [--file <path>…] --instruction <text> [--outcome <text>]",
    );
    process.exitCode = 1;
    return;
  }
  if (url && files.length > 0) {
    console.error(
      "Pass either --url (browser) or --file (file handoff), not both in MVP.",
    );
    process.exitCode = 1;
    return;
  }
  try {
    if (files.length > 0) {
      const { readFile, stat } = await import("node:fs/promises");
      const fileInputs = [];
      for (const p of files) {
        const absolutePath = path.resolve(p);
        const st = await stat(absolutePath);
        if (!st.isFile()) {
          throw new Error(`Not a file: ${absolutePath}`);
        }
        const bytes = await readFile(absolutePath);
        fileInputs.push({
          absolutePath,
          bytes,
          displayPath: absolutePath,
        });
      }
      const stored = await createFilePortableHandoff({
        files: fileInputs,
        instruction,
        intendedOutcome: flag(args, "outcome"),
        source: { kind: "cli" },
      });
      const fileSources = (stored.package.sources ?? []).filter(
        (s) => s.type === "file",
      );
      console.log(
        JSON.stringify(
          {
            id: stored.id,
            status: stored.executionStatus,
            agentLaunched: stored.agentLaunched,
            receiptDir: stored.receiptDir,
            handoffPath: stored.handoffPath,
            files: fileSources.map((s) =>
              s.type === "file"
                ? {
                    filename: s.filename,
                    byteSize: s.byteSize,
                    sha256: s.sha256,
                    contentStatus: s.contentStatus,
                  }
                : null,
            ),
            hint:
              "File package created only — no agent was launched. Office/PDF attachments are attached, not analyzed. Validate with: tabhandoff validate " +
              stored.id,
          },
          null,
          2,
        ),
      );
      return;
    }

    const stored = await createPortableHandoff({
      url: url!,
      instruction,
      title: flag(args, "title"),
      selectedText: flag(args, "selected"),
      intendedOutcome: flag(args, "outcome"),
      source: { kind: "cli" },
    });
    console.log(
      JSON.stringify(
        {
          id: stored.id,
          status: stored.executionStatus,
          agentLaunched: stored.agentLaunched,
          receiptDir: stored.receiptDir,
          handoffPath: stored.handoffPath,
          hint: "Package created only — no agent was launched. Validate with: tabhandoff validate " +
            stored.id,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    if (
      err instanceof PortableError ||
      err instanceof PackageValidationError
    ) {
      process.exitCode = 1;
    } else process.exitCode = 1;
  }
}

async function cmdVerifyFiles(args: Args): Promise<void> {
  const { verifyFileArtifactIntegrity, PortableError } = await import(
    "@tabhandoff/bridge"
  );
  const target = args._[1];
  if (!target) {
    console.error("Usage: tabhandoff verify-files <id-or-path>");
    process.exitCode = 1;
    return;
  }
  try {
    const result = await verifyFileArtifactIntegrity(target);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    if (err instanceof PortableError) process.exitCode = 1;
  }
}

async function cmdCreateVerified(args: Args): Promise<void> {
  const { createVerifiedHandoff, PortableError } = await import(
    "@tabhandoff/bridge"
  );
  const instruction = flag(args, "instruction");
  if (!instruction) {
    console.error(
      "Usage: tabhandoff create-verified --instruction <text> [--url <url>] [--title <t>] [--selected <text>] [--source-agent <name>] [--dest-agent <name>] [--outcome <text>]",
    );
    process.exitCode = 1;
    return;
  }
  try {
    const sourceName = flag(args, "source-agent") ?? "cli-agent-a";
    const destName = flag(args, "dest-agent");
    const stored = await createVerifiedHandoff({
      instruction,
      url: flag(args, "url"),
      title: flag(args, "title"),
      selectedText: flag(args, "selected"),
      note: flag(args, "note"),
      intendedOutcome: flag(args, "outcome"),
      acceptanceCriteria: flagList(args, "accept"),
      sourceIdentity: {
        name: sourceName,
        interface: "cli",
        tool: "tabhandoff create-verified",
      },
      destinationIdentity: destName
        ? { name: destName, interface: "cli", tool: "tabhandoff continue" }
        : { name: "cli-agent-b", interface: "mcp", tool: "handoff_read" },
    });
    console.log(
      JSON.stringify(
        {
          id: stored.id,
          schemaVersion: stored.package.schemaVersion,
          status: stored.executionStatus,
          agentLaunched: stored.agentLaunched,
          receiptDir: stored.receiptDir,
          handoffPath: stored.handoffPath,
          hint: "Verified package created (0.2) — no agent launched. Export, inspect, then continue in destination agent.",
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    if (err instanceof PortableError) return;
  }
}

async function cmdInspect(args: Args): Promise<void> {
  const { writeInspectHtml, PortableError } = await import("@tabhandoff/bridge");
  const target = args._[1];
  if (!target) {
    console.error("Usage: tabhandoff inspect <id-or-path> [--out <file.html>]");
    process.exitCode = 1;
    return;
  }
  try {
    const result = await writeInspectHtml(target, {
      outPath: flag(args, "out"),
    });
    console.log(
      JSON.stringify(
        {
          id: result.id,
          htmlPath: result.htmlPath,
          packagePath: result.packagePath,
          hint: "Open the HTML in any browser — no TabHandoff install required to inspect. No credentials embedded.",
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    if (err instanceof PortableError) return;
  }
}

async function cmdVerifyContinuation(args: Args): Promise<void> {
  const { verifyContinuation, evaluateContinuationBaseline, PortableError } =
    await import("@tabhandoff/bridge");
  const { readHandoffPackage } = await import("@tabhandoff/bridge");
  const target = args._[1];
  if (!target) {
    console.error(
      "Usage: tabhandoff verify-continuation <id-or-path> [--previous <path>] [--require-continuation] [--require-execution] [--expected <substring>]",
    );
    process.exitCode = 1;
    return;
  }
  try {
    const report = await verifyContinuation(target, {
      previousPath: flag(args, "previous"),
      requireDestinationExecution: bool(args, "require-execution"),
      requireContinuation: bool(args, "require-continuation"),
    });
    const { package: pkg } = await readHandoffPackage(target);
    const baseline = evaluateContinuationBaseline(pkg, report, {
      expectedSubstring: flag(args, "expected"),
    });
    console.log(JSON.stringify({ report, baseline }, null, 2));
    if (report.outcome === "fail") process.exitCode = 1;
    if (
      report.outcome === "unverified" &&
      (bool(args, "require-execution") || bool(args, "require-continuation"))
    ) {
      process.exitCode = 2;
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    if (err instanceof PortableError) return;
  }
}

async function cmdValidate(args: Args): Promise<void> {
  const { validateHandoffTarget, PortableError } = await import(
    "@tabhandoff/bridge"
  );
  const target = args._[1];
  if (!target) {
    console.error("Usage: tabhandoff validate <id-or-path>");
    process.exitCode = 1;
    return;
  }
  try {
    const result = await validateHandoffTarget(target);
    console.log(
      JSON.stringify(
        {
          ok: true,
          id: result.package.id,
          schemaVersion: result.package.schemaVersion,
          dir: result.dir,
          status: result.package.execution.status,
          agentLaunched: result.package.execution.agentLaunched,
          screenshotCount: result.package.screenshots.length,
          hashNote: result.hashNote,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: err instanceof PortableError ? err.code : undefined,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

async function cmdReadPackage(args: Args): Promise<void> {
  const { readHandoffPackage, summarizePackageForAgent, PortableError } =
    await import("@tabhandoff/bridge");
  const target = args._[1];
  if (!target) {
    console.error("Usage: tabhandoff read <id-or-path>");
    process.exitCode = 1;
    return;
  }
  try {
    const { dir, package: pkg } = await readHandoffPackage(target);
    console.log(
      JSON.stringify({ dir, ...summarizePackageForAgent(pkg) }, null, 2),
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    if (err instanceof PortableError) return;
  }
}

async function cmdExport(args: Args): Promise<void> {
  const { exportHandoffPackage, PortableError } = await import(
    "@tabhandoff/bridge"
  );
  const target = args._[1];
  const out = flag(args, "out");
  if (!target || !out) {
    console.error(
      "Usage: tabhandoff export <id-or-path> --out <dir> [--archive]",
    );
    process.exitCode = 1;
    return;
  }
  try {
    const result = await exportHandoffPackage({
      target,
      outDir: out,
      archive: bool(args, "archive"),
    });
    console.log(
      JSON.stringify(
        {
          id: result.id,
          folderPath: result.folderPath,
          archivePath: result.archivePath,
          files: result.files,
          hashNote: result.hashNote,
          manualCopy:
            "Unsupported agents: copy the exported folder (or unpack the .tar.gz) and open handoff.json.",
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    if (err instanceof PortableError) return;
  }
}

async function cmdContinue(args: Args): Promise<void> {
  const { continueHandoff, PortableError } = await import("@tabhandoff/bridge");
  const target = args._[1];
  if (!target) {
    console.error(
      "Usage: tabhandoff continue <id-or-path> [--instruction <text>] [--outcome <text>]",
    );
    process.exitCode = 1;
    return;
  }
  try {
    const destAgent = flag(args, "destination-agent");
    const result = await continueHandoff({
      target,
      instruction: flag(args, "instruction"),
      intendedOutcome: flag(args, "outcome"),
      sourceAgent: flag(args, "source-agent"),
      destinationAgent: destAgent,
      verified: bool(args, "verified"),
      destinationIdentity: destAgent
        ? {
            name: destAgent,
            interface: "cli",
            tool: "tabhandoff continue",
          }
        : undefined,
    });
    console.log(
      JSON.stringify(
        {
          id: result.id,
          previousHandoffId: result.previousId,
          schemaVersion: result.package.schemaVersion,
          status: result.executionStatus,
          agentLaunched: result.agentLaunched,
          receiptDir: result.receiptDir,
          handoffPath: result.handoffPath,
          hint: "Successor package created — prior evidence stays in the previous package. No agent was launched. Creating a successor is NOT successful continuation; destination must execute work, then verify-continuation.",
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    if (err instanceof PortableError) return;
  }
}

type ObservedCommand = {
  exitCode: number;
  output: string;
};

async function runObservedCommand(
  command: string,
  cwd?: string,
): Promise<ObservedCommand> {
  try {
    const { stdout, stderr } = await execFileAsync(command, {
      shell: "/bin/sh",
      cwd: cwd ? path.resolve(cwd) : undefined,
      maxBuffer: 1024 * 1024,
    });
    return { exitCode: 0, output: `${stdout}${stderr}`.slice(0, 2000) };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: typeof e.code === "number" ? e.code : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`.slice(0, 2000),
    };
  }
}

async function cmdExec(args: Args): Promise<void> {
  const target = args._[1];
  const command = flag(args, "command");
  if (!target || !command) {
    console.error(
      "Usage: tabhandoff exec <id-or-path> --command <command> [--cwd <dir>]",
    );
    process.exitCode = 1;
    return;
  }
  try {
    const { appendProgress, PortableError } = await import(
      "@tabhandoff/bridge"
    );
    const observed = await runObservedCommand(command, flag(args, "cwd"));
    const resultLine = `${command} exit ${observed.exitCode}`;
    const pkg = await appendProgress({
      target,
      detail: `Ran command: ${command} (exit ${observed.exitCode})`,
      kind: "verified_event",
      tool: "tabhandoff.exec",
      ok: observed.exitCode === 0,
      resultLine,
    });
    console.log(
      JSON.stringify(
        {
          id: pkg.id,
          command,
          exitCode: observed.exitCode,
          resultLine,
          output: observed.output,
          note: "Recorded as verified_event because TabHandoff observed the command exit code — it does not claim the work was correct, only that this command ran with this exit code.",
        },
        null,
        2,
      ),
    );
    process.exitCode = observed.exitCode;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    if (err instanceof Error && "code" in err) return;
  }
}

async function cmdHandoff(args: Args): Promise<void> {
  const target = args._[1];
  if (!target) {
    console.error(
      "Usage: tabhandoff handoff <id-or-path> [--destination-agent <name>] [--run <command>] [--out <dir>]",
    );
    process.exitCode = 1;
    return;
  }
  try {
    const {
      continueHandoff,
      appendProgress,
      exportHandoffPackage,
      verifyContinuation,
      PortableError,
    } = await import("@tabhandoff/bridge");
    const destAgent = flag(args, "destination-agent");
    const continued = await continueHandoff({
      target,
      destinationAgent: destAgent,
      verified: true,
      destinationIdentity: destAgent
        ? { name: destAgent, interface: "cli", tool: "tabhandoff handoff" }
        : undefined,
    });
    const successorId = continued.id;
    let commandResult: ObservedCommand | undefined;
    if (flag(args, "run")) {
      const command = flag(args, "run")!;
      commandResult = await runObservedCommand(command, flag(args, "cwd"));
      await appendProgress({
        target: successorId,
        detail: `Ran command: ${command} (exit ${commandResult.exitCode})`,
        kind: "verified_event",
        tool: "tabhandoff.exec",
        ok: commandResult.exitCode === 0,
        resultLine: `${command} exit ${commandResult.exitCode}`,
      });
    }
    const outDir = flag(args, "out") ?? "exports";
    const exported = await exportHandoffPackage({
      target: successorId,
      outDir,
    });
    const report = await verifyContinuation(successorId, {
      previousPath: target,
      requireContinuation: true,
    });
    const plainStatus =
      report.outcome === "pass"
        ? "continued"
        : report.outcome === "fail"
          ? "not_verified"
          : "unverified";
    console.log(
      JSON.stringify(
        {
          previousHandoffId: target,
          successorId,
          destinationAgent: destAgent ?? null,
          command: flag(args, "run") ?? null,
          commandExitCode: commandResult?.exitCode ?? null,
          exportFolder: exported.folderPath,
          verification: plainStatus,
          verificationOutcome: report.outcome,
          note: commandResult
            ? "Continuation verified only if the run produced a corroborated result line. Execution (a real AI run) is not claimed here."
            : "Handed off and exported, but no work was recorded in this action, so continuation is not verified yet. Run work with tabhandoff exec, then verify again.",
        },
        null,
        2,
      ),
    );
    if (report.outcome === "fail") process.exitCode = 1;
    if (report.outcome === "unverified") process.exitCode = 2;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    if (err instanceof Error && "code" in err) return;
  }
}

async function cmdProgress(args: Args): Promise<void> {
  const { appendProgress, PortableError } = await import("@tabhandoff/bridge");
  const target = args._[1];
  const detail = flag(args, "detail");
  if (!target || !detail) {
    console.error(
      "Usage: tabhandoff progress <id-or-path> --detail <text> [--kind agent_reported|verified_event|suggestion] [--result <line>]",
    );
    process.exitCode = 1;
    return;
  }
  const kindRaw = flag(args, "kind") ?? "agent_reported";
  if (
    kindRaw !== "agent_reported" &&
    kindRaw !== "verified_event" &&
    kindRaw !== "suggestion"
  ) {
    console.error("Invalid --kind");
    process.exitCode = 1;
    return;
  }
  try {
    const pkg = await appendProgress({
      target,
      detail,
      kind: kindRaw,
      resultLine: flag(args, "result"),
      tool: flag(args, "tool"),
    });
    console.log(
      JSON.stringify(
        {
          id: pkg.id,
          status: pkg.execution.status,
          eventCount: pkg.execution.events.length,
          lastEvent: pkg.execution.events.at(-1),
          note:
            kindRaw === "verified_event"
              ? "Recorded as verified_event — only use when TabHandoff or your integration actually observed the action."
              : "Recorded as agent_reported (default) — not independently verified.",
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    if (err instanceof PortableError) return;
  }
}

async function cmdAttach(args: Args): Promise<void> {
  const { attachEvidence, PortableError } = await import("@tabhandoff/bridge");
  const target = args._[1];
  const file = flag(args, "file");
  if (!target || !file) {
    console.error(
      "Usage: tabhandoff attach <id-or-path> --file <path> [--filename <name>] [--overwrite]",
    );
    process.exitCode = 1;
    return;
  }
  try {
    const pkg = await attachEvidence({
      target,
      filePath: file,
      filename: flag(args, "filename"),
      overwrite: bool(args, "overwrite"),
    });
    console.log(
      JSON.stringify(
        {
          id: pkg.id,
          screenshots: pkg.screenshots,
          lastEvent: pkg.execution.events.at(-1),
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    if (err instanceof PortableError) return;
  }
}

async function cmdMark(args: Args): Promise<void> {
  const { markExecutionStatus, PortableError } = await import(
    "@tabhandoff/bridge"
  );
  const target = args._[1];
  const status = flag(args, "status");
  const reason = flag(args, "reason");
  if (!target || !status || !reason) {
    console.error(
      "Usage: tabhandoff mark <id-or-path> --status <succeeded|failed|blocked|awaiting_input|cancelled> --reason <text> [--kind agent_reported|verified_event]",
    );
    process.exitCode = 1;
    return;
  }
  const allowed = [
    "succeeded",
    "failed",
    "blocked",
    "awaiting_input",
    "cancelled",
  ] as const;
  if (!(allowed as readonly string[]).includes(status)) {
    console.error(`Invalid --status. Allowed: ${allowed.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const kindRaw = flag(args, "kind") ?? "agent_reported";
  if (kindRaw !== "agent_reported" && kindRaw !== "verified_event") {
    console.error("Invalid --kind (use agent_reported or verified_event)");
    process.exitCode = 1;
    return;
  }
  try {
    const pkg = await markExecutionStatus({
      target,
      status: status as (typeof allowed)[number],
      reason,
      kind: kindRaw,
    });
    console.log(
      JSON.stringify(
        {
          id: pkg.id,
          status: pkg.execution.status,
          lastEvent: pkg.execution.events.at(-1),
          note:
            kindRaw === "verified_event"
              ? "Status justified by verified_event."
              : "Status justified by agent_reported event — not independently verified.",
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    if (err instanceof PortableError) return;
  }
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
    case "run-ai":
      await cmdRunAi(args);
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
    case "create":
      await cmdCreate(args);
      break;
    case "create-verified":
      await cmdCreateVerified(args);
      break;
    case "validate":
      await cmdValidate(args);
      break;
    case "read":
      await cmdReadPackage(args);
      break;
    case "inspect":
      await cmdInspect(args);
      break;
    case "export":
      await cmdExport(args);
      break;
    case "continue":
      await cmdContinue(args);
      break;
    case "handoff":
      await cmdHandoff(args);
      break;
    case "exec":
      await cmdExec(args);
      break;
    case "progress":
      await cmdProgress(args);
      break;
    case "attach":
      await cmdAttach(args);
      break;
    case "mark":
      await cmdMark(args);
      break;
    case "verify-files":
      await cmdVerifyFiles(args);
      break;
    case "verify-continuation":
      await cmdVerifyContinuation(args);
      break;
    case "mcp":
      await cmdMcp();
      break;
    case "bridge":
      await cmdBridge(args);
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
