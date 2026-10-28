import { z } from "zod";

/** Job lifecycle */
export const HandoffStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export type HandoffStatus = z.infer<typeof HandoffStatusSchema>;

export const CreateHandoffInputSchema = z.object({
  url: z.string().url().describe("Public start URL for the handoff"),
  instruction: z
    .string()
    .min(1)
    .describe("What the agent should do on the page"),
  note: z.string().optional().describe("Optional human note / context"),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
});
export type CreateHandoffInput = z.infer<typeof CreateHandoffInputSchema>;

export const CreateHandoffResultSchema = z.object({
  id: z.string(),
  status: HandoffStatusSchema,
  createdAt: z.string(),
});
export type CreateHandoffResult = z.infer<typeof CreateHandoffResultSchema>;

export const StatusInputSchema = z.object({
  id: z.string().min(1),
});
export type StatusInput = z.infer<typeof StatusInputSchema>;

export const HandoffActionSchema = z.object({
  at: z.string(),
  tool: z.string(),
  detail: z.string(),
  ok: z.boolean(),
});
export type HandoffAction = z.infer<typeof HandoffActionSchema>;

export const HandoffJobSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  instruction: z.string(),
  note: z.string().optional(),
  status: HandoffStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  error: z.string().optional(),
  resultSummary: z.string().optional(),
  actions: z.array(HandoffActionSchema).default([]),
  receiptDir: z.string().optional(),
  screenshotPaths: z.array(z.string()).default([]),
  receiptPath: z.string().optional(),
  cardPath: z.string().optional(),
});
export type HandoffJob = z.infer<typeof HandoffJobSchema>;

export const ReceiptInputSchema = z.object({
  id: z.string().min(1),
  includeContent: z.boolean().optional().default(true),
});
export type ReceiptInput = z.infer<typeof ReceiptInputSchema>;

export const ReceiptResultSchema = z.object({
  id: z.string(),
  status: HandoffStatusSchema,
  receiptDir: z.string().optional(),
  receiptPath: z.string().optional(),
  cardPath: z.string().optional(),
  screenshotPaths: z.array(z.string()).default([]),
  receiptMarkdown: z.string().optional(),
  error: z.string().optional(),
});
export type ReceiptResult = z.infer<typeof ReceiptResultSchema>;

/** Portable Task Card — remixable recipe */
export const TaskCardSchema = z.object({
  schemaVersion: z.literal("0.1"),
  name: z.string(),
  description: z.string().optional(),
  startUrl: z.string().url(),
  instruction: z.string(),
  successHints: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  sourceHandoffId: z.string().optional(),
  createdAt: z.string(),
});
export type TaskCard = z.infer<typeof TaskCardSchema>;

export const MCP_TOOL_NAMES = {
  create: "handoff_create",
  status: "handoff_status",
  receipt: "handoff_receipt",
} as const;

/** Human-facing aliases used in docs (dot form) */
export const MCP_TOOL_ALIASES = {
  "handoff.create": MCP_TOOL_NAMES.create,
  "handoff.status": MCP_TOOL_NAMES.status,
  "handoff.receipt": MCP_TOOL_NAMES.receipt,
} as const;

export const PROTOCOL_VERSION = "0.1.0";
