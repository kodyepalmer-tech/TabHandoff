import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPortablePackage,
  packageForDisk,
  renderSummaryMarkdown,
  PackageValidationError,
} from "../src/package.ts";
import { BRIDGE_MAX_INSTRUCTION_CHARS } from "../src/limits.ts";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("buildPortablePackage", () => {
  it("builds a package_created handoff with no invented history", () => {
    const pkg = buildPortablePackage({
      url: "https://example.com/plans",
      title: "Plans",
      selectedText: "Option A vs B",
      instruction: "Compare these plans and recommend the best option.",
      screenshots: [{ dataBase64: tinyPngBase64 }],
    });

    assert.equal(pkg.schemaVersion, "0.1");
    assert.equal(pkg.execution.status, "package_created");
    assert.equal(pkg.execution.agentLaunched, false);
    assert.equal(pkg.previousResults.length, 0);
    assert.ok(pkg.execution.events.every((e) => e.kind === "verified_event"));
    assert.match(pkg.execution.events[0]!.detail, /No agent was launched/i);
    assert.equal(pkg.screenshots.length, 1);
    assert.ok(pkg.screenshots[0]!.sha256);
    assert.ok(pkg.untrustedContentWarning.length > 10);
  });

  it("strips base64 for on-disk JSON", () => {
    const pkg = buildPortablePackage({
      url: "https://example.com",
      instruction: "Summarize this page.",
      screenshots: [{ dataBase64: tinyPngBase64, filename: "shot.png" }],
    });
    const disk = packageForDisk(pkg);
    assert.equal(disk.screenshots[0]!.dataBase64, undefined);
    assert.equal(disk.screenshots[0]!.filename, "shot.png");
    assert.ok(disk.screenshots[0]!.sha256);
  });

  it("summary markdown states package-only honestly", () => {
    const pkg = buildPortablePackage({
      url: "https://example.com",
      instruction: "Research this product.",
    });
    const md = renderSummaryMarkdown(pkg);
    assert.match(md, /no agent was launched/i);
    assert.match(md, /do not invent history/i);
    assert.ok(md.includes(pkg.id));
  });

  it("rejects missing instruction", () => {
    assert.throws(
      () =>
        buildPortablePackage({
          url: "https://example.com",
          instruction: "   ",
        }),
      (e: unknown) =>
        e instanceof PackageValidationError && e.code === "instruction_required",
    );
  });

  it("rejects non-http URLs", () => {
    assert.throws(
      () =>
        buildPortablePackage({
          url: "chrome://extensions",
          instruction: "Do something",
        }),
      (e: unknown) =>
        e instanceof PackageValidationError && e.code === "invalid_url",
    );
  });

  it("rejects oversized instruction", () => {
    assert.throws(
      () =>
        buildPortablePackage({
          url: "https://example.com",
          instruction: "x".repeat(BRIDGE_MAX_INSTRUCTION_CHARS + 1),
        }),
      (e: unknown) =>
        e instanceof PackageValidationError && e.code === "instruction_too_long",
    );
  });
});
