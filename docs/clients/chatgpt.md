# ChatGPT + tabhandoff

Accurate as of late 2026 — surfaces differ.

## ChatGPT desktop / Codex (local stdio) ✅

The ChatGPT **desktop app**, **Codex CLI**, and IDE extension share MCP config (default `~/.codex/config.toml`). They support local **STDIO** servers.

### Desktop UI

1. Settings → **MCP servers** → Add server  
2. Type: **STDIO**  
3. Command: `node`  
4. Args: `/ABS/PATH/TO/tabhandoff/packages/mcp/dist/stdio.js`  
5. Save → Restart  

### `~/.codex/config.toml`

```toml
[mcp_servers.tabhandoff]
command = "node"
args = ["/ABS/PATH/TO/tabhandoff/packages/mcp/dist/stdio.js"]
```

Verify with `/mcp` in the composer when available.

## ChatGPT web ❌ for raw localhost

ChatGPT **web** uses remote MCP (plugins / custom connectors). `http://localhost…` is rejected. Real paths:

1. **Hosted HTTPS** MCP twin (future TabHandoff Cloud / relay)  
2. **Secure MCP Tunnel** / third-party tunnel to a local HTTP MCP  
3. **CLI fallback** (always works):

```bash
node packages/cli/dist/index.js run --url https://example.com --instruction "Extract the main heading" --wait
```

Paste the TabHandoff receipt markdown from `~/.tabhandoff/receipts/<id>/receipt.md` into chat.
