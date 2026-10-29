import { homedir } from "node:os";
import path from "node:path";

export function tabHandoffHome(override?: string): string {
  if (override?.trim()) return override.trim();
  return process.env.TABHANDOFF_HOME?.trim() || path.join(homedir(), ".tabhandoff");
}

export function jobsDir(home?: string): string {
  return path.join(tabHandoffHome(home), "jobs");
}

export function receiptsDir(home?: string): string {
  return path.join(tabHandoffHome(home), "receipts");
}

export function bridgeConfigPath(home?: string): string {
  return path.join(tabHandoffHome(home), "bridge.json");
}
