import { contextBridge, ipcRenderer } from "electron";

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
    url?: string;
    host?: string;
    port?: number;
    token?: string;
    home?: string;
    error?: string | null;
    agentExecution?: boolean;
    message?: string;
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
};

contextBridge.exposeInMainWorld("tabhandoff", api);
