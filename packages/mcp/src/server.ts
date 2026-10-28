import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CreateHandoffInputSchema,
  PROTOCOL_VERSION,
} from "@tabhandoff/protocol";
import { createAndQueue, getStatus } from "./orchestrator.js";
import { tabHandoffHome } from "./home.js";

function textResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * MCP tools map to protocol verbs:
 *   handoff.create  → handoff_create
 *   handoff.status  → handoff_status
 *   handoff.receipt → handoff_receipt
 *
 * (MCP tool names use underscores; docs use the dotted protocol form.)
 */
export function createTabHandoffServer(): McpServer {
  const server = new McpServer({
    name: "tabhandoff",
    version: PROTOCOL_VERSION,
  });

  server.tool(
    "handoff_create",
    "Create a TabHandoff (Capture→Package→Continue): navigate an isolated browser to a public URL and follow the instruction. No cookies/creds. Returns job id; poll handoff_status / handoff_receipt.",
    {
      url: z.string().url().describe("Public start URL"),
      instruction: z.string().min(1).describe("What TabHandoff should do"),
      note: z.string().optional().describe("Optional human note"),
      timeoutMs: z.number().int().positive().max(600_000).optional(),
    },
    async (args) => {
      const input = CreateHandoffInputSchema.parse(args);
      const job = await createAndQueue(input);
      return textResult({
        id: job.id,
        status: job.status,
        createdAt: job.createdAt,
        receiptDir: job.receiptDir,
        home: tabHandoffHome(),
        hint: "Poll handoff_status with this id; when succeeded/failed call handoff_receipt.",
      });
    },
  );

  server.tool(
    "handoff_status",
    "Get status of a TabHandoff job by id.",
    {
      id: z.string().min(1).describe("Handoff job id from handoff_create"),
    },
    async ({ id }) => {
      const job = await getStatus(id);
      if (!job) {
        return textResult({ error: `Unknown handoff id: ${id}` });
      }
      return textResult({
        id: job.id,
        status: job.status,
        url: job.url,
        instruction: job.instruction,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        error: job.error,
        resultSummary: job.resultSummary,
        actionCount: job.actions?.length ?? 0,
        receiptPath: job.receiptPath,
        cardPath: job.cardPath,
      });
    },
  );

  server.tool(
    "handoff_receipt",
    "Fetch the shareable TabHandoff receipt (markdown + screenshots + Task Card paths).",
    {
      id: z.string().min(1).describe("Handoff job id"),
      includeContent: z
        .boolean()
        .optional()
        .default(true)
        .describe("Include receipt markdown body"),
    },
    async ({ id, includeContent }) => {
      const job = await getStatus(id);
      if (!job) {
        return textResult({ error: `Unknown handoff id: ${id}` });
      }

      let receiptMarkdown: string | undefined;
      if (includeContent !== false && job.receiptPath) {
        try {
          receiptMarkdown = await readFile(job.receiptPath, "utf8");
        } catch {
          receiptMarkdown = undefined;
        }
      }

      return textResult({
        id: job.id,
        status: job.status,
        receiptDir: job.receiptDir,
        receiptPath: job.receiptPath,
        cardPath: job.cardPath,
        screenshotPaths: job.screenshotPaths ?? [],
        receiptMarkdown,
        error: job.error,
      });
    },
  );

  return server;
}
