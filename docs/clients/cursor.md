# Cursor + tabhandoff MCP

Cursor supports local **stdio** MCP servers via `~/.cursor/mcp.json` or project `.cursor/mcp.json`.

## Config

After `pnpm build` in this repo:

```json
{
  "mcpServers": {
    "tabhandoff": {
      "command": "node",
      "args": ["/ABS/PATH/TO/tabhandoff/packages/mcp/dist/stdio.js"]
    }
  }
}
```

Replace `/ABS/PATH/TO/tabhandoff` with your clone path. Or run `node packages/cli/dist/index.js init` and paste the printed block.

## Tools (protocol aliases)

| MCP tool | Protocol verb |
|---|---|
| `handoff_create` | `handoff.create` |
| `handoff_status` | `handoff.status` |
| `handoff_receipt` | `handoff.receipt` |

## Try

In Cursor chat (with MCP enabled): create a handoff to `https://example.com` with instruction “Extract the main heading”, then poll status and fetch the receipt.
