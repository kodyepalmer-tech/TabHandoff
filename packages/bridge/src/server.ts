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

export async function startBridgeServer(options: {
  config: BridgeConfig;
  home?: string;
  /** Inject for tests */
  onStored?: (stored: StoredHandoff) => void;
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
        const token = readBearer(req);
        if (!token || !safeEqualToken(token, config.token)) {
          sendJson(res, 401, { ok: false, error: "unauthorized" }, origin);
          return;
        }
        sendJson(
          res,
          200,
          {
            ok: true,
            home,
            ready: true,
            agentExecution: false,
            message:
              "Bridge is ready to store packages. Agent execution is not started from this endpoint (Phase 2).",
          },
          origin,
        );
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/handoffs") {
        if (!isExtensionOrLocalOrigin(origin)) {
          sendJson(res, 403, { ok: false, error: "origin_not_allowed" }, origin);
          return;
        }
        const token = readBearer(req);
        if (!token || !safeEqualToken(token, config.token)) {
          sendJson(res, 401, { ok: false, error: "unauthorized" }, origin);
          return;
        }

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

        sendJson(
          res,
          201,
          {
            ok: true,
            id: stored.id,
            executionStatus: stored.executionStatus,
            agentLaunched: false,
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
