import { createHash, randomUUID } from "node:crypto";
import {
  PortableHandoffPackageSchema,
  UNTRUSTED_CONTENT_WARNING,
  type PortableHandoffPackage,
  type PortableScreenshotRef,
} from "@tabhandoff/protocol";
import {
  BRIDGE_MAX_INSTRUCTION_CHARS,
  BRIDGE_MAX_SCREENSHOTS,
  BRIDGE_MAX_SCREENSHOT_BYTES,
  BRIDGE_MAX_SELECTED_TEXT_CHARS,
  BRIDGE_MAX_TITLE_CHARS,
} from "./limits.js";

export type CaptureInput = {
  url: string;
  title?: string;
  selectedText?: string;
  instruction: string;
  intendedOutcome?: string;
  constraints?: string[];
  screenshots?: Array<{
    mediaType?: string;
    dataBase64: string;
    filename?: string;
  }>;
  source?: PortableHandoffPackage["source"];
  id?: string;
  capturedAt?: string;
};

export class PackageValidationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_url"
      | "instruction_required"
      | "instruction_too_long"
      | "title_too_long"
      | "selected_text_too_long"
      | "too_many_screenshots"
      | "screenshot_too_large"
      | "invalid_screenshot"
      | "invalid_package",
  ) {
    super(message);
    this.name = "PackageValidationError";
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function assertHttpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PackageValidationError("URL is not valid.", "invalid_url");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PackageValidationError(
      "Only http(s) page URLs can be handed off.",
      "invalid_url",
    );
  }
}

function decodeBase64Size(b64: string): number {
  const cleaned = b64.replace(/\s/g, "");
  const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
  return Math.floor((cleaned.length * 3) / 4) - padding;
}

function sha256OfBase64(b64: string): string {
  return createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex");
}

/**
 * Build a portable handoff package from browser capture input.
 * Never invents execution history — status is always package_created / agentLaunched false
 * unless the caller later updates events from verified sources.
 */
export function buildPortablePackage(input: CaptureInput): PortableHandoffPackage {
  const instruction = (input.instruction ?? "").trim();
  if (!instruction) {
    throw new PackageValidationError(
      "Write a short instruction for the next person or bot.",
      "instruction_required",
    );
  }
  if (instruction.length > BRIDGE_MAX_INSTRUCTION_CHARS) {
    throw new PackageValidationError(
      `Instruction is too long (max ${BRIDGE_MAX_INSTRUCTION_CHARS} characters).`,
      "instruction_too_long",
    );
  }

  assertHttpUrl(input.url);

  const title = truncate((input.title ?? "").trim(), BRIDGE_MAX_TITLE_CHARS);

  const selectedRaw = truncate(
    (input.selectedText ?? "").trim(),
    BRIDGE_MAX_SELECTED_TEXT_CHARS,
  );

  const shotsIn = input.screenshots ?? [];
  if (shotsIn.length > BRIDGE_MAX_SCREENSHOTS) {
    throw new PackageValidationError(
      `Too many screenshots (max ${BRIDGE_MAX_SCREENSHOTS}).`,
      "too_many_screenshots",
    );
  }

  const screenshots: PortableScreenshotRef[] = [];
  for (let i = 0; i < shotsIn.length; i++) {
    const s = shotsIn[i]!;
    const data = (s.dataBase64 ?? "").replace(/^data:[^;]+;base64,/, "");
    if (!data || !/^[A-Za-z0-9+/=\s]+$/.test(data)) {
      throw new PackageValidationError(
        "Screenshot data is not valid base64.",
        "invalid_screenshot",
      );
    }
    const size = decodeBase64Size(data);
    if (size > BRIDGE_MAX_SCREENSHOT_BYTES) {
      throw new PackageValidationError(
        `Screenshot is too large (max ${BRIDGE_MAX_SCREENSHOT_BYTES} bytes).`,
        "screenshot_too_large",
      );
    }
    const filename =
      s.filename?.replace(/[^a-zA-Z0-9._-]/g, "_") ||
      `capture-${String(i + 1).padStart(2, "0")}.png`;
    screenshots.push({
      filename,
      mediaType: s.mediaType ?? "image/png",
      sha256: sha256OfBase64(data),
      dataBase64: data,
    });
  }

  const now = input.capturedAt ?? new Date().toISOString();
  const id = input.id ?? randomUUID();

  const pkg: PortableHandoffPackage = {
    schemaVersion: "0.1",
    id,
    capturedAt: now,
    source: input.source ?? { kind: "browser_extension" },
    page: {
      url: input.url,
      title,
      selectedText: selectedRaw || undefined,
    },
    instruction,
    intendedOutcome: input.intendedOutcome?.trim() || undefined,
    constraints: input.constraints ?? [],
    previousResults: [],
    remainingWork: [
      "Complete the user's instruction using the captured page context.",
    ],
    screenshots,
    execution: {
      status: "package_created",
      agentLaunched: false,
      events: [
        {
          at: now,
          kind: "verified_event",
          tool: "extension.package",
          detail:
            "Portable handoff package created from the browser. No agent was launched.",
          ok: true,
        },
      ],
    },
    untrustedContentWarning: UNTRUSTED_CONTENT_WARNING,
  };

  const parsed = PortableHandoffPackageSchema.safeParse(pkg);
  if (!parsed.success) {
    throw new PackageValidationError(
      "Built package failed schema validation.",
      "invalid_package",
    );
  }
  return parsed.data;
}

