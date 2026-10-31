import { contextBridge, ipcRenderer, webUtils } from "electron";

export type DesktopApi = {
  home: () => Promise<{
    home: string;
    defaultHome: string;
    envOverride: boolean;
    platform: string;
  }>;
  setHome: (home: string) => Promise<{ home: string }>;
  index: (filters?: Record<string, unknown>) => Promise<{
    home: string;
    records: unknown[];
    allCount: number;
    importedCount: number;
    partialCount: number;
    hostnames: string[];
    skipped: string[];
  }>;
  get: (id: string) => Promise<unknown>;
  receipt: (id: string) => Promise<string | null>;
  card: (id: string) => Promise<string | null>;
  exportReport: (id: string) => Promise<{
    reportDir: string;
    markdownPath: string;
    jsonPath: string;
  }>;
  reveal: (targetPath: string) => Promise<{ ok: boolean }>;
  openExternal: (url: string) => Promise<{ ok: boolean }>;
  readImage: (filePath: string) => Promise<string>;
  bridgeStatus: () => Promise<{
    running: boolean;
    adopted?: boolean;
    url?: string;
    host?: string;
    port?: number;
    token?: string;
    home?: string;
    error?: string | null;
    agentExecution?: boolean;
    pageExtraction?: boolean;
    aiCompletion?: boolean;
    aiProvider?: string | null;
    aiModel?: string | null;
    workflows?: Array<{ id: string; label: string; description: string }>;
    message?: string;
  }>;
  listAiTasks: (limit?: number) => Promise<{
    ok: boolean;
    tasks: Array<Record<string, unknown>>;
    home: string;
  }>;
  getAiTask: (id: string) => Promise<{
    ok: boolean;
    task: Record<string, unknown> | null;
  }>;
  listRuntimes: () => Promise<{
    ok: boolean;
    runtimes: Array<{
      id: string;
      ok: boolean;
      baseUrl: string;
      models: string[];
      message: string;
    }>;
  }>;
  getAiSettings: () => Promise<{
    ok: boolean;
    settings: {
      provider: string;
      model: string;
      baseUrl?: string;
    } | null;
  }>;
  saveAiSettings: (payload: {
    provider: string;
    model: string;
    baseUrl?: string;
  }) => Promise<{ ok: boolean; settings: Record<string, unknown> }>;
  testAiConnection: () => Promise<{
    ok: boolean;
    status: string;
    provider: string | null;
    model: string | null;
    result: string;
    message: string;
    error?: string;
  }>;
  startPairing: () => Promise<{
    ok: boolean;
    code?: string;
    expiresInSec?: number;
    message?: string;
    error?: string;
  }>;
  listPairingRequests: () => Promise<{
    ok: boolean;
    requests: Array<{ id: string; status: string; expiresInSec: number }>;
    error?: string;
  }>;
  approvePairing: (requestId: string) => Promise<{
    ok: boolean;
    error?: string;
  }>;
  ensureBridge: () => Promise<{
    running: boolean;
    adopted?: boolean;
    error?: string | null;
    url?: string;
  }>;
  pickFiles: () => Promise<{
    canceled: boolean;
    paths: string[];
    files?: Array<{ path: string; name: string; byteSize: number }>;
  }>;
  registerDroppedPaths: (paths: string[]) => Promise<{
    paths: string[];
    files: Array<{ path: string; name: string; byteSize: number }>;
  }>;
  /** Resolve File objects from a drop event to absolute paths (Electron). */
  pathForFile: (file: File) => string;
  createFromFiles: (payload: {
    paths: string[];
    instruction: string;
    intendedOutcome?: string;
  }) => Promise<{
    id: string;
    status: string;
    agentLaunched: boolean;
    receiptDir: string;
    handoffPath: string;
    files: Array<{
      filename: string;
      byteSize?: number;
      sha256?: string;
      contentStatus?: string;
    }>;
    hint: string;
  }>;
};

const api: DesktopApi = {
  home: () => ipcRenderer.invoke("evidence:home"),
  setHome: (home) => ipcRenderer.invoke("evidence:setHome", home),
  index: (filters) => ipcRenderer.invoke("evidence:index", filters),
  get: (id) => ipcRenderer.invoke("evidence:get", id),
  receipt: (id) => ipcRenderer.invoke("evidence:receipt", id),
  card: (id) => ipcRenderer.invoke("evidence:card", id),
  exportReport: (id) => ipcRenderer.invoke("evidence:export", id),
  reveal: (targetPath) => ipcRenderer.invoke("evidence:reveal", targetPath),
  openExternal: (url) => ipcRenderer.invoke("evidence:openExternal", url),
  readImage: (filePath) => ipcRenderer.invoke("evidence:readImage", filePath),
  bridgeStatus: () => ipcRenderer.invoke("bridge:status"),
  listAiTasks: (limit) => ipcRenderer.invoke("ai:listTasks", limit),
  getAiTask: (id) => ipcRenderer.invoke("ai:getTask", id),
  listRuntimes: () => ipcRenderer.invoke("ai:runtimes"),
  getAiSettings: () => ipcRenderer.invoke("ai:getSettings"),
  saveAiSettings: (payload) => ipcRenderer.invoke("ai:saveSettings", payload),
  testAiConnection: () => ipcRenderer.invoke("ai:testConnection"),
  startPairing: () => ipcRenderer.invoke("bridge:startPairing"),
  listPairingRequests: () => ipcRenderer.invoke("bridge:listPairingRequests"),
  approvePairing: (requestId) =>
    ipcRenderer.invoke("bridge:approvePairing", requestId),
  ensureBridge: () => ipcRenderer.invoke("bridge:ensure"),
  pickFiles: () => ipcRenderer.invoke("handoff:pickFiles"),
  registerDroppedPaths: (paths) =>
    ipcRenderer.invoke("handoff:registerDroppedPaths", paths),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      // Older Electron fallback — may be empty under sandbox.
      return (file as File & { path?: string }).path || "";
    }
  },
  createFromFiles: (payload) =>
    ipcRenderer.invoke("handoff:createFromFiles", payload),
};

contextBridge.exposeInMainWorld("tabhandoff", api);
