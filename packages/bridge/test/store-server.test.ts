import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, after } from "node:test";
import { loadOrCreateBridgeConfig } from "../src/config.ts";
import { buildPortablePackage } from "../src/package.ts";
import { writeHandoffToHome } from "../src/store.ts";
import { startBridgeServer } from "../src/server.ts";
import { BRIDGE_MAX_BODY_BYTES } from "../src/limits.ts";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("writeHandoffToHome + bridge HTTP", () => {
  const temps: string[] = [];

  after(async () => {
    for (const t of temps) {
      await rm(t, { recursive: true, force: true });
    }
  });

  it("writes compatible receipts/jobs without claiming success", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "th-bridge-"));
    temps.push(home);

    const pkg = buildPortablePackage({
      url: "https://example.com/ticket",
      title: "Ticket 42",
      instruction: "Review this ticket and prepare a response.",
      screenshots: [{ dataBase64: tinyPngBase64 }],
    });
    const stored = await writeHandoffToHome(pkg, { home });

    assert.equal(stored.executionStatus, "package_created");
    assert.equal(stored.agentLaunched, false);

    const handoff = JSON.parse(await readFile(stored.handoffPath, "utf8"));
    assert.equal(handoff.execution.agentLaunched, false);
    assert.equal(handoff.execution.status, "package_created");
    assert.equal(handoff.screenshots[0].dataBase64, undefined);

    const job = JSON.parse(await readFile(stored.jobPath, "utf8"));
    assert.equal(job.status, "queued");
    assert.match(job.note, /no agent launched/i);
    assert.ok(job.actions.some((a: { tool: string }) => a.tool === "extension.package"));

    const receipt = await readFile(stored.receiptPath, "utf8");
    assert.match(receipt, /no agent was launched/i);
  });

  it("accepts authenticated handoff and rejects bad auth / oversize", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "th-bridge-http-"));
    temps.push(home);
    const config = await loadOrCreateBridgeConfig({ home, port: 0 });
    // port 0 → OS assigns; rewrite config.port after listen via custom start
    // Use an ephemeral high port chosen for this test
    const port = 18000 + Math.floor(Math.random() * 1000);
    config.port = port;

    const server = await startBridgeServer({ config, home });
    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(health.status, 200);
      const healthJson = (await health.json()) as { authRequired: boolean };
      assert.equal(healthJson.authRequired, true);

      const denied = await fetch(`http://127.0.0.1:${port}/v1/handoffs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "chrome-extension://abcdef",
          Authorization: "Bearer wrong-token-wrong-token",
        },
        body: JSON.stringify({
          url: "https://example.com",
          instruction: "Summarize",
        }),
      });
      assert.equal(denied.status, 401);

      const ok = await fetch(`http://127.0.0.1:${port}/v1/handoffs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "chrome-extension://abcdef",
          Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify({
          url: "https://example.com/docs",
          title: "Docs",
          selectedText: "Important fact",
          instruction: "Compile the important facts.",
          screenshots: [{ dataBase64: tinyPngBase64 }],
        }),
      });
      assert.equal(ok.status, 201);
      const body = (await ok.json()) as {
        ok: boolean;
        agentLaunched: boolean;
        executionStatus: string;
        id: string;
      };
      assert.equal(body.ok, true);
      assert.equal(body.agentLaunched, false);
      assert.equal(body.executionStatus, "package_created");
      assert.ok(body.id);

      // oversize raw body (selectedText is truncated by package builder;
      // size limit is enforced on the HTTP body before parse)
      const huge = "a".repeat(BRIDGE_MAX_BODY_BYTES + 2048);
      const tooBig = await fetch(`http://127.0.0.1:${port}/v1/handoffs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "chrome-extension://abcdef",
          Authorization: `Bearer ${config.token}`,
        },
        body: huge,
      });
      assert.equal(tooBig.status, 413);
    } finally {
      await server.close();
    }
  });
});
