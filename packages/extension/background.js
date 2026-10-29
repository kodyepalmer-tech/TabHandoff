const MENU_ID = "tabhandoff-hand-off";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Hand off with TabHandoff",
      contexts: ["page", "selection", "link"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  const selectedText = info.selectionText || "";
  await chrome.storage.session.set({
    pendingCapture: {
      selectedText,
      fromContextMenu: true,
      tabId: tab.id,
      at: Date.now(),
    },
  });
  // Open the action popup by focusing the toolbar action — Chrome opens popup on user gesture;
  // from context menu we set pending state and open a small window as fallback.
  try {
    await chrome.action.openPopup();
  } catch {
    const url = chrome.runtime.getURL(
      `popup.html?context=1&tabId=${tab.id}`,
    );
    await chrome.windows.create({
      url,
      type: "popup",
      width: 420,
      height: 640,
      focused: true,
    });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
  return false;
});
