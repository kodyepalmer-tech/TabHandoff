import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, cp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, after } from "node:test";
import { indexReceipts } from "../src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fileFixture = path.resolve(
  here,
  "../../../fixtures/portable-handoff/sample-file-001",
);

describe("file handoff activity indexing", () => {
  const homes: string[] = [];
  after(async () => {
    for (const h of homes) await rm(h, { recursive: true, force: true });
  });

  it("indexes file-only packages with file label (no fake URL)", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "tabhandoff-ev-file-"));
    homes.push(home);
    const receipts = path.join(home, "receipts", "sample-file-001");
    await mkdir(path.dirname(receipts), { recursive: true });
    await cp(fileFixture, receipts, { recursive: true });

    const indexed = await indexReceipts({ home });
    const rec = indexed.records.find((r) => r.id === "sample-file-001");
    assert.ok(rec);
    assert.equal(rec.primarySourceType, "file");
    assert.equal(rec.displayLabel, "notes.txt");
    assert.equal(rec.url, undefined);
    assert.notEqual(rec.hostname, "invalid.invalid");
    assert.equal(rec.hostname, "files");
    assert.equal(rec.fileSources.length, 1);
    assert.equal(rec.fileSources[0]!.contentStatus, "excerpted");
    assert.equal(rec.status, "package_created");
    assert.match(rec.untrustedContent.warning, /file/i);
  });

  it("does not invent https://invalid.invalid for file packages", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "tabhandoff-ev-nofake-"));
    homes.push(home);
    const id = "file-only-live";
    const dir = path.join(home, "receipts", id);
    await mkdir(path.join(dir, "artifacts"), { recursive: true });
    await writeFile(path.join(dir, "artifacts", "a.txt"), "hi\n", "utf8");
    await writeFile(
      path.join(dir, "handoff.json"),
      JSON.stringify(
        {
          schemaVersion: "0.1",
          id,
          capturedAt: "2026-10-29T03:00:00.000Z",
          source: { kind: "desktop" },
          sources: [
            {
              type: "file",
              filename: "a.txt",
              byteSize: 3,
              sha256: "a",
              artifactFilename: "a.txt",
              contentStatus: "excerpted",
              textExcerpt: "hi\n",
            },
          ],
          instruction: "Read a.txt",
          constraints: [],
          previousResults: [],
          remainingWork: [],
          screenshots: [],
          execution: {
            status: "package_created",
            agentLaunched: false,
            events: [],
          },
          untrustedContentWarning: "untrusted",
        },
        null,
        2,
      ),
      "utf8",
    );

    const indexed = await indexReceipts({ home });
    const rec = indexed.records.find((r) => r.id === id);
    assert.ok(rec);
    assert.equal(rec.url, undefined);
    assert.ok(!JSON.stringify(rec).includes("invalid.invalid"));
  });
});
