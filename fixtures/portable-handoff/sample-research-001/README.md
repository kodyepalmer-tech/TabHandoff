# Sample portable handoff (`sample-research-001`)

Machine-readable example for agents. Source of truth: `handoff.json`.

```bash
pnpm build
node packages/cli/dist/index.js validate fixtures/portable-handoff/sample-research-001
node packages/cli/dist/index.js read fixtures/portable-handoff/sample-research-001
```

See [docs/schema.md](../../docs/schema.md) and [docs/agents.md](../../docs/agents.md).
