import type { ActivityFilters, ActivityRecord } from "./types.js";

export function filterActivities(
  records: ActivityRecord[],
  filters: ActivityFilters = {},
): ActivityRecord[] {
  const q = filters.query?.trim().toLowerCase();
  const status = filters.status && filters.status !== "all" ? filters.status : undefined;
  const host = filters.hostname?.trim().toLowerCase();
  const since = filters.since?.trim();
  const until = filters.until?.trim();

  return records.filter((r) => {
    if (status && r.status !== status) return false;
    if (host && r.hostname.toLowerCase() !== host && !r.hostname.toLowerCase().includes(host)) {
      return false;
    }
    if (since) {
      const day = r.createdAt.slice(0, 10);
      if (day < since) return false;
    }
    if (until) {
      const day = r.createdAt.slice(0, 10);
      if (day > until) return false;
    }
    if (q) {
      const hay = [
        r.id,
        r.url,
        r.hostname,
        r.pageTitle ?? "",
        r.instruction,
        r.note ?? "",
        r.resultSummary ?? "",
        r.tags.join(" "),
        r.status,
      ]
        .join("\n")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function uniqueHostnames(records: ActivityRecord[]): string[] {
  return [...new Set(records.map((r) => r.hostname))].sort();
}
