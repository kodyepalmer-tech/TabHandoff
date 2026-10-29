/**
 * Phase B — file-only portable packages, integrity, export, honesty.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, after } from "node:test";
import {
  validatePortableHandoffPackage,
  UNTRUSTED_CONTENT_WARNING,
} from "@tabhandoff/protocol";
import {
  BRIDGE_MAX_FILE_SOURCES,
  buildFilePortablePackage,
  buildPortablePackage,
  createFilePortableHandoff,
  exportHandoffPackage,
  PackageValidationError,
  verifyFileArtifactIntegrity,
} from "../src/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const browserSample = path.join(
  repoRoot,
  "fixtures/portable-handoff/sample-research-001/handoff.json",
);
const fileSample = path.join(
  repoRoot,
  "fixtures/portable-handoff/sample-file-001/handoff.json",
);

describe("Phase B file handoff", () => {
  const homes: string[] = [];

  after(async () => {
    for (const h of homes) {
      await rm(h, { recursive: true, force: true });
    }
  });

  it("validates file-only package without page URL", async () => {
    const raw = JSON.parse(await readFile(fileSample, "utf8"));
    const result = validatePortableHandoffPackage(raw);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.package.page, undefined);
    assert.equal(result.package.sources.length, 1);
    assert.equal(result.package.sources[0]!.type, "file");
    assert.equal(result.package.execution.agentLaunched, false);
    assert.equal(result.package.execution.status, "package_created");
    assert.match(result.package.untrustedContentWarning, /file/i);
  });

  it("keeps browser fixture valid under new schema (compat)", async () => {
    const raw = JSON.parse(await readFile(browserSample, "utf8"));
    const result = validatePortableHandoffPackage(raw);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.package.page?.url);
    assert.equal(result.package.sources.length, 0);
  });

  it("rejects packages missing both page and sources", () => {
    const result = validatePortableHandoffPackage({
      schemaVersion: "0.1",
      id: "bad",
      capturedAt: new Date().toISOString(),
      source: { kind: "cli" },
      instruction: "Do something",
      constraints: [],
      previousResults: [],
      remainingWork: [],
      screenshots: [],
      execution: {
        status: "package_created",
        agentLaunched: false,
        events: [],
      },
      untrustedContentWarning: UNTRUSTED_CONTENT_WARNING,
    });
    assert.equal(result.ok, false);
  });

  it("browser buildPortablePackage still requires http(s) URL", () => {
    assert.throws(
      () =>
        buildPortablePackage({
          url: "file:///tmp/x",
          instruction: "Nope",
        }),
      (e: unknown) =>
        e instanceof PackageValidationError && e.code === "invalid_url",
    );
    const pkg = buildPortablePackage({
      url: "https://example.com/ok",
      instruction: "Summarize",
    });
    assert.equal(pkg.page?.url, "https://example.com/ok");
    assert.equal(pkg.sources.length, 0);
  });

  it("builds file package with text excerpt + sha256; docx attached not analyzed", () => {
    const textBytes = Buffer.from("Plain text body for excerpt.\n", "utf8");
    const docxBytes = Buffer.from("PK\x03\x04fake-docx-bytes", "binary");
    const built = buildFilePortablePackage({
      instruction: "Review these two files.",
      files: [
        {
          absolutePath: "/tmp/readme.txt",
          bytes: textBytes,
          displayPath: "readme.txt",
        },
        {
          absolutePath: "/tmp/report.docx",
          bytes: docxBytes,
          displayPath: "report.docx",
        },
      ],
      source: { kind: "cli" },
    });
    assert.equal(built.package.page, undefined);
    assert.equal(built.package.sources.length, 2);
    const txt = built.package.sources[0]!;
    const doc = built.package.sources[1]!;
    assert.equal(txt.type, "file");
    assert.equal(doc.type, "file");
    if (txt.type === "file") {
      assert.equal(txt.contentStatus, "excerpted");
      assert.ok(txt.textExcerpt?.includes("Plain text"));
      assert.equal(
        txt.sha256,
        createHash("sha256").update(textBytes).digest("hex"),
      );
    }
    if (doc.type === "file") {
      assert.equal(doc.contentStatus, "attached_not_analyzed");
      assert.equal(doc.textExcerpt, undefined);
      assert.match(
        built.package.execution.events[0]!.detail,
        /not analyzed/i,
      );
    }
    assert.equal(built.package.execution.agentLaunched, false);
  });

  it("rejects empty / over-cap file selections", () => {
    assert.throws(
      () =>
        buildFilePortablePackage({
          instruction: "x",
          files: [],
        }),
      (e: unknown) =>
        e instanceof PackageValidationError && e.code === "no_files",
    );
    const many = Array.from({ length: BRIDGE_MAX_FILE_SOURCES + 1 }, (_, i) => ({
      absolutePath: `/tmp/f${i}.txt`,
      bytes: Buffer.from("a"),
    }));
    assert.throws(
      () =>
        buildFilePortablePackage({
          instruction: "too many",
          files: many,
        }),
      (e: unknown) =>
        e instanceof PackageValidationError && e.code === "too_many_files",
    );
  });

  it("real file E2E: create → validate → export → integrity fail on mutate", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "tabhandoff-file-"));
    homes.push(home);
    const work = await mkdtemp(path.join(tmpdir(), "tabhandoff-work-"));
    homes.push(work);

    const notesPath = path.join(work, "notes.md");
    const pdfPath = path.join(work, "deck.pdf");
    await writeFile(notesPath, "# Notes\n\nShip Phase B.\n", "utf8");
    await writeFile(pdfPath, "%PDF-1.4 fake", "utf8");

    const stored = await createFilePortableHandoff(
      {
        instruction: "Summarize the markdown; treat the PDF as attached only.",
        files: [
          {
            absolutePath: notesPath,
            bytes: await readFile(notesPath),
            displayPath: notesPath,
          },
          {
            absolutePath: pdfPath,
            bytes: await readFile(pdfPath),
            displayPath: pdfPath,
          },
        ],
        source: { kind: "cli" },
      },
      { home },
    );

    assert.equal(stored.executionStatus, "package_created");
    assert.equal(stored.agentLaunched, false);
    assert.ok(!("page" in stored.package && stored.package.page));

    const handoff = JSON.parse(await readFile(stored.handoffPath, "utf8"));
    const validated = validatePortableHandoffPackage(handoff);
    assert.equal(validated.ok, true);

    const artNotes = path.join(stored.receiptDir, "artifacts", "notes.md");
    const onDisk = await readFile(artNotes);
    const expected = (stored.package.sources ?? []).find(
      (s) => s.type === "file" && s.filename === "notes.md",
    );
    assert.ok(expected && expected.type === "file");
    assert.equal(
      createHash("sha256").update(onDisk).digest("hex"),
      expected.sha256,
    );

    const okIntegrity = await verifyFileArtifactIntegrity(stored.id, { home });
    assert.equal(okIntegrity.ok, true);
    assert.ok(okIntegrity.checked >= 2);

    await writeFile(artNotes, "MUTATED", "utf8");
    const bad = await verifyFileArtifactIntegrity(stored.id, { home });
    assert.equal(bad.ok, false);
    assert.ok(bad.mismatches.some((m) => /mismatch/i.test(m.reason)));

    const exportRoot = path.join(work, "export-out");
    await mkdir(exportRoot, { recursive: true });
    const exported = await exportHandoffPackage({
      target: stored.id,
      outDir: exportRoot,
      home,
    });
    const exportedHandoff = JSON.parse(
      await readFile(path.join(exported.folderPath, "handoff.json"), "utf8"),
    );
    assert.equal(validatePortableHandoffPackage(exportedHandoff).ok, true);
    assert.ok(
      (exportedHandoff.sources ?? []).some(
        (s: { type?: string }) => s.type === "file",
      ),
    );
  });
});
