import { homedir } from "node:os";
import path from "node:path";

export function tabHandoffHome(): string {
  return process.env.TABHANDOFF_HOME?.trim() || path.join(homedir(), ".tabhandoff");
}

export function jobsDir(): string {
  return path.join(tabHandoffHome(), "jobs");
}

export function receiptsDir(): string {
  return path.join(tabHandoffHome(), "receipts");
}

export function configPath(): string {
  return path.join(tabHandoffHome(), "config.json");
}
