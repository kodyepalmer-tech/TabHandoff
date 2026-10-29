import {
  buildPortablePackage,
  buildPackageFiles,
  packageForDisk,
  renderSummaryMarkdown,
  renderAiBrief,
} from "./lib/package.js";
import { buildZip, base64ToBytes } from "./lib/zip.js";
import {
  loadBridgeSettings,
  saveBridgeSettings,
  probeBridge,
  getBridgeStatus,
  postHandoff,
  getHandoffStatus,
  postAiRun,
  listAiTasks,
  getAiTask,
  completePairing,
} from "./lib/bridge-client.js";

const HISTORY_KEY = "aiTaskHistory";
const HISTORY_LIMIT = 40;

const state = {
  tab: null,
  selectedText: "",
  pageText: "",
  screenshotDataUrl: null,
  screenshotError: null,
  lastPackage: null,
  lastBridgeResult: null,
  lastAiResult: null,
  bridgeCaps: null,
  pollTimer: null,
  zipDownloaded: false,
  preferAi: true,
};

const $ = (id) => document.getElementById(id);

function show(step) {
  for (const id of [
    "step-onboarding",
    "step-capture",
    "step-review",
    "step-result",
    "step-settings",
  ]) {
    $(id).classList.toggle("hidden", id !== step);
  }
}

function setStatusPill(text, kind) {
  const el = $("result-status");
  el.textContent = text;
  el.className = "pill status-pill" + (kind ? ` ${kind}` : "");
}

async function getActiveTab() {
  const params = new URLSearchParams(location.search);
  const tabIdParam = params.get("tabId");
  if (tabIdParam) {
    try {
      return await chrome.tabs.get(Number(tabIdParam));
    } catch {
      /* fall through */
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function readPendingSelection() {
  const { pendingCapture } = await chrome.storage.session.get("pendingCapture");
  if (pendingCapture?.selectedText) {
    await chrome.storage.session.remove("pendingCapture");
    return pendingCapture.selectedText;
  }
  return "";
}

async function readPageSelection(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.getSelection()?.toString() ?? "",
    });
    return result || "";
  } catch {
    return "";
  }
}

/** Visible text for AI context — truncated; never includes cookies/storage. */
async function readPageText(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const text = (document.body?.innerText || "").replace(/\s+\n/g, "\n").trim();
        return text.slice(0, 20_000);
      },
    });
    return result || "";
  } catch {
    return "";
  }
}

async function captureShot(tab) {
  try {
    const res = await chrome.runtime.sendMessage({
      type: "captureVisible",
      windowId: tab.windowId,
    });
    if (res?.ok && res.dataUrl) {
      state.screenshotDataUrl = res.dataUrl;
      state.screenshotError = null;
    } else {
      state.screenshotDataUrl = null;
      state.screenshotError = res?.message || "Screenshot not available.";
    }
  } catch (e) {
    state.screenshotDataUrl = null;
    state.screenshotError = e?.message || "Screenshot not available.";
  }
}

function updatePrimaryActions() {
  const canHandOff = Boolean(state.tab?.url?.startsWith("http"));
  const hasInstruction = Boolean($("instruction").value.trim());
  const enabled = canHandOff && hasInstruction;
  $("btn-review").disabled = !enabled;
  $("btn-run-ai").disabled = !enabled;

  const caps = state.bridgeCaps;
  const canAi = Boolean(caps?.ok && caps.aiCompletion);
  if (canAi) {
    $("btn-run-ai").textContent = "Run with AI";
    $("capture-hint").textContent =
      `AI ready via ${caps.aiProvider || "local bridge"}${caps.aiModel ? ` (${caps.aiModel})` : ""}. Keys stay on this computer — never in the extension.`;
  } else if (caps?.reachable && caps?.hasToken) {
    $("btn-run-ai").textContent = "Run with AI";
    $("capture-hint").textContent =
      "Bridge is connected but no AI provider is configured. Set OPENAI_API_KEY / GROQ_API_KEY, or run Ollama locally. TabHandoff will not invent a result.";
  } else if (caps?.reachable) {
    $("btn-run-ai").textContent = "Run with AI";
    $("capture-hint").textContent =
      "Bridge is reachable — paste the token in Settings to Run with AI.";
  } else {
    $("btn-run-ai").textContent = "Run with AI";
    $("capture-hint").textContent =
      "Start pnpm bridge or the desktop app, then paste the token in Settings. Without a provider, Run with AI fails honestly.";
  }
}

