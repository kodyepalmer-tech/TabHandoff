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
} from "./lib/bridge-client.js";

const state = {
  tab: null,
  selectedText: "",
  screenshotDataUrl: null,
  screenshotError: null,
  lastPackage: null,
  lastBridgeResult: null,
  bridgeCaps: null,
  pollTimer: null,
  zipDownloaded: false,
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
    $("shot-note").textContent = "Screenshot included when you confirm.";
  } else {
    $("page-shot").classList.add("hidden");
    $("shot-note").textContent =
      state.screenshotError ||
      "No screenshot (some pages block capture). You can still hand off the link and text.";
  }

  const canHandOff = Boolean(url?.startsWith("http"));
  $("btn-review").disabled = !canHandOff || !$("instruction").value.trim();
  if (!canHandOff) {
    $("shot-note").textContent =
      "Open a normal http(s) webpage to hand it off. Browser settings pages are not supported.";
  }
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
      reachable: probe.ok,
      hasToken: Boolean(settings.token),
    };
    return state.bridgeCaps;
  }
  const caps = await getBridgeStatus(settings);
  state.bridgeCaps = { ...caps, reachable: true, hasToken: true };
  return state.bridgeCaps;
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
      "Also save to My Activity (start desktop/bridge + token — optional)";
  }

  if (canExtract) {
    $("rev-workflow").textContent = hasLlm
      ? "Download ZIP + optional model-assisted isolated browser"
      : "Download ZIP + optional page extraction in an isolated browser";
    $("run-workflow-row").classList.remove("hidden");
    $("run-workflow").checked = false;
    $("run-workflow").disabled = false;
    $("run-workflow-label").textContent = hasLlm
      ? "Also run model-assisted browser steps (isolated — no cookies copied)"
      : "Also run page extraction in an isolated browser (no cookies copied)";
    $("rev-workflow-note").textContent = hasLlm
      ? "Default path downloads a package. Model steps only run when checked and a key is present."
      : "Default path downloads a package. Extraction is deterministic DOM reading — not autonomous AI.";
    $("btn-confirm").textContent = "Save package";
  } else {
    $("rev-workflow").textContent =
      "Download portable ZIP — package created (no agent executed)";
    $("run-workflow-row").classList.add("hidden");
    $("run-workflow").checked = false;
    $("rev-workflow-note").textContent =
      "Works without the desktop app. Optional My Activity save needs the local bridge.";
    $("btn-confirm").textContent = "Save package";
  }
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
      "Bridge was not used. Connect desktop later if you want My Activity.",
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

async function createPackage() {
  stopPoll();
  state.zipDownloaded = false;
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
    show("step-result");
    return;
  }
  state.lastPackage = pkg;

  // Always offer a local ZIP first — works with or without bridge.
  downloadZip(pkg);

  const settings = await loadBridgeSettings();
  const probe = await probeBridge(settings);
  const wantActivity = Boolean($("save-activity")?.checked);
  const wantRun =
    Boolean($("run-workflow")?.checked) &&
    Boolean(state.bridgeCaps?.ok && state.bridgeCaps.pageExtraction);

  const canTalkToBridge = Boolean(probe.ok && settings.token && wantActivity);

  if (!canTalkToBridge) {
    state.lastBridgeResult = { ok: false, error: "bridge_skipped" };
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

  $("result-title").textContent = wantRun
    ? "Starting handoff…"
    : "Saving to My Activity…";
  setStatusPill(wantRun ? "Queued" : "Saving", "");
  $("result-body").textContent = "Talking to the local TabHandoff bridge…";
  $("result-path").classList.add("hidden");
  show("step-result");

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
    if (result.workflowStarted) {
      applyLiveStatus({
        ...result,
        executionStatus: result.executionStatus || "running",
        desktopHint: result.desktopHint,
      });
      await pollUntilDone(settings, result.id);
      return;
    }

    setStatusPill("Package created", "ok");
    $("result-title").textContent = "Package created — not agent executed";
    $("result-body").textContent =
      (result.message || "Saved on this computer. No agent was launched.") +
      "\n\nZIP also downloaded for sharing." +
      "\n\n" +
      (result.desktopHint ||
        "Open TabHandoff desktop → My Activity and refresh.");
    $("result-path").classList.remove("hidden");
    $("result-path").textContent =
      result.receiptDir || result.handoffPath || "";
    return;
  }

  showPackageOnlyResult({
    activitySaved: false,
    activityError: result.message || "bridge could not save",
  });
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

async function openSettings() {
  const settings = await loadBridgeSettings();
  $("bridge-base").value = settings.base;
  $("bridge-token").value = settings.token;
  const probe = await probeBridge(settings);
  const caps = probe.ok && settings.token ? await getBridgeStatus(settings) : null;
  $("bridge-status").textContent = probe.ok
    ? settings.token
      ? caps?.message || "Bridge is reachable on this computer."
      : "Bridge is reachable. Paste a token only if you want My Activity / extraction."
    : "Bridge is not reachable. Package download still works without it.";
  show("step-settings");
}

async function finishOnboarding() {
  await chrome.storage.local.set({ onboardingDone: true });
  show("step-capture");
}

function wire() {
  $("instruction").addEventListener("input", () => {
    $("btn-review").disabled =
      !$("instruction").value.trim() ||
      !state.tab?.url?.startsWith("http");
  });

  $("btn-onboard-continue").addEventListener("click", () => {
    void finishOnboarding();
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
    void createPackage();
  });
  $("btn-download").addEventListener("click", () => downloadZip());
  $("btn-copy").addEventListener("click", () => void copySummary());
  $("btn-copy-brief").addEventListener("click", () => void copyAiBrief());
  $("btn-again").addEventListener("click", () => {
    stopPoll();
    window.close();
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
    $("bridge-status").textContent = "Saved.";
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

  renderCapture();
  void refreshBridgePill().then(() => loadCapabilities());

  if (state.tab?.id && state.tab.url?.startsWith("http")) {
    await captureShot(state.tab);
    renderCapture();
  } else {
    renderCapture();
  }

  $("btn-review").disabled =
    !$("instruction").value.trim() || !state.tab?.url?.startsWith("http");
}

void init();
