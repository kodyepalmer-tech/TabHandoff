import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { bridgeConfigPath, tabHandoffHome } from "./home.js";
import { BRIDGE_DEFAULT_PORT } from "./limits.js";

export type BridgeConfig = {
  version: "0.1";
  host: "127.0.0.1";
  port: number;
  /** Shared secret for extension → bridge. Never log this value. */
  token: string;
  createdAt: string;
  updatedAt: string;
};

export async function loadOrCreateBridgeConfig(options?: {
  home?: string;
  port?: number;
}): Promise<BridgeConfig> {
  const home = tabHandoffHome(options?.home);
  await mkdir(home, { recursive: true });
  const cfgPath = bridgeConfigPath(home);

  try {
    const raw = await readFile(cfgPath, "utf8");
    const parsed = JSON.parse(raw) as BridgeConfig;
    if (
      parsed?.version === "0.1" &&
      parsed.host === "127.0.0.1" &&
      typeof parsed.port === "number" &&
      typeof parsed.token === "string" &&
      parsed.token.length >= 16
    ) {
      if (options?.port && options.port !== parsed.port) {
        const next: BridgeConfig = {
          ...parsed,
          port: options.port,
          updatedAt: new Date().toISOString(),
        };
        await writeFile(cfgPath, JSON.stringify(next, null, 2), "utf8");
        return next;
      }
      return parsed;
    }
  } catch {
    /* create new */
  }

  const now = new Date().toISOString();
  const cfg: BridgeConfig = {
    version: "0.1",
    host: "127.0.0.1",
    port: options?.port ?? BRIDGE_DEFAULT_PORT,
    token: randomBytes(24).toString("base64url"),
    createdAt: now,
    updatedAt: now,
  };
  await writeFile(cfgPath, JSON.stringify(cfg, null, 2), "utf8");
  // Restrictive mode on POSIX when possible
  try {
    const { chmod } = await import("node:fs/promises");
    await chmod(cfgPath, 0o600);
  } catch {
    /* ignore on platforms without chmod semantics */
  }
  return cfg;
}

export function redactedConfig(cfg: BridgeConfig): Omit<BridgeConfig, "token"> & {
  token: string;
} {
  return {
    ...cfg,
    token: `${cfg.token.slice(0, 4)}…(hidden)`,
  };
}

export function configFileHint(home?: string): string {
  return path.normalize(bridgeConfigPath(home));
}