function renderCapture() {
  const title = state.tab?.title || "(untitled)";
  const url = state.tab?.url || "";
  $("page-title").textContent = title;
  $("page-url").textContent = url;
  $("page-url").title = url;

  if (state.selectedText) {
    $("selection-block").classList.remove("hidden");
    $("page-selection").textContent = state.selectedText;
  } else {
    $("selection-block").classList.add("hidden");
  }

  if (state.screenshotDataUrl) {
    $("page-shot").src = state.screenshotDataUrl;
    $("page-shot").classList.remove("hidden");
    $("shot-note").textContent = "Screenshot captured for context / optional ZIP.";
  } else {
    $("page-shot").classList.add("hidden");
    $("shot-note").textContent =
      state.screenshotError ||
      "No screenshot (some pages block capture). You can still run with page text.";
  }

  if (!url?.startsWith("http")) {
    $("shot-note").textContent =
      "Open a normal http(s) webpage to hand it off. Browser settings pages are not supported.";
  }
  updatePrimaryActions();
}

async function refreshBridgePill() {
  const settings = await loadBridgeSettings();
  const probe = await probeBridge(settings);
  const pill = $("bridge-pill");
  if (probe.ok) {
    pill.textContent = settings.token ? "Bridge: on" : "Bridge: needs token";
    pill.className = settings.token ? "pill ok" : "pill";
  } else {
    pill.textContent = "Bridge: off";
    pill.className = "pill";
  }
  return { settings, probe };
}

async function loadCapabilities() {
  const settings = await loadBridgeSettings();
  const probe = await probeBridge(settings);
  if (!probe.ok || !settings.token) {
    state.bridgeCaps = {
      ok: false,
      pageExtraction: false,
      agentExecution: false,
      aiCompletion: false,
      aiProvider: null,
      aiModel: null,
      reachable: probe.ok,
      hasToken: Boolean(settings.token),
    };
    updatePrimaryActions();
    return state.bridgeCaps;
  }
  const caps = await getBridgeStatus(settings);
  state.bridgeCaps = { ...caps, reachable: true, hasToken: true };
  updatePrimaryActions();
  return state.bridgeCaps;
}

async function loadLocalHistory() {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
}

async function saveLocalHistoryEntry(entry) {
  const prev = await loadLocalHistory();
  const next = [entry, ...prev.filter((e) => e.id !== entry.id)].slice(
    0,
    HISTORY_LIMIT,
  );
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
  return next;
}

