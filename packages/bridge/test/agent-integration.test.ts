/**
 * §12 G — reproducible agent integration test:
 * parse sample → validate → read → create/continue → record result
 * without fabricating verification → export → another agent can consume.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, after } from "node:test";
import {
  validatePortableHandoffPackage,
  parsePortableHandoffPackage,
} from "@tabhandoff/protocol";
import {
  appendProgress,
  attachEvidence,
  continueHandoff,
  createPortableHandoff,
  exportHandoffPackage,
  markExecutionStatus,
  PortableError,
  readHandoffPackage,
  summarizePackageForAgent,
  validateHandoffTarget,
} from "../src/portable.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const sampleDir = path.join(
  repoRoot,
  "fixtures/portable-handoff/sample-research-001",
);

describe("§12 agent integration loop", () => {
  const homes: string[] = [];

  after(async () => {
    for (const h of homes) {
      await rm(h, { recursive: true, force: true });
    }
  });

  it("parse → validate → read → create/continue → record → export → re-validate", async () => {
    // 1–2. Discover sample, parse + validate without reverse-engineering Markdown
    const raw = JSON.parse(
      await readFile(path.join(sampleDir, "handoff.json"), "utf8"),
    );
    const parsed = parsePortableHandoffPackage(raw);
    assert.equal(parsed.schemaVersion, "0.1");
    assert.equal(parsed.id, "sample-research-001");
    assert.equal(parsed.execution.status, "package_created");
    assert.equal(parsed.execution.agentLaunched, false);
    assert.equal(parsed.previousResults.length, 0);

    const validated = validatePortableHandoffPackage(raw);
    assert.equal(validated.ok, true);

    const fromDisk = await validateHandoffTarget(sampleDir);
    assert.equal(fromDisk.ok, true);
    assert.equal(fromDisk.package.id, "sample-research-001");
    assert.match(fromDisk.hashNote, /do not independently authenticate/i);

    // 3. Read structured context an agent needs
    const { package: readPkg } = await readHandoffPackage(sampleDir);
    const summary = summarizePackageForAgent(readPkg);
    assert.equal(summary.instruction, readPkg.instruction);
    assert.ok(Array.isArray(summary.remainingWork));
    assert.ok(
      (summary.evidenceKinds as Record<string, string>).agent_reported,
    );

    // Isolated home for create/continue/export
    const home = await mkdtemp(path.join(tmpdir(), "tabhandoff-agent-"));
    homes.push(home);
    const exportRoot = await mkdtemp(path.join(tmpdir(), "tabhandoff-export-"));
    homes.push(exportRoot);

    // 4. Create a new package (package_created — no fabricated run)
    const created = await createPortableHandoff(
      {
        url: "https://example.com/",
        title: "Example Domain",
        selectedText: "illustrative examples",
        instruction: "Summarize and list next steps.",
        source: { kind: "agent" },
      },
      { home },
    );
    assert.equal(created.executionStatus, "package_created");
    assert.equal(created.agentLaunched, false);
    assert.equal(created.package.previousResults.length, 0);

    // 5. Continue → successor references previous
    const successor = await continueHandoff({
      target: created.id,
      instruction: "Finish the summary from remaining work.",
      home,
    });
    assert.equal(successor.previousId, created.id);
    assert.equal(successor.package.previousHandoffId, created.id);
    assert.equal(successor.executionStatus, "package_created");
    assert.equal(successor.agentLaunched, false);
    assert.ok(
      successor.package.execution.events.some(
        (e) => e.tool === "agent.continue" && e.kind === "verified_event",
      ),
    );

    // 6. Record a result WITHOUT fabricating verification (agent_reported)
    const progressed = await appendProgress({
      target: successor.id,
      detail: "Drafted a one-paragraph summary from selected text only.",
      kind: "agent_reported",
      resultLine: "Draft summary prepared (agent_reported — not verified).",
      home,
    });
    const last = progressed.execution.events.at(-1)!;
    assert.equal(last.kind, "agent_reported");
    assert.ok(progressed.previousResults.some((r) => /agent_reported/i.test(r)));

    // Attach tiny evidence; refuse silent overwrite
    const shot = path.join(home, "tiny.png");
    await writeFile(
      shot,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const attached = await attachEvidence({
      target: successor.id,
      filePath: shot,
      filename: "agent-note.png",
      home,
    });
    assert.ok(attached.screenshots.some((s) => s.filename === "agent-note.png"));
    assert.ok(attached.screenshots.find((s) => s.filename === "agent-note.png")?.sha256);
    assert.equal(
      attached.screenshots.find((s) => s.filename === "agent-note.png")?.mediaType,
      "image/png",
    );

    // Non-image attachments must not be mislabelled as image/png.
    const note = path.join(home, "note.md");
    await writeFile(note, "# hello\n");
    const attachedNote = await attachEvidence({
      target: successor.id,
      filePath: note,
      filename: "attached-note.md",
      home,
    });
    assert.equal(
      attachedNote.screenshots.find((s) => s.filename === "attached-note.md")?.mediaType,
      "text/markdown",
    );
    const unknown = path.join(home, "data.xyz");
    await writeFile(unknown, "hello\n");
    const attachedUnknown = await attachEvidence({
      target: successor.id,
      filePath: unknown,
      filename: "data.xyz",
      home,
    });
    assert.equal(
      attachedUnknown.screenshots.find((s) => s.filename === "data.xyz")?.mediaType,
      "application/octet-stream",
    );

    await assert.rejects(
      () =>
        attachEvidence({
          target: successor.id,
          filePath: shot,
          filename: "agent-note.png",
          home,
        }),
      (e: unknown) =>
        e instanceof PortableError && e.code === "evidence_exists",
    );

    // Mark awaiting_input with justifying reason (still agent_reported)
    const marked = await markExecutionStatus({
      target: successor.id,
      status: "awaiting_input",
      reason: "Need user confirmation before treating draft as final.",
      kind: "agent_reported",
      home,
    });
    assert.equal(marked.execution.status, "awaiting_input");
    assert.equal(marked.execution.events.at(-1)!.kind, "agent_reported");
    // Must not claim verified success
    assert.ok(marked.execution.status !== "succeeded");

    // 7. Export package another agent can consume (no original home required)
    const exported = await exportHandoffPackage({
      target: successor.id,
      outDir: exportRoot,
      archive: true,
      home,
    });
    assert.ok(exported.folderPath);
    assert.ok(exported.archivePath);
    assert.ok(exported.files.includes("handoff.json"));
    assert.ok(exported.files.includes("EXPORT.md"));

    // Receiving agent: validate + read export folder only
    const consumed = await validateHandoffTarget(exported.folderPath);
    assert.equal(consumed.ok, true);
    assert.equal(consumed.package.id, successor.id);
    assert.equal(consumed.package.previousHandoffId, created.id);
    assert.equal(consumed.package.execution.status, "awaiting_input");
    const reRead = await readHandoffPackage(exported.folderPath);
    assert.ok(
      reRead.package.execution.events.some((e) => e.kind === "agent_reported"),
    );
    // Still no fabricated verified completion
    assert.ok(
      !reRead.package.execution.events.some(
        (e) =>
          e.kind === "verified_event" &&
          /succeeded|completed the task/i.test(e.detail) &&
          e.tool === "agent.mark",
      ),
    );
  });
});
