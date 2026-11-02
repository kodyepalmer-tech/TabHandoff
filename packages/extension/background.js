const MENU_SELECTION = "tabhandoff-hand-off-selection";
const MENU_PAGE = "tabhandoff-hand-off-page";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_SELECTION,
      title: "Hand off selection to another AI",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: MENU_PAGE,
      title: "Hand this off to another AI",
      contexts: ["page", "editable"],
    });
  });
});

/**
 * Best-effort capture from the active tab.
 * Prefers the AI-site content script; falls back to injected capture script.
 */
async function captureFromTab(tab, info = {}) {
  if (!tab?.id) {
    return {
      ok: false,
      selectedText: info.selectionText || "",
      error: "no_tab",
    };
  }

  // Try content script first (known AI hosts).
  try {
    const fromContent = await chrome.tabs.sendMessage(tab.id, {
      type: "tabhandoff-capture-ai",
      selectedText: info.selectionText || "",
    });
    if (fromContent?.ok || fromContent?.selectedText || fromContent?.messageText) {
      return {
        ...fromContent,
        selectedText:
          fromContent.selectedText || info.selectionText || fromContent.messageText,
      };
    }
  } catch {
    /* content script not injected on this host */
  }

  // Inject capture helper (works on any http(s) page via activeTab).
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/capture-inject.js"],
    });
    if (result) {
      return {
        ...result,
        selectedText:
          result.selectedText || info.selectionText || result.messageText || "",
      };
    }
  } catch (e) {
    /* restricted page */
    return {
      ok: Boolean(info.selectionText),
      selectedText: info.selectionText || "",
      messageText: info.selectionText || "",
      captureMode: "selection",
      fragile: true,
      fragileNote:
        e?.message ||
        "Could not read the page DOM. Using the highlighted selection only.",
      url: tab.url,
      title: tab.title,
      siteId: "unknown",
    };
  }

  return {
    ok: Boolean(info.selectionText),
    selectedText: info.selectionText || "",
    messageText: info.selectionText || "",
    captureMode: "selection",
    fragile: true,
    fragileNote: "Using the highlighted selection only.",
    url: tab.url,
    title: tab.title,
    siteId: "unknown",
  };
}

async function openHandoffUi(tab, capture, source) {
  const selectedText =
    (capture?.selectedText || capture?.messageText || "").trim();
  await chrome.storage.session.set({
    pendingCapture: {
      selectedText,
      messageText: capture?.messageText || "",
      focusMessageText: capture?.focusMessageText || capture?.messageText || "",
      threadText: capture?.threadText || "",
      turns: Array.isArray(capture?.turns) ? capture.turns : [],
      turnCount: capture?.turnCount || (capture?.turns?.length ?? 0),
      captureMode: capture?.captureMode || "selection",
      siteId: capture?.siteId || "unknown",
      fragile: capture?.fragile !== false,
      fragileNote: capture?.fragileNote || "",
      pageText: capture?.pageText || "",
      fromContextMenu: source === "contextMenu",
      fromInPage: source === "inPage",
      inToolHandoff: true,
      tabId: tab?.id,
      url: capture?.url || tab?.url,
      title: capture?.title || tab?.title,
      at: Date.now(),
    },
  });

  try {
    await chrome.action.openPopup();
  } catch {
    const url = chrome.runtime.getURL(
      `popup.html?context=1&handoff=1&tabId=${tab?.id ?? ""}`,
    );
    await chrome.windows.create({
      url,
      type: "popup",
      width: 420,
      height: 680,
      focused: true,
    });
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (
    info.menuItemId !== MENU_SELECTION &&
    info.menuItemId !== MENU_PAGE
  ) {
    return;
  }
  if (!tab?.id) return;
  const capture = await captureFromTab(tab, info);
  await openHandoffUi(tab, capture, "contextMenu");
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "captureVisible") {
    const windowId = msg.windowId;
    chrome.tabs
      .captureVisibleTab(windowId, { format: "png" })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((err) =>
        sendResponse({
          ok: false,
          message: err?.message || "Screenshot not available on this page.",
        }),
      );
    return true;
  }

  if (msg?.type === "tabhandoff-inpage-handoff") {
    const tab = sender.tab;
    void openHandoffUi(tab, msg.capture || {}, "inPage").then(() =>
      sendResponse({ ok: true }),
    );
    return true;
  }

  if (msg?.type === "tabhandoff-request-capture") {
    const tabId = msg.tabId;
    void (async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        const capture = await captureFromTab(tab, {
          selectionText: msg.selectedText || "",
        });
        sendResponse({ ok: true, capture });
      } catch (e) {
        sendResponse({ ok: false, message: e?.message || String(e) });
      }
    })();
    return true;
  }

  return false;
});
