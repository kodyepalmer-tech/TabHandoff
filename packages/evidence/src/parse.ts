import type { HandoffAction, HandoffStatus } from "@tabhandoff/protocol";
import type { ParsedCard, ReceiptJobSnapshot } from "./types.js";

const STATUS_SET = new Set<HandoffStatus>([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname || "unknown";
  } catch {
    return "unknown";
  }
}

export function asStatus(value: unknown, fallback: HandoffStatus = "succeeded"): HandoffStatus {
  if (typeof value === "string" && STATUS_SET.has(value as HandoffStatus)) {
    return value as HandoffStatus;
  }
  return fallback;
}

/** Minimal YAML reader for Task Cards written by the runner (no YAML dependency). */
export function parseCardYaml(raw: string): ParsedCard {
  const out: ParsedCard = {};
  const lines = raw.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const m = /^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      i += 1;
      continue;
    }
    const key = m[1]!;
    let val = m[2]!.trim();
    if (val === "|") {
      const block: string[] = [];
      i += 1;
      while (i < lines.length) {
        const bl = lines[i] ?? "";
        if (bl.startsWith("  ") || bl === "") {
          block.push(bl.startsWith("  ") ? bl.slice(2) : "");
          i += 1;
        } else break;
      }
      val = block.join("\n").replace(/\n+$/, "");
      assignCardField(out, key, val);
      continue;
    }
    if (val === "" && (key === "tags" || key === "successHints")) {
      const arr: string[] = [];
      i += 1;
      while (i < lines.length) {
        const al = lines[i] ?? "";
        const am = /^\s+-\s+(.*)$/.exec(al);
        if (!am) break;
        arr.push(unquote(am[1]!.trim()));
        i += 1;
      }
      if (key === "tags") out.tags = arr;
      continue;
    }
    assignCardField(out, key, unquote(val));
    i += 1;
  }
  return out;
}

function unquote(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    try {
      return JSON.parse(s.replace(/^'/, '"').replace(/'$/, '"')) as string;
    } catch {
      return s.slice(1, -1);
    }
  }
  return s;
}

function assignCardField(out: ParsedCard, key: string, val: string): void {
  switch (key) {
    case "name":
      out.name = val;
      break;
    case "description":
      out.description = val;
      break;
    case "startUrl":
      out.startUrl = val;
      break;
    case "instruction":
      out.instruction = val;
      break;
    case "sourceHandoffId":
      out.sourceHandoffId = val;
      break;
    case "createdAt":
      out.createdAt = val;
      break;
    default:
      break;
  }
}

export function parseReceiptMarkdown(raw: string): {
  id?: string;
  status?: HandoffStatus;
  url?: string;
  mode?: "dom" | "llm";
  when?: string;
  instruction?: string;
  note?: string;
  error?: string;
  result?: string;
  actions: HandoffAction[];
  screenshotPaths: string[];
  pageTitle?: string;
} {
  const actions: HandoffAction[] = [];
  const screenshotPaths: string[] = [];
  const pick = (label: string): string | undefined => {
    const re = new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|\\s*([^|]+)\\|`, "i");
    const m = re.exec(raw);
    return m?.[1]?.replace(/`/g, "").trim();
  };

  const id = pick("ID");
  const statusRaw = pick("Status");
  const url = pick("URL");
  const modeRaw = pick("Mode");
  const when = pick("When");

  const section = (name: string): string | undefined => {
    const re = new RegExp(`## ${name}\\s*\\n([\\s\\S]*?)(?=\\n## |\\n---|$)`, "i");
    const m = re.exec(raw);
    return m?.[1]?.trim();
  };

  const instruction = section("Instruction");
  const note = section("Note");
  const error = section("Error");
  const result = section("Result");
  const actionsBlock = section("Actions") ?? "";
  const shotsBlock = section("Screenshots") ?? "";

  for (const line of actionsBlock.split("\n")) {
    const am =
      /^-\s*([✓✗])\s*`([^`]+)`\s*—\s*(.+?)\s*_\(([^)]+)\)_\s*$/.exec(line.trim()) ||
      /^-\s*([✓✗])\s*`([^`]+)`\s*—\s*(.+)$/.exec(line.trim());
    if (!am) continue;
    actions.push({
      ok: am[1] === "✓",
      tool: am[2]!,
      detail: am[3]!.trim(),
      at: am[4] ?? when ?? new Date(0).toISOString(),
    });
  }

  for (const line of shotsBlock.split("\n")) {
    const sm = /`([^`]+)`/.exec(line);
    if (sm) screenshotPaths.push(sm[1]!);
  }

  let pageTitle: string | undefined;
  if (result) {
    const hm = /^#\s+(.+)$/m.exec(result);
    if (hm) pageTitle = hm[1]!.trim();
  }

  return {
    id,
    status: statusRaw ? asStatus(statusRaw) : undefined,
    url,
    mode: modeRaw === "llm" || modeRaw === "dom" ? modeRaw : undefined,
    when,
    instruction,
    note,
    error,
    result,
    actions,
    screenshotPaths,
    pageTitle,
  };
}

export function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export type { ReceiptJobSnapshot };
