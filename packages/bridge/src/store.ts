import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HandoffJob, PortableHandoffPackage } from "@tabhandoff/protocol";
import { jobsDir, receiptsDir, tabHandoffHome } from "./home.js";
import {
  packageForDisk,
  renderSummaryMarkdown,
  renderTaskCardYaml,
} from "./package.js";

export type StoredHandoff = {
  id: string;
  home: string;
  receiptDir: string;
  handoffPath: string;
  summaryPath: string;
  cardPath: string;
  receiptPath: string;
  jobPath: string;
  screenshotPaths: string[];
  /** Honest status at write time — package only until a workflow starts */
  executionStatus: "package_created";
  agentLaunched: false;
  desktopHint: string;
};

export type StoredHandoffStatus = StoredHandoff["executionStatus"];

export async function writeHandoffToHome(
  pkg: PortableHandoffPackage,
  options?: { home?: string },
): Promise<StoredHandoff> {
  const home = tabHandoffHome(options?.home);
  const receiptDir = path.join(receiptsDir(home), pkg.id);
  const shotsDir = path.join(receiptDir, "screenshots");
  await mkdir(shotsDir, { recursive: true });
  await mkdir(jobsDir(home), { recursive: true });

  const screenshotPaths: string[] = [];
  for (const shot of pkg.screenshots) {
    if (!shot.dataBase64) continue;
    const dest = path.join(shotsDir, shot.filename);
    await writeFile(dest, Buffer.from(shot.dataBase64, "base64"));
    screenshotPaths.push(dest);
  }

  const onDisk = packageForDisk(pkg);
  const handoffPath = path.join(receiptDir, "handoff.json");
  const summaryPath = path.join(receiptDir, "summary.md");
  const receiptPath = path.join(receiptDir, "receipt.md");
  const cardPath = path.join(receiptDir, "card.yaml");
  const jobSnapPath = path.join(receiptDir, "job.json");
  const jobPath = path.join(jobsDir(home), `${pkg.id}.json`);

  const summary = renderSummaryMarkdown(onDisk);
  await writeFile(handoffPath, JSON.stringify(onDisk, null, 2), "utf8");
  await writeFile(summaryPath, summary, "utf8");
  await writeFile(receiptPath, summary, "utf8");
  await writeFile(cardPath, renderTaskCardYaml(onDisk), "utf8");

  const now = new Date().toISOString();
  const job: HandoffJob = {
    id: pkg.id,
    url: pkg.page.url,
    instruction: pkg.instruction,
    note: pkg.page.selectedText
      ? `Selected text captured (${pkg.page.selectedText.length} chars). Package only — no agent launched.`
      : "Package only — no agent launched.",
    status: "queued",
    createdAt: pkg.capturedAt,
    updatedAt: now,
    actions: pkg.execution.events.map((e) => ({
      at: e.at,
      tool: e.tool ?? "extension.package",
      detail: e.detail,
      ok: e.ok ?? true,
    })),
    screenshotPaths,
    receiptDir,
    receiptPath,
    cardPath,
  };

  await writeFile(jobSnapPath, JSON.stringify(job, null, 2), "utf8");
  await writeFile(jobPath, JSON.stringify(job, null, 2), "utf8");

  return {
    id: pkg.id,
    home,
    receiptDir,
    handoffPath,
    summaryPath,
    cardPath,
    receiptPath,
    jobPath,
    screenshotPaths,
    executionStatus: "package_created",
    agentLaunched: false,
    desktopHint:
      "Open TabHandoff desktop → My Activity and refresh to see this handoff.",
  };
}
