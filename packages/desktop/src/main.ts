import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
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
  loadOrCreateBridgeConfig,
  startBridgeServer,
  type BridgeServer,
} from "@tabhandoff/bridge";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let cachedHome = tabHandoffHome();
const defaultHome = path.join(homedir(), ".tabhandoff");
let bridge: BridgeServer | null = null;
let bridgeStartError: string | null = null;

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

  ipcMain.handle("bridge:status", () => {
    if (!bridge) {
      return {
        running: false,
        error: bridgeStartError,
        home: cachedHome,
        agentExecution: false,
      };
    }
    return {
      running: true,
      url: bridge.url,
      host: bridge.config.host,
      port: bridge.config.port,
      token: bridge.config.token,
      home: bridge.home,
      agentExecution: false,
      message:
        "Bridge is receiving browser packages only. No agent is launched from this step.",
    };
  });
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

app.whenReady().then(async () => {
  registerIpc();
  await ensureBridge();
  createWindow();
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
