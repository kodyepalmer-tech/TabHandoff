import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { BridgeConfig } from "./config.js";
import { BRIDGE_MAX_BODY_BYTES } from "./limits.js";
import {
  buildPortablePackage,
  PackageValidationError,
  type CaptureInput,
} from "./package.js";
import { writeHandoffToHome, type StoredHandoff } from "./store.js";
import { tabHandoffHome } from "./home.js";
import { probeBridgeCapabilities } from "./capabilities.js";
import {
  getLiveHandoffStatus,
  startSupportedWorkflow,
  workflowInflightCount,
} from "./execute.js";
import { executeAiRun, type AiRunRequest } from "./ai-run.js";
import type { AiProviderDeps } from "@tabhandoff/runner";

export type BridgeServer = {
  config: BridgeConfig;
  home: string;
  url: string;
  close: () => Promise<void>;
};

type JsonBody = Record<string, unknown>;

function safeEqualToken(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function readBearer(req: http.IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() || null;
}

function isExtensionOrLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true; /* same-origin / no Origin (extension SW sometimes) */
  if (origin.startsWith("chrome-extension://")) return true;
  if (origin.startsWith("moz-extension://")) return true;
  if (origin === "null") return true;
  return false;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  origin?: string,
): void {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  if (origin && isExtensionOrLocalOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Vary"] = "Origin";
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let oversized = false;
    req.on("data", (chunk: Buffer) => {
      if (oversized) return;
      total += chunk.length;
      if (total > maxBytes) {
        oversized = true;
        // Drain remaining data without buffering so the client can finish the request
        // and receive a clean 413 (avoid abrupt socket destroy → fetch failure).
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (oversized) {
        reject(Object.assign(new Error("body_too_large"), { code: "body_too_large" }));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

/** Log without secrets — never print tokens or page content. */
function logLine(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[tabhandoff-bridge ${ts}] ${msg}`);
}

function requireAuth(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: BridgeConfig,
  origin?: string,
): boolean {
  const token = readBearer(req);
  if (!token || !safeEqualToken(token, config.token)) {
    sendJson(res, 401, { ok: false, error: "unauthorized" }, origin);
    return false;
  }
  return true;
}

export async function startBridgeServer(options: {
  config: BridgeConfig;
  home?: string;
  /** Inject for tests */
  onStored?: (stored: StoredHandoff) => void;
  /** Inject runner for tests via execute.startSupportedWorkflow */
  workflowRunner?: Parameters<typeof startSupportedWorkflow>[0]["runner"];
  /** Inject AI provider deps (fetch/env) for /v1/ai/run tests */
  aiDeps?: AiProviderDeps;
}): Promise<BridgeServer> {
  const home = tabHandoffHome(options.home);
  const { config } = options;

  const server = http.createServer(async (req, res) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;

    if (req.method === "OPTIONS") {
      if (!isExtensionOrLocalOrigin(origin)) {
        sendJson(res, 403, { ok: false, error: "origin_not_allowed" });
        return;
      }
      sendJson(res, 204, {}, origin);
      return;
    }

    const url = new URL(req.url ?? "/", `http://${config.host}:${config.port}`);

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(
          res,
          200,
          {
            ok: true,
            service: "tabhandoff-bridge",
            version: "0.1",
            host: config.host,
            port: config.port,
            /** Never expose token here */
            authRequired: true,
          },
          origin,
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/status") {
        if (!requireAuth(req, res, config, origin)) return;
        const caps = await probeBridgeCapabilities();
        sendJson(
          res,
          200,
          {
            ok: true,
            home,
            ready: true,
            agentExecution: caps.llmAgent,
            pageExtraction: caps.pageExtraction,
            aiCompletion: caps.aiCompletion,
            workflows: caps.workflows,
            inflight: workflowInflightCount(),
            message: caps.message,
          },
          origin,
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/ai/run") {
        if (!isExtensionOrLocalOrigin(origin)) {
          sendJson(res, 403, { ok: false, error: "origin_not_allowed" }, origin);
          return;
        }
        if (!requireAuth(req, res, config, origin)) return;

        let raw: Buffer;
        try {
          raw = await readBody(req, BRIDGE_MAX_BODY_BYTES);
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (code === "body_too_large") {
            sendJson(
              res,
              413,
              {
                ok: false,
                error: "body_too_large",
                message: `Body exceeds ${BRIDGE_MAX_BODY_BYTES} bytes.`,
              },
              origin,
            );
            return;
          }
          throw e;
        }

        let json: JsonBody;
        try {
          json = JSON.parse(raw.toString("utf8")) as JsonBody;
        } catch {
          sendJson(
            res,
            400,
            { ok: false, error: "invalid_json", message: "Body must be JSON." },
            origin,
          );
          return;
        }

        const request: AiRunRequest = {
          instruction: String(json.instruction ?? ""),
          url: typeof json.url === "string" ? json.url : undefined,
          title: typeof json.title === "string" ? json.title : undefined,
          selectedText:
            typeof json.selectedText === "string" ? json.selectedText : undefined,
          pageText: typeof json.pageText === "string" ? json.pageText : undefined,
          handoffId:
            typeof json.handoffId === "string" ? json.handoffId : undefined,
        };

        logLine(
          `ai/run start handoffId=${request.handoffId ? "yes" : "no"} url=${request.url ? "yes" : "no"}`,
        );

        const result = await executeAiRun(request, {
          home,
          deps: options.aiDeps,
        });

        // Honest HTTP mapping — never 200-ok a fake success
        const httpStatus =
          result.status === "done"
            ? 200
            : result.status === "unavailable"
              ? 503
              : 502;

        logLine(
          `ai/run status=${result.status} provider=${result.provider ?? "none"} ok=${result.ok}`,
        );

        sendJson(
          res,
          httpStatus,
          {
            ok: result.ok,
            status: result.status,
            provider: result.provider,
            model: result.model,
            result: result.result,
            error: result.error,
            message: result.message,
            handoffId: result.handoffId,
            resultPath: result.resultPath,
            apiKeyIncluded: false,
          },
          origin,
        );
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/v1/handoffs/")) {
        if (!requireAuth(req, res, config, origin)) return;
        const id = decodeURIComponent(url.pathname.slice("/v1/handoffs/".length));
        if (!id || id.includes("/") || id.includes("..")) {
          sendJson(res, 400, { ok: false, error: "invalid_id" }, origin);
          return;
        }
        const status = await getLiveHandoffStatus(home, id);
        if (!status) {
          sendJson(res, 404, { ok: false, error: "not_found" }, origin);
          return;
        }
        sendJson(res, 200, status, origin);
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/handoffs") {
        if (!isExtensionOrLocalOrigin(origin)) {
          sendJson(res, 403, { ok: false, error: "origin_not_allowed" }, origin);
          return;
        }
        if (!requireAuth(req, res, config, origin)) return;

        let raw: Buffer;
        try {
          raw = await readBody(req, BRIDGE_MAX_BODY_BYTES);
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (code === "body_too_large") {
            sendJson(
              res,
              413,
              {
                ok: false,
                error: "body_too_large",
                message: `Package exceeds ${BRIDGE_MAX_BODY_BYTES} bytes.`,
              },
              origin,
            );
            return;
          }
          throw e;
        }

        let json: JsonBody;
        try {
          json = JSON.parse(raw.toString("utf8")) as JsonBody;
        } catch {
          sendJson(
            res,
            400,
            { ok: false, error: "invalid_json", message: "Body must be JSON." },
            origin,
          );
          return;
        }

        const runWorkflow = json.runWorkflow === true;
        const wait = json.wait === true;

        const input: CaptureInput = {
          url: String(json.url ?? ""),
          title: typeof json.title === "string" ? json.title : undefined,
          selectedText:
            typeof json.selectedText === "string" ? json.selectedText : undefined,
          instruction: String(json.instruction ?? ""),
          intendedOutcome:
            typeof json.intendedOutcome === "string"
              ? json.intendedOutcome
              : undefined,
          screenshots: Array.isArray(json.screenshots)
            ? (json.screenshots as CaptureInput["screenshots"])
            : undefined,
          source: {
            kind: "browser_extension",
            extensionId:
              typeof json.extensionId === "string" ? json.extensionId : undefined,
          },
        };

        const pkg = buildPortablePackage(input);
        const stored = await writeHandoffToHome(pkg, { home });
        options.onStored?.(stored);

        logLine(`stored package id=${stored.id} screenshots=${stored.screenshotPaths.length}`);

        if (!runWorkflow) {
          sendJson(
            res,
            201,
            {
              ok: true,
              id: stored.id,
              executionStatus: stored.executionStatus,
              agentLaunched: false,
              workflowStarted: false,
              message:
                "Package created and saved locally. No agent was launched.",
              receiptDir: stored.receiptDir,
              handoffPath: stored.handoffPath,
              summaryPath: stored.summaryPath,
              desktopHint: stored.desktopHint,
              openInDesktop: {
                available: true,
                how: stored.desktopHint,
              },
            },
            origin,
          );
          return;
        }

        const started = await startSupportedWorkflow({
          home,
          id: stored.id,
          url: pkg.page.url,
          instruction: pkg.instruction,
          note: pkg.page.selectedText
            ? `Selected text captured (${pkg.page.selectedText.length} chars).`
            : undefined,
          runner: options.workflowRunner,
        });

        if (!started.started) {
          sendJson(
            res,
            201,
            {
              ok: true,
              id: stored.id,
              executionStatus: "package_created",
              agentLaunched: false,
              workflowStarted: false,
              message:
                started.reason === "playwright_unavailable"
                  ? "Package created. No supported agent/workflow could run (Playwright unavailable) — nothing was invented."
                  : started.status.message,
              receiptDir: stored.receiptDir,
              handoffPath: stored.handoffPath,
              summaryPath: stored.summaryPath,
              desktopHint: stored.desktopHint,
              openInDesktop: {
                available: true,
                how: stored.desktopHint,
              },
            },
            origin,
          );
          return;
        }

        if (wait) {
          // Wait for inflight completion (tests / CLI-style callers)
          const deadline = Date.now() + 120_000;
          while (workflowInflightCount() > 0 && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 200));
          }
          const finalStatus = await getLiveHandoffStatus(home, stored.id);
          sendJson(
            res,
            201,
            {
              ok: true,
              id: stored.id,
              executionStatus: finalStatus?.executionStatus ?? "running",
              agentLaunched: finalStatus?.agentLaunched ?? false,
              workflowStarted: true,
              mode: finalStatus?.mode,
              workflowLabel: finalStatus?.workflowLabel,
              message: finalStatus?.message,
              resultSummary: finalStatus?.resultSummary,
              error: finalStatus?.error,
              receiptDir: stored.receiptDir,
              handoffPath: stored.handoffPath,
              summaryPath: stored.summaryPath,
              desktopHint:
                "Open TabHandoff desktop → My Activity and refresh to see this handoff.",
              openInDesktop: {
                available: true,
                how: "Open TabHandoff desktop → My Activity and refresh.",
              },
            },
            origin,
          );
          return;
        }

        sendJson(
          res,
          202,
          {
            ok: true,
            id: stored.id,
            executionStatus: started.status.executionStatus,
            agentLaunched: started.status.agentLaunched,
            workflowStarted: true,
            mode: started.status.mode,
            workflowLabel: started.status.workflowLabel,
            message: started.status.message,
            receiptDir: stored.receiptDir,
            handoffPath: stored.handoffPath,
            summaryPath: stored.summaryPath,
            statusUrl: `/v1/handoffs/${stored.id}`,
            desktopHint:
              "Open TabHandoff desktop → My Activity — it refreshes as results arrive.",
            openInDesktop: {
              available: true,
              how: "Open TabHandoff desktop → My Activity.",
            },
          },
          origin,
        );
        return;
      }

      sendJson(res, 404, { ok: false, error: "not_found" }, origin);
    } catch (err) {
      if (err instanceof PackageValidationError) {
        sendJson(
          res,
          400,
          { ok: false, error: err.code, message: err.message },
          origin,
        );
        return;
      }
      logLine(`error path=${url.pathname} kind=${(err as Error).name}`);
      sendJson(
        res,
        500,
        {
          ok: false,
          error: "internal",
          message: "Something went wrong saving the package.",
        },
        origin,
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => resolve());
  });

  logLine(`listening on http://${config.host}:${config.port} (loopback only)`);

  return {
    config,
    home,
    url: `http://${config.host}:${config.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
