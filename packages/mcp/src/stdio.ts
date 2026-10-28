#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTabHandoffServer } from "./server.js";

async function main() {
  const server = createTabHandoffServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("TabHandoff MCP failed to start:", err);
  process.exit(1);
});
