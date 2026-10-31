/**
 * Continuation vs execution model.
 *
 * Four stages, kept separate on purpose:
 *  0. Import — validate + chain + context only. Never continuation/execution.
 *  1. Continuation — destination did corroborated work (new result line,
 *     remaining-work change, test pass/fail, or new artifact). Progress
 *     text alone does NOT pass.
 *  2. Execution — destination AI execution actually ran: agentLaunched true,
 *     verified run-ai event with ok=true, and a result line. A progress
 *     message mentioning run-ai, without those, does NOT pass.
 *  3. Independent verification — verifyContinuation run with --previous.
 *
 * These tests use the library directly, with a fresh home per case, so they
 * do not depend on a live model, provider key, or Ollama.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  appendProgress,
  continueHandoff,
  createVerifiedHandoff,
  exportHandoffPackage,
  recordDestinationExecution,
  verifyContinuation,
} from "../src/index.ts";

describe("continuation vs execution model", () => {
  const homes: string[] = [];
  after(async () => {
    for (const h of homes) await rm(h, { recursive: true, force: true });
  });

  async function makeSuccessor() {
    const home = await mkdtemp(path.join(tmpdir(), "th-cont-"));
    const exportRoot = await mkdtemp(path.join(tmpdir(), "th-cont-ex-"));
    homes.push(home, exportRoot);
    const source = await createVerifiedHandoff({
      instruction: "Summarize Example Domain in one sentence.",
      url: "https://example.com/",
      title: "Example Domain",
      selectedText: "illustrative examples in documents",
      acceptanceCriteria: ["Uses captured selected text"],
      remainingWork: ["Produce one-sentence summary from selected text."],
      sourceIdentity: { name: "cli-agent-a", interface: "cli" },
      destinationIdentity: { name: "cli-agent-b", interface: "cli" },
      home,
    });
    const exported = await exportHandoffPackage({
      target: source.id,
      outDir: exportRoot,
      home,
    });
    const successor = await continueHandoff({
      target: exported.folderPath,
      destinationAgent: "cli-agent-b",
      verified: true,
      home,
    });
    const check = (report: Awaited<ReturnType<typeof verifyContinuation>>) =>
      report.checks.find((c) => c.id === "destination_continuation")?.outcome;
    const execCheck = (
      report: Awaited<ReturnType<typeof verifyContinuation>>,
    ) => report.checks.find((c) => c.id === "destination_execution")?.outcome;
    return { home, source, exported, successor, check, execCheck };
  }

  it("package import without work: continuation and execution both fail", async () => {
    const { home, exported, successor, check, execCheck } =
      await makeSuccessor();
    // No post-continue work at all — only the automatic agent.continue event.
    const cont = await verifyContinuation(successor.id, {
      home,
      previousPath: exported.folderPath,
      requireContinuation: true,
    });
    assert.equal(check(cont), "fail");
    const exec = await verifyContinuation(successor.id, {
      home,
      previousPath: exported.folderPath,
      requireDestinationExecution: true,
    });
    assert.equal(execCheck(exec), "fail");
    assert.equal(exec.outcome, "fail");
  });

  it("progress without corroboration: continuation and execution both fail", async () => {
    const { home, exported, successor, check, execCheck } =
      await makeSuccessor();
    // Detail text only — no result line, no remaining-work change, no test
    // result, no artifact. This is the false-positive case the new model
    // must reject, even though the event kind is verified_event.
    await appendProgress({
      target: successor.id,
      detail: "Agent B reviewed the package and did work.",
      kind: "verified_event",
      home,
    });
    const cont = await verifyContinuation(successor.id, {
      home,
      previousPath: exported.folderPath,
      requireContinuation: true,
    });
    assert.equal(check(cont), "fail");
    const exec = await verifyContinuation(successor.id, {
      home,
      previousPath: exported.folderPath,
      requireDestinationExecution: true,
    });
    assert.equal(execCheck(exec), "fail");
  });

  it("successful continuation: corroborated work passes continuation, not execution", async () => {
    const { home, exported, successor, check, execCheck } =
      await makeSuccessor();
    await appendProgress({
      target: successor.id,
      detail:
        "Agent B edited docs and ran the verified-handoff tests in a fresh clone.",
      kind: "verified_event",
      resultLine: "pnpm build PASS; pnpm test:verified-handoff 4 pass, 0 fail",
      remainingWork: ["List one remaining question if context is thin."],
      home,
    });
    const cont = await verifyContinuation(successor.id, {
      home,
      previousPath: exported.folderPath,
      requireContinuation: true,
    });
    assert.equal(check(cont), "pass");
    // Continuation is not execution: no run-ai, agentLaunched is still false.
    const exec = await verifyContinuation(successor.id, {
      home,
      previousPath: exported.folderPath,
      requireDestinationExecution: true,
    });
    assert.equal(execCheck(exec), "fail");
  });

  it("successful execution: run-ai + agentLaunched + result passes both", async () => {
    const { home, exported, successor, check, execCheck } =
      await makeSuccessor();
    await recordDestinationExecution({
      target: successor.id,
      tool: "agent-b.run-ai",
      detail: "Destination run-ai completed via a local model.",
      resultLine:
        "Summary: Example Domain is for illustrative examples in documents.",
      remainingWork: ["List one remaining question if context is thin."],
      agentLaunched: true,
      ok: true,
      home,
    });
    const exec = await verifyContinuation(successor.id, {
      home,
      previousPath: exported.folderPath,
      requireDestinationExecution: true,
    });
    assert.equal(execCheck(exec), "pass");
    assert.equal(exec.outcome, "pass");
    const cont = await verifyContinuation(successor.id, {
      home,
      previousPath: exported.folderPath,
      requireContinuation: true,
    });
    assert.equal(check(cont), "pass");
  });

  it("failed execution: run-ai attempted but ok=false fails execution, not continuation", async () => {
    const { home, exported, successor, check, execCheck } =
      await makeSuccessor();
    await recordDestinationExecution({
      target: successor.id,
      tool: "agent-b.run-ai",
      detail: "Destination run-ai attempted and failed.",
      resultLine: "run-ai failed: provider unavailable",
      agentLaunched: false,
      ok: false,
      home,
    });
    const exec = await verifyContinuation(successor.id, {
      home,
      previousPath: exported.folderPath,
      requireDestinationExecution: true,
    });
    assert.equal(execCheck(exec), "fail");
    // Honest failed work is still continuation (corroborated by a result
    // line), even though execution did not succeed.
    const cont = await verifyContinuation(successor.id, {
      home,
      previousPath: exported.folderPath,
      requireContinuation: true,
    });
    assert.equal(check(cont), "pass");
  });

  it("fabrication guard: progress mentioning run-ai does not count as execution", async () => {
    const { home, exported, successor, check, execCheck } =
      await makeSuccessor();
    await appendProgress({
      target: successor.id,
      detail: "run-ai completed successfully via the model.",
      kind: "verified_event",
      resultLine: "run-ai done",
      home,
    });
    // Continuation passes (result line corroborates work), execution must
    // not: agentLaunched is false, no run-ai tool event, no llm workflow.
    const cont = await verifyContinuation(successor.id, {
      home,
      previousPath: exported.folderPath,
      requireContinuation: true,
    });
    assert.equal(check(cont), "pass");
    const exec = await verifyContinuation(successor.id, {
      home,
      previousPath: exported.folderPath,
      requireDestinationExecution: true,
    });
    assert.equal(execCheck(exec), "fail");
  });
});
