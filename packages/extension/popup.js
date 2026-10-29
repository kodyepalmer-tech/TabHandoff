import { buildPortablePackage, renderSummaryMarkdown } from "./lib/package.js";
import {
  loadBridgeSettings,
  saveBridgeSettings,
  probeBridge,
  postHandoff,
} from "./lib/bridge-client.js";

const state = {
  tab: null,
  selectedText: "",
  screenshotDataUrl: null,
  screenshotError: null,
  lastPackage: null,
  lastBridgeResult: null,
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

async function createPackage() {
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

  if (probe.ok && settings.token) {
    $("result-title").textContent = "Saving package…";
    $("result-body").textContent = "Talking to the local TabHandoff bridge…";
    show("step-result");

    const result = await postHandoff(settings, {
      url: pkg.page.url,
      title: pkg.page.title,
      selectedText: pkg.page.selectedText,
      instruction: pkg.instruction,
      screenshots: screenshotPayload(),
      extensionId: chrome.runtime.id,
    });
    state.lastBridgeResult = result;

    if (result.ok) {
      $("result-title").textContent = "Package created";
      $("result-body").textContent =
        "Saved on this computer. No agent was launched.\n\n" +
        (result.message || "") +
        "\n\n" +
        (result.desktopHint ||
          "Open TabHandoff desktop → My Activity and refresh.");
      $("result-path").classList.remove("hidden");
      $("result-path").textContent = result.receiptDir || result.handoffPath || "";
      return;
    }

    // Honest failure — still offer download
    $("result-title").textContent = "Package ready (not saved to bridge)";
    $("result-body").textContent =
      (result.message || "Bridge could not save the package.") +
      "\n\nYou can copy or download the package and pass it to another person or bot. No agent was launched.";
    $("result-path").classList.add("hidden");
    return;
  }

  // Bridge offline — package-only path
  state.lastBridgeResult = { ok: false, error: "bridge_offline" };
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
  $("bridge-status").textContent = probe.ok
    ? "Bridge is reachable on this computer."
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
    fillReview();
    show("step-review");
  });

  $("btn-back").addEventListener("click", () => show("step-capture"));
  $("btn-confirm").addEventListener("click", () => {
    void createPackage().then(() => {
      if ($("step-result").classList.contains("hidden")) show("step-result");
    });
  });
  $("btn-download").addEventListener("click", downloadPackage);
  $("btn-copy").addEventListener("click", () => void copySummary());
  $("btn-again").addEventListener("click", () => window.close());
  $("btn-settings").addEventListener("click", () => void openSettings());
  $("btn-settings-back").addEventListener("click", () => show("step-capture"));
  $("btn-save-settings").addEventListener("click", async () => {
    await saveBridgeSettings({
      base: $("bridge-base").value.trim(),
      token: $("bridge-token").value.trim(),
    });
    await refreshBridgePill();
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
  void refreshBridgePill();

  if (state.tab?.id && state.tab.url?.startsWith("http")) {
    await captureShot(state.tab);
    renderCapture();
  } else {
    renderCapture();
  }

  // Enable review only once instruction present
  $("btn-review").disabled =
    !$("instruction").value.trim() || !state.tab?.url?.startsWith("http");
}

void init();
