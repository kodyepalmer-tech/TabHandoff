/**
 * Verified AI task handoff — schema 0.2, continuation verification, inspect.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  validatePortableHandoffPackage,
  parsePortableHandoffPackage,
} from "@tabhandoff/protocol";
import {
  continueHandoff,
  createVerifiedHandoff,
  exportHandoffPackage,
  recordDestinationExecution,
  renderInspectHtml,
  verifyContinuation,
  evaluateContinuationBaseline,
  writeInspectHtml,
} from "../src/index.ts";

describe("verified handoff (schema 0.2)", () => {
  const homes: string[] = [];

  after(async () => {
    for (const h of homes) {
      await rm(h, { recursive: true, force: true });
    }
  });

  it("creates 0.2 package with provenance, permissions, claims", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "th-verified-"));
    homes.push(home);

    const created = await createVerifiedHandoff({
      instruction: "Draft a one-line summary of Example Domain.",
      url: "https://example.com/",
      title: "Example Domain",
      selectedText: "This domain is for use in illustrative examples.",
      intendedOutcome: "One honest summary line from captured text.",
      acceptanceCriteria: [
        "Summary uses only captured page text.",
        "Does not invent site ownership claims.",
      ],
      tests: [
        {
          id: "has-summary",
          command: "check:previousResults-contains-summary",
          expected: "summary",
          result: "not_run",
        },
      ],
      missingInputs: ["Full HTML body (not captured)"],
      sourceIdentity: {
        name: "cli-agent-a",
        interface: "cli",
        tool: "create-verified",
      },
      destinationIdentity: {
        name: "cli-agent-b",
        interface: "mcp",
        tool: "handoff_read",
      },
      home,
    });

    assert.equal(created.package.schemaVersion, "0.2");
    assert.equal(created.agentLaunched, false);
    assert.ok(created.package.provenance);
    assert.ok(created.package.permissions);
    assert.equal(created.package.permissions?.allowShell, false);
    assert.ok(created.package.agentIdentity?.source);
    assert.equal(created.package.claims[0]?.kind, "user_statement");

    const validated = validatePortableHandoffPackage(created.package);
    assert.equal(validated.ok, true);
  });

  it("continue → destination execution → verify-continuation pass path", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "th-verified-flow-"));
    homes.push(home);
    const exportRoot = await mkdtemp(path.join(tmpdir(), "th-verified-ex-"));
    homes.push(exportRoot);

    const source = await createVerifiedHandoff({
      instruction: "Summarize Example Domain in one sentence.",
      url: "https://example.com/",
      title: "Example Domain",
      selectedText: "illustrative examples in documents",
      acceptanceCriteria: ["Uses captured selected text"],
      remainingWork: [
        "Produce one-sentence summary from selected text.",
        "List one remaining question if context is thin.",
      ],
      sourceIdentity: { name: "cli-agent-a", interface: "cli" },
      destinationIdentity: { name: "cli-agent-b", interface: "cli" },
      home,
    });

    // Agent A partial work (honest agent_reported + one verified packaging event already)
    const { appendProgress } = await import("../src/portable.ts");
    await appendProgress({
      target: source.id,
      detail: "Agent A captured context and packaged remaining work.",
      kind: "verified_event",
      tool: "agent-a.package",
      resultLine: "Context packaged for transfer.",
      remainingWork: [
        "Produce one-sentence summary from selected text.",
      ],
      ok: true,
      home,
    });

    const exported = await exportHandoffPackage({
      target: source.id,
      outDir: exportRoot,
      home,
    });
    assert.ok(exported.files.includes("INSPECT.html"));
    assert.ok(exported.files.includes("handoff.json"));

    const inspect = await writeInspectHtml(exported.folderPath);
    const html = await readFile(inspect.htmlPath, "utf8");
    assert.match(html, /TabHandoff package/);
    assert.match(html, /no credentials/i);
    assert.doesNotMatch(html, /api[_-]?key/i);

    // Agent B: continue (successor only — must NOT count as success)
    const successor = await continueHandoff({
      target: exported.folderPath,
      destinationAgent: "cli-agent-b",
      verified: true,
      home,
    });
    assert.equal(successor.package.previousHandoffId, source.id);
    assert.equal(successor.package.schemaVersion, "0.2");

    const beforeExec = await verifyContinuation(successor.id, {
      home,
      previousPath: exported.folderPath,
      requireDestinationExecution: true,
    });
    assert.equal(beforeExec.outcome, "fail");
    assert.ok(
      beforeExec.checks.some(
        (c) => c.id === "destination_execution" && c.outcome === "fail",
      ),
    );

    // Real destination execution recorded (simulates observed run-ai completion)
    await recordDestinationExecution({
      target: successor.id,
      tool: "agent-b.run-ai",
      detail:
        "Destination run-ai completed via Ollama; produced summary from selected text only.",
      resultLine:
        "Summary: Example Domain is for illustrative examples in documents.",
      remainingWork: ["List one remaining question if context is thin."],
      claim: {
        text: "Summary derived from selectedText only.",
        kind: "summary",
        at: new Date().toISOString(),
        source: "cli-agent-b",
      },
      agentLaunched: true,
      ok: true,
      verificationOutcome: "unverified",
      home,
    });

    const after = await verifyContinuation(successor.id, {
      home,
      previousPath: exported.folderPath,
      requireDestinationExecution: true,
    });
    assert.equal(after.outcome, "pass");
    assert.equal(after.ok, true);

    const { package: destPkg } = await import("../src/portable.ts").then((m) =>
      m.readHandoffPackage(successor.id, { home }),
    );
    const baseline = evaluateContinuationBaseline(destPkg, after, {
      expectedSubstring: "illustrative",
    });
    assert.equal(baseline.metrics.contextReceived, true);
    assert.equal(baseline.metrics.honestErrors, true);
    assert.equal(baseline.metrics.expectedOutputPresent, true);
  });

  it("legacy 0.1 sample still validates", async () => {
    const sample = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "../../../fixtures/portable-handoff/sample-research-001/handoff.json",
    );
    const raw = JSON.parse(await readFile(sample, "utf8"));
    const parsed = parsePortableHandoffPackage(raw);
    assert.equal(parsed.schemaVersion, "0.1");
    assert.equal(validatePortableHandoffPackage(raw).ok, true);
    const html = renderInspectHtml(parsed);
    assert.match(html, /sample-research-001/);
  });

  it("refuses observed_fact without verified_event", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "th-claim-"));
    homes.push(home);
    const created = await createVerifiedHandoff({
      instruction: "Do a thing",
      note: "note context for file-less package",
      sourceIdentity: { name: "a", interface: "cli" },
      claims: [
        {
          text: "I definitely finished everything",
          kind: "observed_fact",
        },
      ],
      home,
    });
    // Strip verified events to force dishonest package for the check
    const { readHandoffPackage, PortableError: _pe } = await import(
      "../src/portable.ts"
    );
    const { dir, package: pkg } = await readHandoffPackage(created.id, {
      home,
    });
    const dishonest = {
      ...pkg,
      execution: {
        ...pkg.execution,
        events: [],
      },
    };
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(
        path.join(dir, "handoff.json"),
        JSON.stringify(dishonest, null, 2),
        "utf8",
      ),
    );
    // Bypass rewritePackageFiles validation by writing raw — verify should fail claim_honesty
    const report = await verifyContinuation(created.id, { home });
    assert.ok(
      report.checks.some(
        (c) => c.id === "claim_honesty" && c.outcome === "fail",
      ),
    );
  });
});
