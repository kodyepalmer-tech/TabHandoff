import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ActivityRecord } from "./types.js";
import { getActivityById, readCardYaml, readReceiptMarkdown } from "./indexReceipts.js";

/**
 * Export a human-readable + structured report next to (not overwriting) the receipt folder.
 * Always writes new files under `<receiptDir>/exports/<timestamp>/`.
 */
export async function exportActivityReport(
  id: string,
  options?: { home?: string; outDir?: string },
): Promise<{ reportDir: string; markdownPath: string; jsonPath: string }> {
  const record = await getActivityById(id, options);
  if (!record) throw new Error(`No evidence found for id: ${id}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir =
    options?.outDir?.trim() ||
    path.join(record.receiptDir, "exports", stamp);

  await mkdir(reportDir, { recursive: true });

  const receiptMd = (await readReceiptMarkdown(id, options)) ?? "_Receipt markdown missing._";
  const cardYaml = (await readCardYaml(id, options)) ?? "";

  const markdownPath = path.join(reportDir, "report.md");
  const jsonPath = path.join(reportDir, "activity.json");

  const md = renderExportMarkdown(record, receiptMd, cardYaml);
  await writeFile(markdownPath, md, "utf8");
  // Structured JSON for agents — do not require reverse-engineering prose.
  await writeFile(jsonPath, JSON.stringify(toExportPayload(record), null, 2), "utf8");

  return { reportDir, markdownPath, jsonPath };
}

export function toExportPayload(record: ActivityRecord) {
  return {
    schemaVersion: record.schemaVersion,
    kind: "tabhandoff.activity_export",
    exportedAt: new Date().toISOString(),
    activity: record,
    evidenceKinds: {
      verified_event: "Independently recorded by the TabHandoff runner/store",
      agent_reported: "Result or error text produced by extraction/agent — not independently verified",
      suggestion: "Proposed next step; not verified completion",
    },
    untrustedContentWarning: record.untrustedContent.warning,
  };
}

function renderExportMarkdown(
  record: ActivityRecord,
  receiptMd: string,
  cardYaml: string,
): string {
  const lines = [
    `# TabHandoff activity report`,
    ``,
    `| | |`,
    `|---|---|`,
    `| **ID** | \`${record.id}\` |`,
    `| **Status** | ${record.status} |`,
    `| **URL** | ${record.url} |`,
    `| **When** | ${record.createdAt} |`,
    `| **Screenshots** | ${record.screenshotCount} |`,
    ``,
    `## Instruction`,
    record.instruction,
    ``,
  ];
  if (record.note) lines.push(`## Note`, record.note, ``);
  if (record.resultSummary) {
    lines.push(
      `## Result summary`,
      `_Labeled agent-reported — not independently verified._`,
      ``,
      record.resultSummary,
      ``,
    );
  }
  lines.push(`## Timeline`);
  for (const e of record.timeline) {
    const mark =
      e.kind === "verified_event" ? "verified" : e.kind === "agent_reported" ? "reported" : "suggestion";
    lines.push(
      `- [${mark}] ${e.ok === false ? "✗" : "·"} ${e.tool ? `\`${e.tool}\` — ` : ""}${e.detail} _(${e.at})_`,
    );
  }
  lines.push(
    ``,
    `## Untrusted content notice`,
    record.untrustedContent.warning,
    ``,
    `## Receipt`,
    ``,
    receiptMd,
    ``,
  );
  if (cardYaml.trim()) {
    lines.push(`## Task Card`, ``, "```yaml", cardYaml.trim(), "```", ``);
  }
  lines.push(
    `---`,
    `_Export does not modify original evidence. History is preserved._`,
    ``,
  );
  return lines.join("\n");
}
