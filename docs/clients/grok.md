# Grok (xAI) + tabhandoff

## Grok Build / CLI (local MCP) ✅

Grok Build loads MCP from `~/.grok/config.toml` (and can merge Cursor/Claude configs). Add a **stdio** server:

```toml
[mcp_servers.tabhandoff]
command = "node"
args = ["/ABS/PATH/TO/tabhandoff/packages/mcp/dist/stdio.js"]
```

Or:

```bash
# illustrative — use your grok CLI’s mcp add for stdio when available
grok mcp add --transport stdio tabhandoff -- node /ABS/PATH/TO/tabhandoff/packages/mcp/dist/stdio.js
```

Run `grok mcp doctor tabhandoff` (or `/mcps` in the TUI) to verify.

## grok.com connectors (remote only)

Custom connectors at grok.com expect a **public HTTPS** MCP URL. A process on localhost needs a tunnel (ngrok/Cloudflare/etc.) **or** wait for hosted relay.

## Fallback

```bash
node packages/cli/dist/index.js run --url https://example.com --instruction "Extract the main heading" --wait
node packages/cli/dist/index.js receipt <id>
```
