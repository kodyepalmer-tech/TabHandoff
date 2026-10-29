const DEFAULT_BASE = "http://127.0.0.1:17432";

export async function loadBridgeSettings() {
  const stored = await chrome.storage.local.get(["bridgeBase", "bridgeToken"]);
  return {
    base: (stored.bridgeBase || DEFAULT_BASE).replace(/\/$/, ""),
    token: stored.bridgeToken || "",
  };
}

export async function saveBridgeSettings({ base, token }) {
  await chrome.storage.local.set({
    bridgeBase: (base || DEFAULT_BASE).replace(/\/$/, ""),
    bridgeToken: token || "",
  });
}

export async function probeBridge(settings) {
  const base = settings?.base || DEFAULT_BASE;
  try {
    const res = await fetch(`${base}/health`, { method: "GET" });
    if (!res.ok) return { ok: false, reason: "unreachable" };
    const json = await res.json();
    return { ok: true, json, base };
  } catch {
    return { ok: false, reason: "unreachable", base };
  }
}

export async function postHandoff(settings, payload) {
  const base = settings.base || DEFAULT_BASE;
  const token = settings.token || "";
  if (!token) {
    return {
      ok: false,
      error: "missing_token",
      message:
        "Add your local bridge token in Settings (shown when you run the TabHandoff bridge).",
    };
  }

  let res;
  try {
    res = await fetch(`${base}/v1/handoffs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return {
      ok: false,
      error: "bridge_unreachable",
      message:
        "Could not reach the local TabHandoff bridge. Start it (or the desktop app), or download the package instead.",
    };
  }

  let body = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }

  if (!res.ok) {
    return {
      ok: false,
      error: body.error || `http_${res.status}`,
      message:
        body.message ||
        (res.status === 401
          ? "Bridge rejected the token. Paste the token from bridge output or bridge.json."
          : "Bridge could not save the package."),
      status: res.status,
    };
  }

  return { ok: true, ...body };
}
