import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, before } from "node:test";
import {
  exportActivityReport,
  filterActivities,
  indexReceipts,
  uniqueHostnames,
  UNTRUSTED_CONTENT_WARNING,
} from "../src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_HOME = path.resolve(here, "../../../fixtures/receipts-home");
const DEMO_ID = "b8f51071-af46-4544-ba40-d7aa8ea88de1";

describe("indexReceipts import", () => {
  let indexed: Awaited<ReturnType<typeof indexReceipts>>;

  before(async () => {
    indexed = await indexReceipts({ home: FIXTURE_HOME });
  });

  it("imports existing fixture receipts and jobs", () => {
    assert.ok(indexed.importedCount >= 4);
    const ids = new Set(indexed.records.map((r) => r.id));
    assert.ok(ids.has(DEMO_ID));
    assert.ok(ids.has("partial-only-md"));
    assert.ok(ids.has("corrupt-job"));
    assert.ok(ids.has("job-only-queued"));
  });

  it("indexes demo activity with screenshots and structured timeline", () => {
    const demo = indexed.records.find((r) => r.id === DEMO_ID);
    assert.ok(demo);
    assert.equal(demo.status, "succeeded");
    assert.equal(demo.hostname, "playwright.dev");
    assert.ok(demo.screenshotCount >= 2);
    assert.ok(demo.thumbnailPath?.endsWith("01-loaded.png"));
    assert.ok(demo.timeline.some((e) => e.kind === "verified_event"));
    assert.ok(demo.timeline.some((e) => e.kind === "agent_reported"));
    assert.equal(demo.untrustedContent.warning, UNTRUSTED_CONTENT_WARNING);
    assert.equal(demo.schemaVersion, "0.1");
  });

  it("handles partial and corrupt records without throwing", () => {
    const partial = indexed.records.find((r) => r.id === "partial-only-md");
    assert.ok(partial);
    assert.equal(partial.status, "failed");
    assert.equal(partial.partial, true);

    const corrupt = indexed.records.find((r) => r.id === "corrupt-job");
    assert.ok(corrupt);
    assert.equal(corrupt.hostname, "example.org");
    assert.ok(corrupt.indexNotes.some((n) => /corrupt/i.test(n)));
  });

  it("never invents suggestion timeline events at index time", () => {
    for (const r of indexed.records) {
      assert.ok(!r.timeline.some((e) => e.kind === "suggestion"));
    }
  });
});

describe("filterActivities", () => {
  it("filters by query, status, and hostname", async () => {
    const { records } = await indexReceipts({ home: FIXTURE_HOME });
    const byHost = filterActivities(records, { hostname: "playwright.dev" });
    assert.equal(byHost.length, 1);
    assert.equal(byHost[0]?.id, DEMO_ID);

    const failed = filterActivities(records, { status: "failed" });
    assert.ok(failed.some((r) => r.id === "partial-only-md"));

    const q = filterActivities(records, { query: "Summarize the page" });
    assert.ok(q.some((r) => r.id === "job-only-queued"));

    assert.ok(uniqueHostnames(records).includes("playwright.dev"));
  });
});

describe("exportActivityReport preserves history", () => {
  it("writes new export files without overwriting receipt.md", async () => {
    const receiptPath = path.join(FIXTURE_HOME, "receipts", DEMO_ID, "receipt.md");
    const before = await readFile(receiptPath, "utf8");

    const tmp = await mkdtemp(path.join(os.tmpdir(), "tabhandoff-export-"));
    try {
      const { markdownPath, jsonPath, reportDir } = await exportActivityReport(DEMO_ID, {
        home: FIXTURE_HOME,
        outDir: tmp,
      });
      assert.equal(reportDir, tmp);
      const md = await readFile(markdownPath, "utf8");
      const json = JSON.parse(await readFile(jsonPath, "utf8")) as {
        kind: string;
        activity: { id: string };
      };
      assert.match(md, /activity report/i);
      assert.equal(json.kind, "tabhandoff.activity_export");
      assert.equal(json.activity.id, DEMO_ID);

      const after = await readFile(receiptPath, "utf8");
      assert.equal(after, before);

      // Original screenshots untouched
      const shots = await readdir(path.join(FIXTURE_HOME, "receipts", DEMO_ID, "screenshots"));
      assert.ok(shots.includes("01-loaded.png"));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("does not mutate jobs when re-indexing", async () => {
    const jobPath = path.join(FIXTURE_HOME, "jobs", `${DEMO_ID}.json`);
    const before = await readFile(jobPath, "utf8");
    await indexReceipts({ home: FIXTURE_HOME });
    const after = await readFile(jobPath, "utf8");
    assert.equal(after, before);
  });
});

describe("empty home", () => {
  it("indexes an empty home as zero records", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "tabhandoff-empty-"));
    try {
      await mkdir(path.join(tmp, "jobs"), { recursive: true });
      await mkdir(path.join(tmp, "receipts"), { recursive: true });
      const result = await indexReceipts({ home: tmp });
      assert.equal(result.importedCount, 0);
      assert.deepEqual(result.records, []);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
