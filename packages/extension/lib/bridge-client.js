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

/** Authenticated capability probe — what workflows the bridge can run. */
export async function getBridgeStatus(settings) {
  const base = settings.base || DEFAULT_BASE;
  const token = settings.token || "";
  if (!token) {
    return {
      ok: false,
      error: "missing_token",
      pageExtraction: false,
      workflows: [],
      message: "Add your local bridge token in Settings.",
    };
  }
  try {
    const res = await fetch(`${base}/v1/status`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: body.error || `http_${res.status}`,
        pageExtraction: false,
        workflows: [],
        message: body.message || "Bridge status unavailable.",
      };
    }
    return {
      ok: true,
      pageExtraction: Boolean(body.pageExtraction),
      agentExecution: Boolean(body.agentExecution),
      workflows: Array.isArray(body.workflows) ? body.workflows : [],
      message: body.message || "",
      home: body.home,
    };
  } catch {
    return {
      ok: false,
      error: "bridge_unreachable",
      pageExtraction: false,
      workflows: [],
      message: "Could not reach the local TabHandoff bridge.",
    };
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

  return { ok: true, httpStatus: res.status, ...body };
}

export async function getHandoffStatus(settings, id) {
  const base = settings.base || DEFAULT_BASE;
  const token = settings.token || "";
  if (!token || !id) {
    return { ok: false, error: "missing_token_or_id" };
  }
  try {
    const res = await fetch(`${base}/v1/handoffs/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: body.error || `http_${res.status}`,
        message: body.message,
      };
    }
    return body;
  } catch {
    return {
      ok: false,
      error: "bridge_unreachable",
      message: "Lost connection to the local bridge while checking progress.",
    };
  }
}
