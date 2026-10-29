import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import {
  exportActivityReport,
  filterActivities,
  getActivityById,
  indexReceipts,
  readCardYaml,
  readReceiptMarkdown,
  tabHandoffHome,
  uniqueHostnames,
  type ActivityFilters,
} from "@tabhandoff/evidence";
import {
  BRIDGE_MAX_FILE_SOURCES,
  createFilePortableHandoff,
  loadOrCreateBridgeConfig,
  PackageValidationError,
  startBridgeServer,
  type BridgeServer,
} from "@tabhandoff/bridge";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let cachedHome = tabHandoffHome();
const defaultHome = path.join(homedir(), ".tabhandoff");
let bridge: BridgeServer | null = null;
let bridgeStartError: string | null = null;

/** Paths explicitly chosen via picker or drop this session — fail closed otherwise. */
const allowedFilePaths = new Set<string>();

function allowPaths(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    const resolved = path.resolve(p);
    allowedFilePaths.add(resolved);
    out.push(resolved);
  }
  return out;
}

function assertAllowedPaths(paths: string[]): string[] {
  const resolved = paths.map((p) => path.resolve(p));
  for (const p of resolved) {
    if (!allowedFilePaths.has(p)) {
      throw new Error(
        "That file was not selected with Choose files or drag-and-drop. TabHandoff will not read arbitrary paths.",
      );
    }
  }
  return resolved;
}