/** Strip in-transit base64 so on-disk JSON stays lean (files live beside it). */
export function packageForDisk(
  pkg: PortableHandoffPackage,
): PortableHandoffPackage {
  return {
    ...pkg,
    screenshots: pkg.screenshots.map(({ dataBase64: _drop, ...rest }) => rest),
  };
}

function statusHeadline(pkg: PortableHandoffPackage): string {
  const st = pkg.execution.status;
  const label = pkg.execution.workflowLabel;
  if (st === "package_created") {
    return "Package created — **no agent was launched**.";
  }
  if (st === "queued" || st === "running") {
    return label
      ? `In progress — ${label}.`
      : "Supported workflow in progress.";
  }
  if (st === "succeeded") {
    if (pkg.execution.mode === "dom") {
      return "Page extraction finished (**deterministic DOM — not autonomous AI**).";
    }
    if (pkg.execution.mode === "llm") {
      return "Model-assisted isolated browser finished.";
    }
    return label ? `Finished — ${label}.` : "Workflow finished.";
  }
  if (st === "failed") {
    return label
      ? `Failed — ${label}. Partial evidence kept.`
      : "Workflow failed. Partial evidence kept.";
  }
  return `Status: ${st}.`;
}

export function renderSummaryMarkdown(pkg: PortableHandoffPackage): string {
  const selected = pkg.page.selectedText
    ? `\n## Selected text\n\n> ${pkg.page.selectedText.replace(/\n/g, "\n> ")}\n`
    : "";
  const shots =
    pkg.screenshots.length > 0
      ? pkg.screenshots
          .map(
            (s) =>
              `- \`${s.filename}\`${s.sha256 ? ` (sha256:${s.sha256.slice(0, 12)}…)` : ""}`,
          )
          .join("\n")
      : "- (none)";

  const modeLine = pkg.execution.mode
    ? `\n**Mode:** \`${pkg.execution.mode}\`${
        pkg.execution.mode === "dom"
          ? " (page extraction — not autonomous AI)"
          : " (model-assisted; API key present)"
      }`
    : "";

  return `# TabHandoff package

**Status:** ${statusHeadline(pkg)}  
**Handoff ID:** \`${pkg.id}\`  
**Captured:** ${pkg.capturedAt}  
**Schema:** ${pkg.schemaVersion}
${modeLine}
**Agent launched:** ${pkg.execution.agentLaunched ? "yes" : "no"}

## What to do

${pkg.instruction}

## Page

- **Title:** ${pkg.page.title || "(untitled)"}
- **URL:** ${pkg.page.url}
${selected}
## Screenshots

${shots}

## Remaining work

${pkg.remainingWork.map((w) => `- ${w}`).join("\n") || "- (none listed)"}

## Previous results

${
  pkg.previousResults.length
    ? pkg.previousResults.map((r) => `- ${r}`).join("\n")
    : "- (none — do not invent history)"
}

## Recorded events

${pkg.execution.events
  .map(
    (e) =>
      `- **${e.at}** · ${e.kind}${e.tool ? ` · \`${e.tool}\`` : ""} — ${e.detail}`,
  )
  .join("\n")}

## Trust note

${pkg.untrustedContentWarning}
`;
}

/** Minimal Task Card YAML compatible with existing receipt layout. */
export function renderTaskCardYaml(pkg: PortableHandoffPackage): string {
  const escape = (s: string) =>
    JSON.stringify(s); /* safe scalar quoting */
  const tags =
    pkg.execution.mode === "dom"
      ? ["browser-extension", "page-extraction"]
      : pkg.execution.mode === "llm"
        ? ["browser-extension", "llm-browser"]
        : ["browser-extension", "package-only"];
  const description =
    pkg.execution.status === "package_created"
      ? "Created from the TabHandoff browser extension (package only)."
      : pkg.execution.workflowLabel ||
        "Created from the TabHandoff browser extension.";
  return `schemaVersion: "0.1"
name: ${escape(pkg.page.title || "Browser handoff")}
description: ${escape(description)}
startUrl: ${escape(pkg.page.url)}
instruction: ${escape(pkg.instruction)}
successHints: []
tags:
${tags.map((t) => `  - ${t}`).join("\n")}
sourceHandoffId: ${escape(pkg.id)}
createdAt: ${escape(pkg.capturedAt)}
`;
}