function formatWhen(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

async function renderHistory() {
  const list = $("history-list");
  const empty = $("history-empty");
  list.innerHTML = "";

  let tasks = [];
  const settings = await loadBridgeSettings();
  const probe = await probeBridge(settings);
  if (probe.ok && settings.token) {
    const remote = await listAiTasks(settings, 30);
    if (remote.ok && remote.tasks.length) {
      tasks = remote.tasks.map((t) => ({
        id: t.id,
        at: t.at,
        instruction: t.instruction,
        title: t.title,
        url: t.url,
        status: t.status,
        provider: t.provider,
        model: t.model,
        result: t.result,
        message: t.message,
        ok: t.ok,
        source: "bridge",
      }));
    }
  }

  if (!tasks.length) {
    const local = await loadLocalHistory();
    tasks = local;
  }

  if (!tasks.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  for (const task of tasks.slice(0, 20)) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "history-item";
    const title =
      (task.instruction || "").slice(0, 72) ||
      task.title ||
      task.url ||
      task.id;
    btn.innerHTML = `<span class="hi-title"></span><span class="hi-meta"></span>`;
    btn.querySelector(".hi-title").textContent = title;
    btn.querySelector(".hi-meta").textContent = [
      task.status || "?",
      task.provider || "",
      formatWhen(task.at),
    ]
      .filter(Boolean)
      .join(" · ");
    btn.addEventListener("click", () => {
      void openHistoryTask(task);
    });
    li.appendChild(btn);
    list.appendChild(li);
  }
}

async function openHistoryTask(task) {
  let full = task;
  if (task.source === "bridge" || (!task.result && task.id)) {
    const settings = await loadBridgeSettings();
    const remote = await getAiTask(settings, task.id);
    if (remote.ok && remote.task) {
      full = { ...task, ...remote.task };
    }
  }

  state.lastAiResult = {
    ok: Boolean(full.ok),
    status: full.status || (full.ok ? "done" : "failed"),
    provider: full.provider,
    model: full.model,
    result: full.result || "",
    message: full.message || "Saved task",
    error: full.error,
    taskId: full.id,
    resultPath: full.resultPath || full.taskPath,
  };
  showAiResult(state.lastAiResult, {
    activitySaved: false,
    handoffId: full.handoffId || null,
    fromHistory: true,
  });
}

function fillReview() {
  $("rev-instruction").textContent = $("instruction").value.trim();
  $("rev-title").textContent = state.tab?.title || "(untitled)";
  $("rev-url").textContent = state.tab?.url || "";
  if (state.selectedText) {
    $("rev-sel-row").classList.remove("hidden");
    $("rev-selection").textContent = state.selectedText;
  } else {
    $("rev-sel-row").classList.add("hidden");
  }
  $("rev-shot").textContent = state.screenshotDataUrl
    ? "Yes — visible tab capture"
    : "No — not available on this page";

  const caps = state.bridgeCaps;
  const bridgeReady = Boolean(caps?.ok && caps.hasToken);
  const canExtract = Boolean(bridgeReady && caps.pageExtraction);
  const hasLlm = Boolean(bridgeReady && caps.agentExecution);
  const canAi = Boolean(bridgeReady && caps.aiCompletion);

  $("save-activity-row").classList.remove("hidden");
  if (bridgeReady) {
    $("save-activity").checked = true;
    $("save-activity").disabled = false;
    $("save-activity-label").textContent =
      "Also save to My Activity on this computer";
  } else if (caps?.reachable && !caps?.hasToken) {
    $("save-activity").checked = false;
    $("save-activity").disabled = true;
    $("save-activity-label").textContent =
      "Also save to My Activity (add bridge token in Settings)";
  } else {
    $("save-activity").checked = false;
    $("save-activity").disabled = true;
    $("save-activity-label").textContent =
      "Also save to My Activity (start desktop/bridge + token)";
  }

  if (canExtract) {
    $("run-workflow-row").classList.remove("hidden");
    $("run-workflow").checked = false;
    $("run-workflow").disabled = false;
    $("run-workflow-label").textContent = hasLlm
      ? "Also run model-assisted browser steps (isolated — no cookies copied)"
      : "Also run page extraction in an isolated browser (no cookies copied)";
  } else {
    $("run-workflow-row").classList.add("hidden");
    $("run-workflow").checked = false;
  }

  if (canAi) {
    $("run-ai-row").classList.remove("hidden");
    $("run-ai").checked = state.preferAi;
    $("run-ai").disabled = false;
    $("run-ai-label").textContent = `Run with AI via ${caps.aiProvider || "bridge"}${caps.aiModel ? ` (${caps.aiModel})` : ""} — key never leaves this computer`;
    $("rev-workflow").textContent =
      "Run with AI on captured context (ZIP optional)";
    $("btn-confirm").textContent = "Run with AI";
    $("rev-workflow-note").textContent =
      "Primary path calls the model through the local bridge. ZIP download is optional sharing — not required to see the result.";
  } else if (bridgeReady) {
    $("run-ai-row").classList.add("hidden");
    $("run-ai").checked = false;
    $("rev-workflow").textContent = canExtract
      ? "Package / optional page extraction — Run with AI unavailable (no provider)"
      : "Package only — Run with AI unavailable (no provider)";
    $("btn-confirm").textContent = "Save package";
    $("rev-workflow-note").textContent =
      "Configure OPENAI_API_KEY, GROQ_API_KEY, ANTHROPIC_API_KEY, or local Ollama on the bridge process. TabHandoff will not invent an AI result.";
  } else {
    $("run-ai-row").classList.add("hidden");
    $("run-ai").checked = false;
    $("rev-workflow").textContent =
      "Download portable ZIP — package created (no agent executed)";
    $("btn-confirm").textContent = "Save package";
    $("rev-workflow-note").textContent =
      "Connect the local bridge + token (and a provider) for Run with AI. ZIP still works offline.";
  }

  $("download-zip").checked = !canAi;
}

function screenshotPayload() {
  if (!state.screenshotDataUrl) return [];
  return [
    {
      mediaType: "image/png",
      dataBase64: state.screenshotDataUrl,
      filename: "capture-01.png",
    },
  ];
}

function stopPoll() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function applyLiveStatus(st) {
  const status = st.executionStatus || st.jobStatus || "…";
  if (status === "running" || status === "queued") {
    setStatusPill(st.workflowLabel || "Working…", "");
    $("result-title").textContent = "Hand off in progress";
  } else if (status === "succeeded") {
    setStatusPill(
      st.mode === "dom" ? "Page extraction done" : "Finished",
      "ok",
    );
    $("result-title").textContent =
      st.mode === "dom" ? "Page extraction finished" : "Handoff finished";
  } else if (status === "failed") {
    setStatusPill("Failed", "bad");
    $("result-title").textContent = "Workflow failed";
  } else if (status === "package_created") {
    setStatusPill("Package created", "ok");
    $("result-title").textContent = "Package created — not agent executed";
  } else {
    setStatusPill(String(status), "");
  }

  const bits = [st.message || ""];
  if (st.mode === "dom") {
    bits.push("Labeled as page extraction — not autonomous AI completion.");
  }
  if (st.resultSummary) {
    bits.push("", "Result preview:", st.resultSummary.slice(0, 400));
  }
  if (st.error) {
    bits.push("", "Error:", st.error);
  }
  bits.push(
    "",
    st.desktopHint ||
      "Open TabHandoff desktop → My Activity to see evidence and screenshots.",
  );
  $("result-body").textContent = bits.filter(Boolean).join("\n");
  if (st.receiptDir) {
    $("result-path").classList.remove("hidden");
    $("result-path").textContent = st.receiptDir;
  }
}

async function pollUntilDone(settings, id) {
  stopPoll();
  let tries = 0;
  return new Promise((resolve) => {
    const tick = async () => {
      tries += 1;
      const st = await getHandoffStatus(settings, id);
      if (st && st.ok !== false && st.executionStatus) {
        applyLiveStatus(st);
        if (
          st.executionStatus === "succeeded" ||
          st.executionStatus === "failed" ||
          st.executionStatus === "cancelled"
        ) {
          stopPoll();
          resolve(st);
          return;
        }
      }
      if (tries > 90) {
        stopPoll();
        setStatusPill("Still running…", "");
        $("result-body").textContent =
          "Still working on this computer. Open TabHandoff → My Activity and refresh — status updates there when finished.";
        resolve(st);
      }
    };
    void tick();
    state.pollTimer = setInterval(() => void tick(), 1000);
  });
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildZipBytes(pkg) {
  const entries = buildPackageFiles(pkg);
  const zipFiles = entries.map((f) => {
    if (f.dataBase64) {
      return { name: f.name, data: base64ToBytes(f.dataBase64) };
    }
    return { name: f.name, data: f.data };
  });
  return buildZip(zipFiles);
}

function downloadZip(pkg = state.lastPackage) {
  if (!pkg) return false;
  const bytes = buildZipBytes(pkg);
  const blob = new Blob([bytes], { type: "application/zip" });
  triggerBlobDownload(blob, `tabhandoff-${pkg.id}.zip`);
  state.zipDownloaded = true;
  return true;
}

function showPackageOnlyResult({ activitySaved, activityError }) {
  $("btn-copy-result").classList.add("hidden");
  setStatusPill("Package created", "ok");
  $("result-title").textContent = "Package created — not agent executed";
  const lines = [
    "A portable ZIP is ready (handoff.json + summary + screenshots when captured).",
    "No agent was launched.",
  ];
  if (activitySaved) {
    lines.push("", "Also saved to My Activity on this computer.");
  } else if (activityError) {
    lines.push("", `My Activity save skipped: ${activityError}`);
  } else {
    lines.push(
      "",
      "Bridge was not used. Connect desktop later if you want My Activity or Run with AI.",
    );
  }
  lines.push(
    "",
    "Next: Download ZIP, or Copy brief for another AI (ChatGPT / Claude / Cursor).",
  );
  $("result-body").textContent = lines.join("\n");
  $("result-path").classList.add("hidden");
  show("step-result");
}

function showAiResult(ai, { activitySaved, handoffId, fromHistory }) {
  state.lastAiResult = ai;
  $("btn-copy-result").classList.toggle("hidden", !ai.result);

  if (ai.status === "done" && ai.ok) {
    setStatusPill(fromHistory ? "Saved result" : "AI done", "ok");
    $("result-title").textContent = fromHistory
      ? "Saved AI task"
      : "Run with AI finished";
  } else if (ai.status === "unavailable") {
    setStatusPill("AI unavailable", "");
    $("result-title").textContent = "Run with AI unavailable";
  } else {
    setStatusPill("AI failed", "bad");
    $("result-title").textContent = "Run with AI failed";
  }

  const lines = [
    ai.message || "",
    ai.provider ? `Provider: ${ai.provider}${ai.model ? ` (${ai.model})` : ""}` : "",
    ai.taskId ? `Task id: ${ai.taskId}` : "",
    "",
  ];
  if (ai.result) {
    lines.push("Result:", ai.result.slice(0, 6000));
  }
  if (ai.error && ai.status !== "done") {
    lines.push("", `Error: ${ai.error}`);
  }
  if (!fromHistory) {
    lines.push(
      "",
      "Task is saved locally — close and reopen TabHandoff to find it under Saved tasks.",
    );
  }
  if (activitySaved) {
    lines.push("Also saved to My Activity on this computer.");
  }
  if (handoffId) {
    lines.push(`Handoff id: ${handoffId}`);
  }
  $("result-body").textContent = lines
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
  if (ai.resultPath || ai.taskPath) {
    $("result-path").classList.remove("hidden");
    $("result-path").textContent = ai.resultPath || ai.taskPath;
  } else {
    $("result-path").classList.add("hidden");
  }
  show("step-result");
}

async function persistAiHistory(ai, pkg) {
  if (!ai?.taskId && !ai?.result && ai?.status !== "unavailable") return;
  const entry = {
    id: ai.taskId || `local-${Date.now()}`,
    at: new Date().toISOString(),
    instruction: pkg?.instruction || $("instruction").value.trim(),
    title: pkg?.page?.title || state.tab?.title || "",
    url: pkg?.page?.url || state.tab?.url || "",
    status: ai.status,
    provider: ai.provider,
    model: ai.model,
    result: ai.result || "",
    message: ai.message || "",
    ok: Boolean(ai.ok),
    error: ai.error,
    source: "local",
  };
  await saveLocalHistoryEntry(entry);
  void renderHistory();
}

async function createPackage({ forceAi = false, forceZip = false } = {}) {
  stopPoll();
  state.zipDownloaded = false;
  state.lastAiResult = null;
  const instruction = $("instruction").value.trim();
  let pkg;
  try {
    pkg = buildPortablePackage({
      url: state.tab.url,
      title: state.tab.title || "",
      selectedText: state.selectedText,
      instruction,
      screenshots: screenshotPayload(),
      source: {
        kind: "browser_extension",
        extensionId: chrome.runtime.id,
      },
    });
  } catch (e) {
    setStatusPill("Error", "bad");
    $("result-title").textContent = "Could not create package";
    $("result-body").textContent = e?.message || String(e);
    $("result-path").classList.add("hidden");
    $("btn-copy-result").classList.add("hidden");
    show("step-result");
    return;
  }
  state.lastPackage = pkg;

  const settings = await loadBridgeSettings();
  const probe = await probeBridge(settings);
  const wantActivity = Boolean($("save-activity")?.checked);
  const wantRun =
    Boolean($("run-workflow")?.checked) &&
    Boolean(state.bridgeCaps?.ok && state.bridgeCaps.pageExtraction);
  const runAi = forceAi || Boolean($("run-ai")?.checked);
  const downloadNow =
    forceZip ||
    Boolean($("download-zip")?.checked) ||
    (!runAi && !wantActivity && !wantRun);

  if (downloadNow) {
    downloadZip(pkg);
  }

  const needBridge = wantActivity || wantRun || runAi;
  const canTalkToBridge = Boolean(probe.ok && settings.token && needBridge);

  if (!canTalkToBridge) {
    state.lastBridgeResult = { ok: false, error: "bridge_skipped" };
    if (runAi) {
      const ai = {
        ok: false,
        status: "unavailable",
        message: !probe.ok
          ? "Bridge offline — Run with AI did not run. Start pnpm bridge / desktop and paste the token."
          : "Missing bridge token — Run with AI did not run. Paste the token from bridge output in Settings.",
        error: !probe.ok ? "bridge_offline" : "missing_token",
        result: "",
      };
      await persistAiHistory(ai, pkg);
      showAiResult(ai, { activitySaved: false, handoffId: null });
      return;
    }
    if (!downloadNow) downloadZip(pkg);
    showPackageOnlyResult({
      activitySaved: false,
      activityError: wantActivity
        ? !probe.ok
          ? "bridge offline"
          : "missing token"
        : null,
    });
    return;
  }

  $("result-title").textContent = runAi
    ? "Running with AI…"
    : wantRun
      ? "Starting handoff…"
      : "Saving to My Activity…";
  setStatusPill(runAi ? "AI running" : wantRun ? "Queued" : "Saving", "");
  $("result-body").textContent = runAi
    ? "Calling the configured model through the local bridge…"
    : "Talking to the local TabHandoff bridge…";
  $("result-path").classList.add("hidden");
  $("btn-copy-result").classList.add("hidden");
  show("step-result");

  let handoffId = null;
  let activitySaved = false;

  if (wantActivity || wantRun) {
    const result = await postHandoff(settings, {
      url: pkg.page.url,
      title: pkg.page.title,
      selectedText: pkg.page.selectedText,
      instruction: pkg.instruction,
      screenshots: screenshotPayload(),
      extensionId: chrome.runtime.id,
      runWorkflow: wantRun,
    });
    state.lastBridgeResult = result;

    if (result.ok) {
      handoffId = result.id;
      activitySaved = true;
      if (result.workflowStarted && !runAi) {
        applyLiveStatus({
          ...result,
          executionStatus: result.executionStatus || "running",
          desktopHint: result.desktopHint,
        });
        await pollUntilDone(settings, result.id);
        return;
      }
      if (result.workflowStarted && runAi) {
        void pollUntilDone(settings, result.id);
      }
    } else if (!runAi) {
      if (!downloadNow) downloadZip(pkg);
      showPackageOnlyResult({
        activitySaved: false,
        activityError: result.message || "bridge could not save",
      });
      return;
    }
  }

  if (runAi) {
    if (!state.pageText && state.tab?.id) {
      state.pageText = await readPageText(state.tab.id);
    }
    const ai = await postAiRun(settings, {
      url: pkg.page.url,
      title: pkg.page.title,
      selectedText: pkg.page.selectedText,
      pageText: state.pageText || undefined,
      instruction: pkg.instruction,
      handoffId: handoffId || undefined,
    });
    // If AI not available on bridge despite UI (stale caps), surface honestly
    if (!ai.ok && ai.status === "unavailable" && !state.bridgeCaps?.aiCompletion) {
      ai.message =
        ai.message ||
        "No AI provider on the bridge. Configure a key or start Ollama.";
    }
    await persistAiHistory(ai, pkg);
    showAiResult(ai, { activitySaved, handoffId });
    return;
  }

  if (activitySaved) {
    setStatusPill("Package created", "ok");
    $("result-title").textContent = "Package created — not agent executed";
    $("result-body").textContent =
      (state.lastBridgeResult?.message ||
        "Saved on this computer. No agent was launched.") +
      (downloadNow ? "\n\nZIP also downloaded for sharing." : "") +
      "\n\n" +
      (state.lastBridgeResult?.desktopHint ||
        "Open TabHandoff desktop → My Activity and refresh.");
    $("result-path").classList.remove("hidden");
    $("result-path").textContent =
      state.lastBridgeResult?.receiptDir ||
      state.lastBridgeResult?.handoffPath ||
      "";
    return;
  }

  if (!downloadNow) downloadZip(pkg);
  showPackageOnlyResult({
    activitySaved: false,
    activityError: "bridge could not save",
  });
}

async function runAiPrimary() {
  state.preferAi = true;
  await loadCapabilities();
  // Pre-check run-ai checkbox state even if review not shown
  if ($("run-ai")) $("run-ai").checked = true;
  if ($("download-zip")) $("download-zip").checked = false;
  if ($("save-activity") && state.bridgeCaps?.ok) {
    $("save-activity").checked = true;
  }
  await createPackage({ forceAi: true });
}

async function copySummary() {
  if (!state.lastPackage) return;
  const text = renderSummaryMarkdown(packageForDisk(state.lastPackage));
  await navigator.clipboard.writeText(text);
  $("btn-copy").textContent = "Copied";
  setTimeout(() => {
    $("btn-copy").textContent = "Copy summary";
  }, 1500);
}

async function copyAiBrief() {
  if (!state.lastPackage) return;
  const text = renderAiBrief(packageForDisk(state.lastPackage));
  await navigator.clipboard.writeText(text);
  $("btn-copy-brief").textContent = "Copied — paste into any AI";
  setTimeout(() => {
    $("btn-copy-brief").textContent = "Copy brief for another AI";
  }, 2000);
}

async function copyResult() {
  const text = state.lastAiResult?.result;
  if (!text) return;
  await navigator.clipboard.writeText(text);
  $("btn-copy-result").textContent = "Copied";
  setTimeout(() => {
    $("btn-copy-result").textContent = "Copy result";
  }, 1500);
}

async function openSettings() {
  const settings = await loadBridgeSettings();
  $("bridge-base").value = settings.base;
  $("bridge-token").value = settings.token;
  const probe = await probeBridge(settings);
  const caps = probe.ok && settings.token ? await getBridgeStatus(settings) : null;
  $("bridge-status").textContent = probe.ok
    ? settings.token
      ? caps?.message || "Bridge is reachable on this computer."
      : "Bridge is reachable. Paste a token to enable Run with AI / My Activity."
    : "Bridge is not reachable. Start desktop or pnpm bridge.";
  show("step-settings");
}

async function finishOnboarding() {
  await chrome.storage.local.set({ onboardingDone: true });
  show("step-capture");
}

function wire() {
  $("instruction").addEventListener("input", () => {
    updatePrimaryActions();
  });

  $("btn-onboard-continue").addEventListener("click", () => {
    void finishOnboarding();
  });

  $("btn-run-ai").addEventListener("click", () => {
    if (!$("instruction").value.trim()) return;
    void runAiPrimary();
  });

  $("btn-review").addEventListener("click", () => {
    if (!$("instruction").value.trim()) return;
    void loadCapabilities().then(() => {
      fillReview();
      show("step-review");
    });
  });

  $("btn-back").addEventListener("click", () => {
    stopPoll();
    show("step-capture");
  });
  $("btn-confirm").addEventListener("click", () => {
    void createPackage({});
  });
  $("btn-download").addEventListener("click", () => downloadZip());
  $("btn-copy").addEventListener("click", () => void copySummary());
  $("btn-copy-brief").addEventListener("click", () => void copyAiBrief());
  $("btn-copy-result").addEventListener("click", () => void copyResult());
  $("btn-again").addEventListener("click", () => {
    stopPoll();
    show("step-capture");
    void renderHistory();
  });
  $("btn-refresh-history").addEventListener("click", () => {
    void renderHistory();
  });
  $("btn-settings").addEventListener("click", () => void openSettings());
  $("btn-settings-back").addEventListener("click", () => show("step-capture"));
  $("btn-save-settings").addEventListener("click", async () => {
    await saveBridgeSettings({
      base: $("bridge-base").value.trim(),
      token: $("bridge-token").value.trim(),
    });
    await refreshBridgePill();
    await loadCapabilities();
    await renderHistory();
    $("bridge-status").textContent = "Saved.";
  });
  $("btn-pair").addEventListener("click", async () => {
    $("bridge-status").textContent = "Pairing…";
    const result = await completePairing(
      $("bridge-base").value.trim(),
      $("pair-code").value.trim(),
    );
    if (result.ok) {
      $("pair-code").value = "";
      $("bridge-token").value = "";
      const settings = await loadBridgeSettings();
      $("bridge-base").value = settings.base;
      $("bridge-status").textContent =
        "Paired. Token saved on this device only — not shown again.";
      await refreshBridgePill();
      await loadCapabilities();
      await renderHistory();
    } else {
      $("bridge-status").textContent = result.message || "Pairing failed.";
    }
  });
}

async function init() {
  wire();
  const { onboardingDone } = await chrome.storage.local.get("onboardingDone");
  if (!onboardingDone) {
    show("step-onboarding");
  }

  state.tab = await getActiveTab();
  state.selectedText =
    (await readPendingSelection()) ||
    (state.tab?.id ? await readPageSelection(state.tab.id) : "");
  if (state.tab?.id && state.tab.url?.startsWith("http")) {
    state.pageText = await readPageText(state.tab.id);
  }

  renderCapture();
  void refreshBridgePill()
    .then(() => loadCapabilities())
    .then(() => renderHistory());

  if (state.tab?.id && state.tab.url?.startsWith("http")) {
    await captureShot(state.tab);
    renderCapture();
  } else {
    renderCapture();
  }
}

void init();
