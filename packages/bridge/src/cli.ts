#!/usr/bin/env node
import { loadOrCreateBridgeConfig, configFileHint, redactedConfig } from "./config.js";
import { tabHandoffHome } from "./home.js";
import { startBridgeServer } from "./server.js";
import { BRIDGE_DEFAULT_PORT } from "./limits.js";

function parsePort(argv: string[]): number | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port" && argv[i + 1]) {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0 && n < 65536) return n;
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  const home = tabHandoffHome();
  const port = parsePort(process.argv.slice(2)) ?? BRIDGE_DEFAULT_PORT;
  const config = await loadOrCreateBridgeConfig({ home, port });

  console.log(`TabHandoff local bridge`);
  console.log(`  Home:   ${home}`);
  console.log(`  Listen: http://${config.host}:${config.port} (this computer only)`);
  console.log(`  Config: ${configFileHint(home)}`);
  console.log(``);
  console.log(`Paste this token into the TabHandoff extension settings:`);
  console.log(`  ${config.token}`);
  console.log(``);
  console.log(`(Token is also in bridge.json — never share it or put it in screenshots.)`);
  console.log(`Health check: curl -s http://127.0.0.1:${config.port}/health`);
  console.log(`Redacted config: ${JSON.stringify(redactedConfig(config))}`);
  console.log(``);
  console.log(`Leave this running while you hand off tabs from the browser.`);
  console.log(`Press Ctrl+C to stop.`);

  const server = await startBridgeServer({ config, home });

  const shutdown = async () => {
    console.log(`\nStopping bridge…`);
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error(`Bridge failed to start: ${(err as Error).message}`);
  process.exit(1);
});