function iconPath(): string {
  return path.join(__dirname, "resources", "icon.png");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "TabHandoff",
    backgroundColor: "#0b0b0c",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 18 },
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  void mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpc(): void {
  ipcMain.handle("evidence:home", () => ({
    home: cachedHome,
    defaultHome,
    envOverride: Boolean(process.env.TABHANDOFF_HOME?.trim()),
    platform: process.platform,
  }));

  ipcMain.handle("evidence:setHome", (_e, home: string) => {
    const next = (home ?? "").trim();
    if (!next || next === "__default__") {
      delete process.env.TABHANDOFF_HOME;
      cachedHome = defaultHome;
      return { home: cachedHome };
    }
    cachedHome = next;
    process.env.TABHANDOFF_HOME = next;
    return { home: cachedHome };
  });

  ipcMain.handle("evidence:index", async (_e, filters?: ActivityFilters) => {
    const result = await indexReceipts({ home: cachedHome });
    const records = filterActivities(result.records, filters ?? {});
    return {
      ...result,
      records,
      allCount: result.records.length,
      hostnames: uniqueHostnames(result.records),
    };
  });

  ipcMain.handle("evidence:get", async (_e, id: string) => {
    return getActivityById(id, { home: cachedHome });
  });

  ipcMain.handle("evidence:receipt", async (_e, id: string) => {
    return readReceiptMarkdown(id, { home: cachedHome });
  });

  ipcMain.handle("evidence:card", async (_e, id: string) => {
    return readCardYaml(id, { home: cachedHome });
  });

  ipcMain.handle("evidence:export", async (_e, id: string) => {
    return exportActivityReport(id, { home: cachedHome });
  });

  ipcMain.handle("evidence:reveal", async (_e, targetPath: string) => {
    const result = shell.showItemInFolder(targetPath);
    return { ok: true, result };
  });

  ipcMain.handle("evidence:openExternal", async (_e, url: string) => {
    if (!/^https?:/i.test(url)) throw new Error("Only http(s) URLs allowed");
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle("evidence:readImage", async (_e, filePath: string) => {
    const buf = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase().replace(".", "") || "png";
    const mime =
      ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "webp"
          ? "image/webp"
          : ext === "gif"
            ? "image/gif"
            : "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  });

  ipcMain.handle("bridge:status", async () => {
    if (!bridge) {
      return {
        running: false,
        error: bridgeStartError,
        home: cachedHome,
        agentExecution: false,
        pageExtraction: false,
      };
    }
    const { probeBridgeCapabilities } = await import("@tabhandoff/bridge");
    const caps = await probeBridgeCapabilities();
    return {
      running: true,
      url: bridge.url,
      host: bridge.config.host,
      port: bridge.config.port,
      token: bridge.config.token,
      home: bridge.home,
      agentExecution: caps.llmAgent,
      pageExtraction: caps.pageExtraction,
      workflows: caps.workflows,
      message: caps.message,
    };
  });

  ipcMain.handle("handoff:pickFiles", async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: "Hand off files",
      properties: ["openFile", "multiSelections"],
      buttonLabel: "Add to handoff",
    });
    if (result.canceled || !result.filePaths.length) {
      return { canceled: true, paths: [] as string[] };
    }
    if (result.filePaths.length > BRIDGE_MAX_FILE_SOURCES) {
      throw new Error(
        `Too many files (max ${BRIDGE_MAX_FILE_SOURCES}). Select fewer files.`,
      );
    }
    const paths = allowPaths(result.filePaths);
    return {
      canceled: false,
      paths,
      files: await Promise.all(
        paths.map(async (p) => {
          const st = await stat(p);
          return {
            path: p,
            name: path.basename(p),
            byteSize: st.size,
          };
        }),
      ),
    };
  });

  /** Register drop paths from the renderer (paths come from Electron drop event). */
  ipcMain.handle("handoff:registerDroppedPaths", async (_e, paths: string[]) => {
    const list = Array.isArray(paths) ? paths.slice(0, BRIDGE_MAX_FILE_SOURCES) : [];
    if (!list.length) return { paths: [] as string[], files: [] };
    const allowed = allowPaths(list);
    return {
      paths: allowed,
      files: await Promise.all(
        allowed.map(async (p) => {
          const st = await stat(p);
          if (!st.isFile()) {
            throw new Error(`Not a file: ${path.basename(p)}`);
          }
          return {
            path: p,
            name: path.basename(p),
            byteSize: st.size,
          };
        }),
      ),
    };
  });

  ipcMain.handle(
    "handoff:createFromFiles",
    async (
      _e,
      payload: { paths: string[]; instruction: string; intendedOutcome?: string },
    ) => {
      const instruction = (payload?.instruction ?? "").trim();
      if (!instruction) {
        throw new Error("Write a short instruction for the next person or bot.");
      }
      const paths = assertAllowedPaths(payload?.paths ?? []);
      if (!paths.length) {
        throw new Error("Select at least one file to hand off.");
      }
      if (paths.length > BRIDGE_MAX_FILE_SOURCES) {
        throw new Error(`Too many files (max ${BRIDGE_MAX_FILE_SOURCES}).`);
      }

      const files = [];
      for (const absolutePath of paths) {
        const st = await stat(absolutePath);
        if (!st.isFile()) {
          throw new Error(`Not a file: ${path.basename(absolutePath)}`);
        }
        const bytes = await readFile(absolutePath);
        files.push({
          absolutePath,
          bytes,
          displayPath: absolutePath,
        });
      }

      try {
        const stored = await createFilePortableHandoff(
          {
            files,
            instruction,
            intendedOutcome: payload.intendedOutcome?.trim() || undefined,
            source: { kind: "desktop" },
          },
          { home: cachedHome },
        );
        return {
          id: stored.id,
          status: stored.executionStatus,
          agentLaunched: stored.agentLaunched,
          receiptDir: stored.receiptDir,
          handoffPath: stored.handoffPath,
          files: (stored.package.sources ?? [])
            .filter((s) => s.type === "file")
            .map((s) =>
              s.type === "file"
                ? {
                    filename: s.filename,
                    byteSize: s.byteSize,
                    sha256: s.sha256,
                    contentStatus: s.contentStatus,
                  }
                : null,
            )
            .filter(Boolean),
          hint: "Package created only — no agent was launched. Office/PDF attachments are attached, not analyzed.",
        };
      } catch (err) {
        if (err instanceof PackageValidationError) {
          throw new Error(err.message);
        }
        throw err;
      }
    },
  );
}

async function ensureBridge(): Promise<void> {
  if (bridge) return;
  try {
    const config = await loadOrCreateBridgeConfig({ home: cachedHome });
    bridge = await startBridgeServer({ config, home: cachedHome });
    bridgeStartError = null;
  } catch (err) {
    bridgeStartError = err instanceof Error ? err.message : String(err);
    bridge = null;
  }
}

async function maybeDemoCapture(win: BrowserWindow): Promise<void> {
  const out = process.env.TABHANDOFF_DEMO_CAPTURE?.trim();
  if (!out) return;
  // Real Electron UI capture for Phase 5 demos — never fakes activity data.
  await new Promise((r) => setTimeout(r, 1800));
  try {
    await win.webContents.executeJavaScript(`
      (async () => {
        if (typeof refresh === 'function') await refresh();
        await new Promise((r) => setTimeout(r, 400));
      })()
    `);
  } catch {
    /* renderer may not expose refresh globally — UI still loads receipts via boot */
  }
  await new Promise((r) => setTimeout(r, 600));
  const image = await win.capturePage();
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, image.toPNG());
  console.log(`[tabhandoff-desktop] demo capture written: ${out}`);
  app.quit();
}

app.whenReady().then(async () => {
  registerIpc();
  // Skip bridge when capturing a static evidence-library frame (faster, quieter).
  if (!process.env.TABHANDOFF_DEMO_CAPTURE?.trim()) {
    await ensureBridge();
  }
  createWindow();
  if (mainWindow && process.env.TABHANDOFF_DEMO_CAPTURE?.trim()) {
    void mainWindow.webContents.once("did-finish-load", () => {
      void maybeDemoCapture(mainWindow!);
    });
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void bridge?.close();
  bridge = null;
});
