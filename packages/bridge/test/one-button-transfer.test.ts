import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, after } from "node:test";
import { transferAndRun } from "../src/one-button-transfer.ts";
import { readHandoffPackage } from "../src/index.ts";

describe("one-button transfer (create → continue → run-ai → verify)", () => {
  const temps: string[] = [];

  after(async () => {
    for (const t of temps) {
      await rm(t, { recursive: true, force: true });
    }
  });

  it("blocks honestly when no AI provider is available (package still created)", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "th-ob-block-"));
    temps.push(home);
    const result = await transferAndRun({
      instruction: "Summarize TabHandoff in one sentence.",
      home,
      aiDeps: { env: {}, allowLocalProbe: false },
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, "blocked");
    assert.equal(result.plainStatus, "blocked");
    assert.ok(result.sourceId);
    assert.equal(result.successorId, undefined);
    assert.match(result.message, /no local AI provider/i);
    const createStep = result.steps.find((s) => s.id === "create");
    const runStep = result.steps.find((s) => s.id === "run_ai");
    assert.equal(createStep?.status, "done");
    assert.equal(runStep?.status, "blocked");
    // Package exists on disk — package-only, not verified
    const { package: pkg } = await readHandoffPackage(result.sourceId!, { home });
    assert.equal(pkg.execution.agentLaunched, false);
  });

  it("rejects empty instruction", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "th-ob-empty-"));
    temps.push(home);
    await assert.rejects(
      () =>
        transferAndRun({
          instruction: "   ",
          home,
          aiDeps: { env: {}, allowLocalProbe: false },
        }),
      /instruction/i,
    );
  });

  it("full path with mocked provider reaches verified (Stage checks pass)", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "th-ob-ok-"));
    temps.push(home);

    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "TabHandoff transfers task state between compatible AI agents without losing progress.",
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
      destinationAgent: "mock-dest-ai",
      sourceAgent: "mock-desktop",
      home,
      aiDeps: {
        fetch: fakeFetch,
        env: {
          OPENAI_API_KEY: "test-key",
          OPENAI_MODEL: "gpt-4o-mini",
        },
        allowLocalProbe: false,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.stage, "verified");
    assert.equal(result.plainStatus, "verified");
    assert.equal(result.verificationOutcome, "pass");
    assert.ok(result.sourceId);
    assert.ok(result.successorId);
    assert.equal(result.executionRecorded, true);
    assert.equal(result.agentLaunched, true);
    assert.match(result.aiResult ?? "", /TabHandoff transfers/);
    assert.equal(result.aiProvider, "openai-compatible");
    assert.ok(result.steps.every((s) => s.status === "done"));

    const { package: successor } = await readHandoffPackage(result.successorId!, {
      home,
    });
    assert.equal(successor.execution.agentLaunched, true);
    assert.ok(
      successor.execution.events.some(
        (e) =>
          e.kind === "verified_event" &&
          e.tool?.includes("run-ai") &&
          e.ok === true,
      ),
    );
    const execCheck = result.verification?.checks.find(
      (c) => c.id === "destination_execution",
    );
    const contCheck = result.verification?.checks.find(
      (c) => c.id === "destination_continuation",
    );
    assert.equal(execCheck?.outcome, "pass");
    assert.equal(contCheck?.outcome, "pass");
  });

  it("file + instruction path also reaches verified with mocked provider", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "th-ob-file-"));
    temps.push(home);
    const notePath = path.join(home, "task-note.txt");
    await writeFile(
      notePath,
      "TabHandoff keeps task state portable between agents.\n",
      "utf8",
    );

    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "The note says TabHandoff keeps task state portable.",
              },
            },
          ],
        }),
        { status: 200 },
      );

    const result = await transferAndRun({
      instruction: "Read the attached note and restate its point in one line.",
      files: [
        {
          absolutePath: notePath,
          bytes: Buffer.from(
            "TabHandoff keeps task state portable between agents.\n",
            "utf8",
          ),
          displayPath: notePath,
        },
      ],
      destinationAgent: "mock-file-dest",
      home,
      aiDeps: {
        fetch: fakeFetch,
        env: { OPENAI_API_KEY: "k", OPENAI_MODEL: "gpt-4o-mini" },
        allowLocalProbe: false,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.stage, "verified");
    assert.equal(result.plainStatus, "verified");
    assert.ok(result.successorId);
    assert.match(result.aiResult ?? "", /portable/i);
  });

  it("does not claim verified when the model call fails", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "th-ob-fail-"));
    temps.push(home);
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { message: "boom" } }), {
        status: 500,
      });

    const result = await transferAndRun({
      instruction: "Do the thing",
      home,
      aiDeps: {
        fetch: fakeFetch,
        env: { OPENAI_API_KEY: "k", OPENAI_MODEL: "gpt-4o-mini" },
        allowLocalProbe: false,
      },
    });

    assert.equal(result.ok, false);
    assert.notEqual(result.stage, "verified");
    assert.notEqual(result.plainStatus, "verified");
    assert.ok(result.sourceId);
    assert.ok(result.successorId);
    const runStep = result.steps.find((s) => s.id === "run_ai");
    assert.ok(runStep?.status === "failed" || runStep?.status === "blocked");
  });
});
