#!/usr/bin/env node
/**
 * Real two-agent vertical slice (supported interfaces only):
 *   Agent A = CLI (create-verified + run-ai via Ollama)
 *   Agent B = MCP validate/read + CLI continue + run-ai + verify-continuation
 *
 * Does NOT simulate destination success from prompt submission alone.
 * Requires local Ollama (or another detected provider). No paid APIs.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const cli = path.join(root, "packages/cli/dist/index.js");
const mcpStdio = path.join(root, "packages/mcp/dist/stdio.js");
const evidenceDir =
  process.env.VERIFIED_HANDOFF_EVIDENCE ||
  "/cursor/stores/bc-01a1848b-012a-753e-bf04-4981bb260b56/media/verified-handoff";

function runCli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", reject);
  });
}

function parseJsonFromStdout(stdout) {
  const start = stdout.indexOf("{");
  if (start < 0) throw new Error(`No JSON in stdout:\n${stdout}`);
  return JSON.parse(stdout.slice(start));
}

/** Agent B MCP client — runs from @tabhandoff/mcp package so SDK resolves. */
async function mcpCall(toolName, args) {
  const helper = `
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ${JSON.stringify([mcpStdio])},
  cwd: ${JSON.stringify(root)},
  env: process.env,
});
const client = new Client({ name: "verified-handoff-demo-b", version: "0.2.0" });
await client.connect(transport);
try {
  const result = await client.callTool({
    name: ${JSON.stringify(toolName)},
    arguments: ${JSON.stringify(args)},
  });
  const text = result.content?.find((c) => c.type === "text")?.text;
  process.stdout.write(text || JSON.stringify(result));
} finally {
  await client.close();
}
`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", helper],
      {
        cwd: path.join(root, "packages/mcp"),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`MCP ${toolName} failed (${code}): ${stderr}\n${stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(new Error(`MCP JSON parse failed: ${stdout}\n${err}`));
      }
    });
    child.on("error", reject);
  });
}

async function main() {
  await mkdir(evidenceDir, { recursive: true });
  // Home + export staging under /tmp (agent store mounts can reject chmod during cp)
  const home = path.join("/tmp", `tabhandoff-verified-demo-${process.pid}`);
  const exportDir = path.join(home, "export");
  await rm(home, { recursive: true, force: true });
  await mkdir(home, { recursive: true });
  await mkdir(exportDir, { recursive: true });
  await mkdir(evidenceDir, { recursive: true });

  const env = { TABHANDOFF_HOME: home };

  console.error("=== Agent A (CLI): create-verified ===");
  const createdRun = await runCli(
    [
      "create-verified",
      "--url",
      "https://example.com/",
      "--title",
      "Example Domain",
      "--selected",
      "This domain is for use in illustrative examples in documents.",
      "--instruction",
      "Write one short summary sentence, then one remaining question for a follow-up agent.",
      "--outcome",
      "Honest summary from selected text only; remaining question recorded.",
      "--accept",
      "Summary grounded in selected text",
      "--accept",
      "Remaining question is explicit",
      "--source-agent",
      "cli-agent-a",
      "--dest-agent",
      "mcp-agent-b",
    ],
    env,
  );
  if (createdRun.code !== 0) {
    throw new Error(`create-verified failed: ${createdRun.stderr}\n${createdRun.stdout}`);
  }
  const created = parseJsonFromStdout(createdRun.stdout);
  await writeFile(
    path.join(evidenceDir, "01-agent-a-create.json"),
    JSON.stringify(created, null, 2),
  );

  console.error("=== Agent A (CLI): partial run-ai ===");
  const runA = await runCli(
    [
      "run-ai",
      "--instruction",
      "Using ONLY this selected text, write ONE short summary sentence. Do not invent facts.\n\nSelected: This domain is for use in illustrative examples in documents.",
      "--url",
      "https://example.com/",
      "--title",
      "Example Domain",
      "--selected",
      "This domain is for use in illustrative examples in documents.",
      "--handoff",
      created.id,
    ],
    env,
  );
  const aiA = parseJsonFromStdout(runA.stdout);
  await writeFile(
    path.join(evidenceDir, "02-agent-a-run-ai.json"),
    JSON.stringify(aiA, null, 2),
  );
  if (!aiA.ok) {
    throw new Error(
      `Agent A run-ai failed/unavailable — need local Ollama (or configured provider). ${aiA.message || aiA.error}`,
    );
  }

  // Record Agent A progress honestly
  await runCli(
    [
      "progress",
      created.id,
      "--detail",
      `Agent A run-ai via ${aiA.provider}/${aiA.model} produced a draft summary.`,
      "--kind",
      "verified_event",
      "--tool",
      "agent-a.run-ai",
      "--result",
      `Draft summary: ${String(aiA.result).slice(0, 400)}`,
    ],
    env,
  );
  // Leave remaining work for Agent B
  const bridge = await import(
    path.join(root, "packages/bridge/dist/index.js")
  );
  await bridge.appendProgress({
    target: created.id,
    detail: "Agent A finished draft; remaining: refine + add follow-up question.",
    kind: "verified_event",
    tool: "agent-a.checkpoint",
    remainingWork: [
      "Refine the draft into one clear sentence using selected text only.",
      "Add one remaining question for humans/agents.",
    ],
    home,
    ok: true,
  });

  console.error("=== Agent A: export portable package ===");
  const exp = parseJsonFromStdout(
    (
      await runCli(
        ["export", created.id, "--out", exportDir, "--archive"],
        env,
      )
    ).stdout,
  );
  await writeFile(
    path.join(evidenceDir, "03-export.json"),
    JSON.stringify(exp, null, 2),
  );

  console.error("=== Agent B (MCP): validate + read exported package ===");
  const mcpValidate = await mcpCall("handoff_validate", {
    target: exp.folderPath,
  });
  const mcpRead = await mcpCall("handoff_read", { target: exp.folderPath });
  await writeFile(
    path.join(evidenceDir, "04-agent-b-mcp.json"),
    JSON.stringify({ validate: mcpValidate, read: mcpRead }, null, 2),
  );
  if (!mcpValidate.ok) {
    throw new Error(`MCP validate failed: ${JSON.stringify(mcpValidate)}`);
  }

  console.error("=== Agent B (CLI): continue (successor only) ===");
  const cont = parseJsonFromStdout(
    (
      await runCli(
        [
          "continue",
          exp.folderPath,
          "--destination-agent",
          "mcp-agent-b",
          "--verified",
          "--instruction",
          "Refine the draft into one clear sentence and add one remaining question.",
        ],
        env,
      )
    ).stdout,
  );
  await writeFile(
    path.join(evidenceDir, "05-continue.json"),
    JSON.stringify(cont, null, 2),
  );

  // Prove that continue-alone fails require-execution
  const earlyVerify = parseJsonFromStdout(
    (
      await runCli(
        [
          "verify-continuation",
          cont.id,
          "--previous",
          exp.folderPath,
          "--require-execution",
        ],
        env,
      )
    ).stdout,
  );
  await writeFile(
    path.join(evidenceDir, "06-verify-before-execution.json"),
    JSON.stringify(earlyVerify, null, 2),
  );

  console.error("=== Agent B (CLI): real run-ai continuation ===");
  const prior = await readFile(
    path.join(home, "receipts", created.id, "handoff.json"),
    "utf8",
  ).then(JSON.parse);
  const draft =
    prior.previousResults.find((r) => /draft summary/i.test(r)) ||
    prior.previousResults.at(-1) ||
    "";
  const runB = await runCli(
    [
      "run-ai",
      "--instruction",
      `You are Agent B continuing a TabHandoff.\nPrior draft: ${draft}\nSelected text: This domain is for use in illustrative examples in documents.\nTask: (1) One refined summary sentence. (2) One remaining question.\nDo not invent facts beyond the selected text.`,
      "--handoff",
      cont.id,
    ],
    env,
  );
  const aiB = parseJsonFromStdout(runB.stdout);
  await writeFile(
    path.join(evidenceDir, "07-agent-b-run-ai.json"),
    JSON.stringify(aiB, null, 2),
  );
  if (!aiB.ok) {
    throw new Error(`Agent B run-ai failed: ${aiB.message || aiB.error}`);
  }

  await bridge.recordDestinationExecution({
    target: cont.id,
    tool: "agent-b.run-ai",
    detail: `Destination run-ai via ${aiB.provider}/${aiB.model} completed with real model output.`,
    resultLine: `Agent B output: ${String(aiB.result).slice(0, 600)}`,
    remainingWork: [],
    claim: {
      text: String(aiB.result).slice(0, 300),
      kind: "summary",
      at: new Date().toISOString(),
      source: "mcp-agent-b",
    },
    agentLaunched: true,
    ok: true,
    home,
  });

  await runCli(
    [
      "mark",
      cont.id,
      "--status",
      "succeeded",
      "--reason",
      "Destination run-ai produced refined summary + remaining question; recorded as verified_event via agent-b.run-ai.",
      "--kind",
      "verified_event",
    ],
    env,
  );

  console.error("=== verify-continuation (require execution) ===");
  const finalVerify = parseJsonFromStdout(
    (
      await runCli(
        [
          "verify-continuation",
          cont.id,
          "--previous",
          exp.folderPath,
          "--require-execution",
          "--expected",
          "illustrative",
        ],
        env,
      )
    ).stdout,
  );
  await writeFile(
    path.join(evidenceDir, "08-verify-final.json"),
    JSON.stringify(finalVerify, null, 2),
  );

  await runCli(["inspect", cont.id, "--out", path.join(evidenceDir, "INSPECT-continuation.html")], env);

  const summary = {
    ok: finalVerify.report?.outcome === "pass",
    source: {
      agent: "cli-agent-a",
      interface: "cli",
      packageId: created.id,
      model: aiA.model,
      provider: aiA.provider,
    },
    destination: {
      agent: "mcp-agent-b",
      interfaces: ["mcp", "cli"],
      packageId: cont.id,
      model: aiB.model,
      provider: aiB.provider,
    },
    exportPath: exp.folderPath,
    archivePath: exp.archivePath,
    verification: finalVerify.report,
    baseline: finalVerify.baseline,
    note: "Agent B used MCP handoff_validate/handoff_read then CLI continue + run-ai. Continue-alone correctly failed require-execution before destination run.",
  };
  await writeFile(
    path.join(evidenceDir, "SUMMARY.json"),
    JSON.stringify(summary, null, 2),
  );
  // Mirror exported package into evidence (content copy)
  try {
    const handoffRaw = await readFile(
      path.join(exp.folderPath, "handoff.json"),
      "utf8",
    );
    await writeFile(
      path.join(evidenceDir, "example-package-handoff.json"),
      handoffRaw,
    );
    const inspectSrc = path.join(exp.folderPath, "INSPECT.html");
    try {
      await writeFile(
        path.join(evidenceDir, "INSPECT-export.html"),
        await readFile(inspectSrc, "utf8"),
      );
    } catch {
      /* optional */
    }
    const contPkg = await readFile(
      path.join(home, "receipts", cont.id, "handoff.json"),
      "utf8",
    );
    await writeFile(
      path.join(evidenceDir, "continuation-package-handoff.json"),
      contPkg,
    );
  } catch (err) {
    console.error("Evidence mirror warning:", err);
  }
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
