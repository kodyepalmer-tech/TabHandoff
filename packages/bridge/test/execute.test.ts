import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, after, beforeEach } from "node:test";
import {
  clearCapabilitiesCache,
  setCapabilitiesOverride,
} from "../src/capabilities.ts";
import { loadOrCreateBridgeConfig } from "../src/config.ts";
import { startBridgeServer } from "../src/server.ts";
import type { RunHandoffResult } from "@tabhandoff/runner";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const forcedExtraction = {
  pageExtraction: true,
  llmAgent: false,
  workflows: [
    {
      id: "page_extraction" as const,
      label: "Page extraction",
      description: "test stub",
    },
  ],
  message: "test stub — page extraction forced",
};

describe("Phase 3 bridge execution", () => {
  const temps: string[] = [];

  beforeEach(() => {
    clearCapabilitiesCache();
  });

  after(async () => {
    clearCapabilitiesCache();
    for (const t of temps) {
      await rm(t, { recursive: true, force: true });
    }
  });

  it("package-only path stays honest when runWorkflow is false", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "th-p3-pkg-"));
    temps.push(home);
    const port = 19000 + Math.floor(Math.random() * 1000);
    const config = await loadOrCreateBridgeConfig({ home, port });
    config.port = port;

    const server = await startBridgeServer({ config, home });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/handoffs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "chrome-extension://abcdef",
          Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify({
          url: "https://example.com",
          instruction: "Summarize this page",
          runWorkflow: false,
        }),
      });
      assert.equal(res.status, 201);
      const body = (await res.json()) as {
        workflowStarted: boolean;
        agentLaunched: boolean;
        executionStatus: string;
      };
      assert.equal(body.workflowStarted, false);
      assert.equal(body.agentLaunched, false);
      assert.equal(body.executionStatus, "package_created");
    } finally {
      await server.close();
    }
  });

  it("runs injected workflow, updates status, labels DOM honestly", async () => {
    setCapabilitiesOverride(forcedExtraction);
    const home = await mkdtemp(path.join(os.tmpdir(), "th-p3-run-"));
    temps.push(home);
    const port = 20000 + Math.floor(Math.random() * 1000);
    const config = await loadOrCreateBridgeConfig({ home, port });
    config.port = port;

    const fakeRunner = async (input: {
      id: string;
      receiptDir: string;
    }): Promise<RunHandoffResult> => {
      const shot = path.join(input.receiptDir, "screenshots", "01-loaded.png");
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(path.dirname(shot), { recursive: true });
      await writeFile(shot, Buffer.from(tinyPngBase64, "base64"));
      await writeFile(
        path.join(input.receiptDir, "receipt.md"),
        "# TabHandoff Receipt\n\n## Result\n\nDOM extract ok\n",
        "utf8",
      );
      return {
        ok: true,
        resultSummary: "Extracted heading Example Domain",
        receiptPath: path.join(input.receiptDir, "receipt.md"),
        cardPath: path.join(input.receiptDir, "card.yaml"),
        screenshotPaths: [shot],
        actions: [
          {
            at: new Date().toISOString(),
            tool: "extract",
            detail: "dom fallback (no API key)",
            ok: true,
          },
        ],
        mode: "dom",
      };
    };

    const server = await startBridgeServer({
      config,
      home,
      workflowRunner: fakeRunner as never,
    });

    try {
      const statusRes = await fetch(`http://127.0.0.1:${port}/v1/status`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      assert.equal(statusRes.status, 200);
      const statusBody = (await statusRes.json()) as {
        message: string;
        pageExtraction: boolean;
      };
      assert.equal(statusBody.pageExtraction, true);

      const res = await fetch(`http://127.0.0.1:${port}/v1/handoffs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "chrome-extension://abcdef",
          Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify({
          url: "https://example.com/docs",
          title: "Docs",
          instruction: "Extract the main heading",
          screenshots: [{ dataBase64: tinyPngBase64 }],
          runWorkflow: true,
          wait: true,
        }),
      });
      assert.equal(res.status, 201);
      const body = (await res.json()) as {
        ok: boolean;
        id: string;
        workflowStarted: boolean;
        agentLaunched: boolean;
        executionStatus: string;
        mode?: string;
        message?: string;
      };
      assert.equal(body.ok, true);
      assert.equal(body.workflowStarted, true);
      assert.equal(body.executionStatus, "succeeded");
      assert.equal(body.mode, "dom");
      assert.equal(body.agentLaunched, false);
      assert.match(body.message ?? "", /page extraction|DOM|not autonomous/i);

      const live = await fetch(`http://127.0.0.1:${port}/v1/handoffs/${body.id}`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      assert.equal(live.status, 200);
      const liveBody = (await live.json()) as {
        executionStatus: string;
        mode: string;
        agentLaunched: boolean;
        workflowLabel?: string;
      };
      assert.equal(liveBody.executionStatus, "succeeded");
      assert.equal(liveBody.mode, "dom");
      assert.equal(liveBody.agentLaunched, false);
      assert.match(liveBody.workflowLabel ?? "", /page extraction|DOM/i);

      const handoff = JSON.parse(
        await readFile(
          path.join(home, "receipts", body.id, "handoff.json"),
          "utf8",
        ),
      ) as {
        execution: {
          status: string;
          agentLaunched: boolean;
          mode: string;
          workflowLabel: string;
        };
        previousResults: string[];
      };
      assert.equal(handoff.execution.status, "succeeded");
      assert.equal(handoff.execution.agentLaunched, false);
      assert.equal(handoff.execution.mode, "dom");
      assert.match(handoff.execution.workflowLabel, /not autonomous AI/i);
      assert.ok(handoff.previousResults.length > 0);

      const job = JSON.parse(
        await readFile(path.join(home, "jobs", `${body.id}.json`), "utf8"),
      ) as { status: string; note?: string };
      assert.equal(job.status, "succeeded");
      assert.match(job.note ?? "", /page extraction|DOM/i);
    } finally {
      await server.close();
      clearCapabilitiesCache();
    }
  });

  it("records failed honestly when runner throws (no invented success)", async () => {
    setCapabilitiesOverride(forcedExtraction);
    const home = await mkdtemp(path.join(os.tmpdir(), "th-p3-failstart-"));
    temps.push(home);
    const port = 21000 + Math.floor(Math.random() * 1000);
    const config = await loadOrCreateBridgeConfig({ home, port });
    config.port = port;

    const fakeRunner = async (): Promise<RunHandoffResult> => {
      throw new Error("chromium missing in test");
    };

    const server = await startBridgeServer({
      config,
      home,
      workflowRunner: fakeRunner as never,
    });

    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/handoffs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "chrome-extension://abcdef",
          Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify({
          url: "https://example.com",
          instruction: "Extract heading",
          runWorkflow: true,
          wait: true,
        }),
      });
      assert.equal(res.status, 201);
      const body = (await res.json()) as {
        id: string;
        executionStatus: string;
        agentLaunched: boolean;
      };
      assert.notEqual(body.executionStatus, "succeeded");
      assert.equal(body.agentLaunched, false);

      const handoff = JSON.parse(
        await readFile(
          path.join(home, "receipts", body.id, "handoff.json"),
          "utf8",
        ),
      ) as { execution: { status: string }; previousResults: string[] };
      assert.equal(handoff.execution.status, "failed");
      assert.deepEqual(handoff.previousResults, []);
    } finally {
      await server.close();
      clearCapabilitiesCache();
    }
  });

  it("stays package_created when Chromium is unavailable", async () => {
    setCapabilitiesOverride({
      pageExtraction: false,
      llmAgent: false,
      workflows: [],
      message: "Packages only — Playwright unavailable.",
    });
    const home = await mkdtemp(path.join(os.tmpdir(), "th-p3-noclient-"));
    temps.push(home);
    const port = 22000 + Math.floor(Math.random() * 1000);
    const config = await loadOrCreateBridgeConfig({ home, port });
    config.port = port;

    const server = await startBridgeServer({ config, home });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/handoffs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "chrome-extension://abcdef",
          Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify({
          url: "https://example.com",
          instruction: "Extract heading",
          runWorkflow: true,
        }),
      });
      assert.equal(res.status, 201);
      const body = (await res.json()) as {
        executionStatus: string;
        workflowStarted: boolean;
        agentLaunched: boolean;
        message: string;
      };
      assert.equal(body.executionStatus, "package_created");
      assert.equal(body.workflowStarted, false);
      assert.equal(body.agentLaunched, false);
      assert.match(body.message, /no supported|unavailable|package/i);
    } finally {
      await server.close();
      clearCapabilitiesCache();
    }
  });
});
