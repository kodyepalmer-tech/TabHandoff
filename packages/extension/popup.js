import { buildPortablePackage, renderSummaryMarkdown } from "./lib/package.js";
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
};

const $ = (id) => document.getElementById(id);

function show(step) {
  for (const id of [
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
  $("btn-review").disabled = !canHandOff;
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
    pill.textContent = "Bridge: on";
    pill.className = "pill ok";
  } else {
    pill.textContent = "Bridge: off";
    pill.className = "pill bad";
  }
  return { settings, probe };
}

async function loadCapabilities() {
  const settings = await loadBridgeSettings();
  const caps = await getBridgeStatus(settings);
  state.bridgeCaps = caps;
  return caps;
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
  const canExtract = Boolean(caps?.ok && caps.pageExtraction);
  const hasLlm = Boolean(caps?.ok && caps.agentExecution);

  if (canExtract) {
    $("rev-workflow").textContent = hasLlm
      ? "Package + model-assisted isolated browser (API key detected)"
      : "Package + page extraction in an isolated browser";
    $("run-workflow-row").classList.remove("hidden");
    $("run-workflow").checked = true;
    $("run-workflow").disabled = false;
    $("run-workflow-label").textContent = hasLlm
      ? "Also run model-assisted browser steps (isolated — no cookies copied)"
      : "Also run page extraction in an isolated browser (no cookies copied)";
    $("rev-workflow-note").textContent = hasLlm
      ? "Results are recorded honestly. Model steps only run when a key is present."
      : "Page extraction is deterministic DOM reading — not autonomous AI completion.";
    $("btn-confirm").textContent = "Hand off";
  } else if (caps?.ok) {
    $("rev-workflow").textContent =
      "Package only — page extraction is not available on this computer";
    $("run-workflow-row").classList.add("hidden");
    $("run-workflow").checked = false;
    $("rev-workflow-note").textContent =
      "The package will be saved. No agent run will be invented.";
    $("btn-confirm").textContent = "Create package";
  } else {
    $("rev-workflow").textContent =
      "Bridge offline — package download/copy only (no fake history)";
    $("run-workflow-row").classList.add("hidden");
    $("run-workflow").checked = false;
    $("rev-workflow-note").textContent =
      "Start the desktop app or `pnpm bridge`, then try again to save and extract.";
    $("btn-confirm").textContent = "Create package";
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
    setStatusPill("Package only", "ok");
    $("result-title").textContent = "Package created";
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

async function createPackage() {
  stopPoll();
  const instruction = $("instruction").value.trim();
  const pkg = buildPortablePackage({
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
  state.lastPackage = pkg;

  const settings = await loadBridgeSettings();
  const probe = await probeBridge(settings);
  const wantRun =
    Boolean($("run-workflow")?.checked) &&
    Boolean(state.bridgeCaps?.ok && state.bridgeCaps.pageExtraction);

  if (probe.ok && settings.token) {
    $("result-title").textContent = wantRun
      ? "Starting handoff…"
      : "Saving package…";
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
        // Refresh package summary from last known state for copy/download
        return;
      }

      setStatusPill("Package only", "ok");
      $("result-title").textContent = "Package created";
      $("result-body").textContent =
        (result.message || "Saved on this computer. No agent was launched.") +
        "\n\n" +
        (result.desktopHint ||
          "Open TabHandoff desktop → My Activity and refresh.");
      $("result-path").classList.remove("hidden");
      $("result-path").textContent = result.receiptDir || result.handoffPath || "";
      return;
    }

    setStatusPill("Not saved", "bad");
    $("result-title").textContent = "Package ready (not saved to bridge)";
    $("result-body").textContent =
      (result.message || "Bridge could not save the package.") +
      "\n\nYou can copy or download the package and pass it to another person or bot. No agent was launched.";
    $("result-path").classList.add("hidden");
    return;
  }

  state.lastBridgeResult = { ok: false, error: "bridge_offline" };
  setStatusPill("Package only", "ok");
  $("result-title").textContent = "Package created";
  $("result-body").textContent =
    "The local bridge is not running (or has no token yet), so the package was not saved into your evidence folder automatically.\n\n" +
    "Download or copy it, or start the bridge / desktop app and try again.\n\n" +
    "No agent was launched.";
  $("result-path").classList.add("hidden");
  show("step-result");
}

function downloadPackage() {
  if (!state.lastPackage) return;
  const blob = new Blob([JSON.stringify(state.lastPackage, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tabhandoff-${state.lastPackage.id}.json`;
  a.click();
  URL.revokeObjectURL(url);

  const summary = renderSummaryMarkdown(state.lastPackage);
  const blob2 = new Blob([summary], { type: "text/markdown" });
  const url2 = URL.createObjectURL(blob2);
  const a2 = document.createElement("a");
  a2.href = url2;
  a2.download = `tabhandoff-${state.lastPackage.id}-summary.md`;
  a2.click();
  URL.revokeObjectURL(url2);
}

async function copySummary() {
  if (!state.lastPackage) return;
  const text = renderSummaryMarkdown(state.lastPackage);
  await navigator.clipboard.writeText(text);
  $("btn-copy").textContent = "Copied";
  setTimeout(() => {
    $("btn-copy").textContent = "Copy summary";
  }, 1500);
}

async function openSettings() {
  const settings = await loadBridgeSettings();
  $("bridge-base").value = settings.base;
  $("bridge-token").value = settings.token;
  const probe = await probeBridge(settings);
  const caps = probe.ok ? await getBridgeStatus(settings) : null;
  $("bridge-status").textContent = probe.ok
    ? caps?.message || "Bridge is reachable on this computer."
    : "Bridge is not reachable. Run: pnpm bridge (or open the desktop app).";
  show("step-settings");
}

function wire() {
  $("instruction").addEventListener("input", () => {
    $("btn-review").disabled =
      !$("instruction").value.trim() ||
      !state.tab?.url?.startsWith("http");
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
    void createPackage().then(() => {
      if ($("step-result").classList.contains("hidden")) show("step-result");
    });
  });
  $("btn-download").addEventListener("click", downloadPackage);
  $("btn-copy").addEventListener("click", () => void copySummary());
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
