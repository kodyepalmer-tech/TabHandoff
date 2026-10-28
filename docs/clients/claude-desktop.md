# Claude Desktop + tabhandoff MCP

Claude Desktop supports local **stdio** MCP via Developer config.

## Config

Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`; Linux varies by install):

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

Restart Claude Desktop. Confirm tools `handoff_create`, `handoff_status`, `handoff_receipt` appear.

## Fallback

If MCP config fails: use the CLI alone —

```bash
node packages/cli/dist/index.js run --url https://example.com --instruction "Extract headings" --wait
```
