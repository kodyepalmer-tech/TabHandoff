/* global tabhandoff */

/** @typedef {import('../../src/preload').DesktopApi} DesktopApi */

const api = /** @type {DesktopApi} */ (window.tabhandoff);

const state = {
  view: "activity",
  records: [],
  hostnames: [],
  selectedId: null,
  selectedAiId: null,
  selected: null,
  home: "",
  imageCache: new Map(),
  handoffFiles: [],
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 3200);
}

function showView(name) {
  state.view = name;
  $$(".view").forEach((v) => v.classList.remove("is-visible"));
  const map = {
    activity: "#view-activity",
    ai: "#view-ai",
    handoff: "#view-handoff",
    detail: "#view-detail",
    evidence: "#view-evidence",
    settings: "#view-settings",
  };
  const target = $(map[name] || map.activity);
  target?.classList.add("is-visible");

  $$(".nav-item").forEach((btn) => {
    const view = btn.getAttribute("data-view");
    btn.classList.toggle(
      "is-active",
      view === name || (name === "detail" && view === "activity"),
    );
  });

  if (name === "ai") {
    void refreshAiTasks();
  }
}

function filtersFromUi() {
  return {
    query: $("#filter-query").value || undefined,
    status: $("#filter-status").value || "all",
    hostname: $("#filter-host").value || undefined,
    since: $("#filter-since").value || undefined,
    until: $("#filter-until").value || undefined,
  };
}

function formatWhen(iso) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatStatus(status) {
  if (status === "package_created") return "Package only";
  if (status === "succeeded") return "Succeeded";
  if (status === "failed") return "Failed";
  if (status === "running") return "Running";
  if (status === "queued") return "Queued";
  if (status === "cancelled") return "Cancelled";
  return status || "—";
}

async function imageUrl(filePath) {
  if (!filePath) return null;
  if (state.imageCache.has(filePath)) return state.imageCache.get(filePath);
  try {
    const data = await api.readImage(filePath);
    state.imageCache.set(filePath, data);
    return data;
  } catch {
    return null;
  }
}

async function refresh() {
  const result = await api.index(filtersFromUi());
  state.records = result.records;
  state.hostnames = result.hostnames;
  state.home = result.home;
  $("#home-pill").textContent = result.home;
  $("#settings-home").value = result.home;
  $("#activity-meta").textContent =
    result.allCount === 0
      ? "No handoffs found yet."
      : `Showing ${result.records.length} of ${result.allCount} · ${result.partialCount} partial`;

  const hostSelect = $("#filter-host");
  const current = hostSelect.value;
  hostSelect.innerHTML = `<option value="">All websites</option>`;
  for (const h of result.hostnames) {
    const opt = document.createElement("option");
    opt.value = h;
    opt.textContent = h;
    hostSelect.appendChild(opt);
  }
  hostSelect.value = result.hostnames.includes(current) ? current : "";

  await renderGrid();
  renderEvidenceStats(result);
}

async function renderGrid() {
  const grid = $("#activity-grid");
  const empty = $("#activity-empty");
  grid.innerHTML = "";

  if (!state.records.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  for (const r of state.records) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "activity-item";
    btn.addEventListener("click", () => openDetail(r.id));

    const thumbWrap = document.createElement("div");
    if (r.thumbnailPath) {
      const img = document.createElement("img");
      img.className = "thumb";
      img.alt = "";
      img.src = (await imageUrl(r.thumbnailPath)) || "";
      thumbWrap.appendChild(img);
    } else {
      const fb = document.createElement("div");
      fb.className = "thumb-fallback";
      fb.textContent = "No screenshot";
      thumbWrap.appendChild(fb);
    }

    const body = document.createElement("div");
    body.className = "item-body";
    const label = r.displayLabel || r.pageTitle || r.hostname;
    const hostLabel =
      r.primarySourceType === "file"
        ? "files"
        : r.hostname || "local";
    const footExtra =
      r.primarySourceType === "file"
        ? `${(r.fileSources || []).length} file${(r.fileSources || []).length === 1 ? "" : "s"}`
        : `${r.screenshotCount} screenshot${r.screenshotCount === 1 ? "" : "s"}`;
    if (r.primarySourceType === "file" && !r.thumbnailPath) {
      const fb = thumbWrap.querySelector(".thumb-fallback");
      if (fb) fb.textContent = "Files";
    }
    body.innerHTML = `
      <div class="item-top">
        <span class="host">${escapeHtml(hostLabel)}</span>
        <span class="status ${escapeHtml(r.status)}">${escapeHtml(formatStatus(r.status))}</span>
      </div>
      <div class="item-title">${escapeHtml(label)}</div>
      <div class="item-instruction">${escapeHtml(r.instruction)}</div>
      <div class="item-foot">
        <span>${escapeHtml(formatWhen(r.createdAt))}</span>
        <span>${escapeHtml(footExtra)}</span>
      </div>
    `;

    btn.appendChild(thumbWrap);
    btn.appendChild(body);
    grid.appendChild(btn);
  }
}

function renderEvidenceStats(result) {
  const shots = result.records.reduce((n, r) => n + (r.screenshotCount || 0), 0);
  $("#evidence-stats").innerHTML = `
    <li><strong>${result.allCount}</strong> handoffs indexed</li>
    <li><strong>${shots}</strong> screenshots on disk</li>
    <li><strong>${result.partialCount}</strong> partial records (still shown)</li>
    <li>Home: <code>${escapeHtml(result.home)}</code></li>
  `;
}

async function openDetail(id) {
  const record = await api.get(id);
  if (!record) {
    toast("Could not open that activity.");
    return;
  }
  state.selectedId = id;
  state.selected = record;
  showView("detail");

  const title =
    record.displayLabel || record.pageTitle || record.hostname || "Activity";
  $("#detail-title").textContent = title;
  const subBits = [
    formatStatus(record.status),
    formatWhen(record.createdAt),
    record.url ||
      (record.fileSources || []).map((f) => f.filename).join(", ") ||
      record.displayLabel,
  ];
  $("#detail-sub").textContent = subBits.join(" · ");

  const fileRows = (record.fileSources || [])
    .map((f) => {
      const status =
        f.contentStatus === "attached_not_analyzed"
          ? "attached, not analyzed"
          : f.contentStatus === "excerpted"
            ? "text excerpt (untrusted)"
            : "attached";
      return `<div class="file-meta"><code>${escapeHtml(f.filename)}</code> · ${escapeHtml(String(f.byteSize ?? "?"))} bytes · ${escapeHtml(status)}${f.sha256 ? ` · sha256:${escapeHtml(f.sha256.slice(0, 12))}…` : ""}</div>`;
    })
    .join("");

  const sourceRows = record.url
    ? `
    <dt>Website</dt><dd>${escapeHtml(record.hostname)}</dd>
    <dt>URL</dt><dd><a href="#" data-url="${escapeAttr(record.url)}">${escapeHtml(record.url)}</a></dd>`
    : `
    <dt>Source</dt><dd>Local files</dd>
    <dt>Files</dt><dd>${fileRows || "—"}</dd>`;

  $("#detail-kv").innerHTML = `
    ${sourceRows}
    <dt>Instruction</dt><dd>${escapeHtml(record.instruction)}</dd>
    <dt>Note</dt><dd>${escapeHtml(record.note || "—")}</dd>
    <dt>Mode</dt><dd>${escapeHtml(record.mode || "—")}</dd>
    <dt>ID</dt><dd><code>${escapeHtml(record.id)}</code></dd>
  `;
  $("#detail-kv").querySelector("a[data-url]")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (record.url) void api.openExternal(record.url);
  });

  $("#detail-untrusted").textContent = record.untrustedContent?.warning || "";

  const tl = $("#detail-timeline");
  tl.innerHTML = "";
  for (const e of record.timeline || []) {
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <div class="kind ${escapeAttr(e.kind)}">${escapeHtml(labelKind(e.kind))}</div>
        <div>${escapeHtml(formatWhen(e.at))}</div>
      </div>
      <div>
        ${e.ok === false ? "✗ " : e.ok ? "✓ " : ""}${e.tool ? `<code>${escapeHtml(e.tool)}</code> — ` : ""}${escapeHtml(e.detail)}
      </div>
    `;
    tl.appendChild(li);
  }

  const receipt = (await api.receipt(id)) || "Receipt markdown not found.";
  const card = (await api.card(id)) || "Task Card not found.";
  $("#detail-receipt").textContent = receipt;
  $("#detail-card").textContent = card;
  $("#detail-json").textContent = JSON.stringify(record, null, 2);
  $("#export-note").textContent = "";

  const thumbs = $("#shot-thumbs");
  thumbs.innerHTML = "";
  const main = $("#detail-shot");
  const paths = record.screenshotPaths || [];
  if (!paths.length) {
    main.removeAttribute("src");
    main.alt = "No screenshot";
  }
  for (let i = 0; i < paths.length; i += 1) {
    const p = paths[i];
    const data = await imageUrl(p);
    if (!data) continue;
    if (i === 0) {
      main.src = data;
      main.alt = `Screenshot ${i + 1}`;
    }
    const b = document.createElement("button");
    b.type = "button";
    const im = document.createElement("img");
    im.src = data;
    im.alt = `Screenshot ${i + 1}`;
    b.appendChild(im);
    b.addEventListener("click", () => {
      main.src = data;
      main.alt = `Screenshot ${i + 1}`;
    });
    thumbs.appendChild(b);
  }
}

function labelKind(kind) {
  if (kind === "verified_event") return "Verified";
  if (kind === "agent_reported") return "Reported";
  if (kind === "suggestion") return "Suggestion";
  return kind;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function wire() {
  $$(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.getAttribute("data-view");
      showView(view);
      if (view === "activity") void refresh();
    });
  });

  $("#btn-refresh").addEventListener("click", () => void refresh().then(() => toast("Activity refreshed")));
  $("#btn-back").addEventListener("click", () => showView("activity"));

  ["filter-query", "filter-status", "filter-host", "filter-since", "filter-until"].forEach((id) => {
    $(`#${id}`).addEventListener("change", () => void refresh());
    if (id === "filter-query") {
      $(`#${id}`).addEventListener("input", debounce(() => void refresh(), 220));
    }
  });

  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      const which = tab.getAttribute("data-tab");
      $("#detail-receipt").classList.toggle("hidden", which !== "receipt");
      $("#detail-card").classList.toggle("hidden", which !== "card");
      $("#detail-json").classList.toggle("hidden", which !== "json");
    });
  });

  $("#btn-reveal").addEventListener("click", async () => {
    const rec = state.selected;
    if (!rec?.receiptDir) return toast("No folder for this activity.");
    await api.reveal(rec.receiptPath || rec.receiptDir);
    toast("Revealed in file manager");
  });

  $("#btn-export").addEventListener("click", async () => {
    if (!state.selectedId) return;
    try {
      const out = await api.exportReport(state.selectedId);
      $("#export-note").textContent = `Report saved to ${out.reportDir} (original evidence untouched).`;
      toast("Report saved");
      await api.reveal(out.markdownPath);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  });

  $("#btn-open-home").addEventListener("click", async () => {
    const { home } = await api.home();
    await api.reveal(home);
  });

  $("#btn-save-home").addEventListener("click", async () => {
    const home = $("#settings-home").value.trim();
    await api.setHome(home);
    toast("Evidence folder updated");
    await refresh();
  });

  $("#btn-reset-home").addEventListener("click", async () => {
    const info = await api.setHome("__default__");
    $("#settings-home").value = info.home;
    toast("Using default evidence folder");
    await refresh();
  });

  $("#btn-refresh-bridge").addEventListener("click", () => {
    void refreshBridgeStatus();
  });

  $("#btn-copy-token").addEventListener("click", async () => {
    const token = $("#settings-bridge-token").value;
    if (!token) return toast("No token yet — is the bridge running?");
    try {
      await navigator.clipboard.writeText(token);
      toast("Token copied — paste into the browser extension Settings");
    } catch {
      toast("Could not copy — select the token field manually");
    }
  });

  wireHandoff();
  wireAiTasks();
  wireAiSettings();
}

function wireAiSettings() {
  $("#btn-refresh-runtimes")?.addEventListener("click", () => {
    void refreshAiSettingsUi().then(() => toast("Runtimes refreshed"));
  });
  $("#btn-save-ai")?.addEventListener("click", async () => {
    try {
      await api.saveAiSettings({
        provider: $("#ai-provider-select")?.value || "auto",
        model: ($("#ai-model-input")?.value || "").trim(),
      });
      toast("AI settings saved (no keys stored)");
      await refreshBridgeStatus();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  });
  $("#btn-test-ai")?.addEventListener("click", async () => {
    $("#ai-test-line").textContent = "Testing…";
    try {
      const r = await api.testAiConnection();
      $("#ai-test-line").textContent = r.ok
        ? `OK · ${r.provider}/${r.model} · ${(r.result || "").slice(0, 80)}`
        : `Failed · ${r.status}: ${r.message || r.error || "unknown"}`;
      toast(r.ok ? "Connection OK" : "Connection failed (honest)");
    } catch (err) {
      $("#ai-test-line").textContent =
        err instanceof Error ? err.message : String(err);
    }
  });
  $("#btn-pair-code")?.addEventListener("click", async () => {
    try {
      const r = await api.startPairing();
      if (r.ok && r.code) {
        $("#pair-code-line").textContent = `Pairing code: ${r.code} (expires in ${r.expiresInSec}s). Enter it in the extension Settings.`;
        toast("Pairing code ready");
      } else {
        $("#pair-code-line").textContent = r.message || r.error || "Could not start pairing";
        toast("Pairing failed");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  });
  $("#btn-ensure-bridge")?.addEventListener("click", async () => {
    const r = await api.ensureBridge();
    toast(
      r.running
        ? r.adopted
          ? "Adopted existing bridge"
          : "Bridge running"
        : r.error || "Bridge failed",
    );
    await refreshBridgeStatus();
  });
}

function renderHandoffFiles() {
  const list = $("#handoff-file-list");
  if (!list) return;
  if (!state.handoffFiles.length) {
    list.innerHTML = `<li class="fine">No files selected yet.</li>`;
    return;
  }
  list.innerHTML = state.handoffFiles
    .map(
      (f) =>
        `<li><code>${escapeHtml(f.name)}</code> · ${escapeHtml(String(f.byteSize))} bytes</li>`,
    )
    .join("");
}

function wireHandoff() {
  const drop = $("#handoff-drop");
  if (!drop || typeof api.pickFiles !== "function") return;

  renderHandoffFiles();

  $("#btn-pick-files")?.addEventListener("click", async () => {
    try {
      const result = await api.pickFiles();
      if (result.canceled) return;
      state.handoffFiles = result.files || [];
      renderHandoffFiles();
      toast(`${state.handoffFiles.length} file(s) ready`);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  });

  $("#btn-clear-files")?.addEventListener("click", () => {
    state.handoffFiles = [];
    renderHandoffFiles();
  });

  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("is-dragover");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-dragover"));
  drop.addEventListener("drop", async (e) => {
    e.preventDefault();
    drop.classList.remove("is-dragover");
    const files = [...(e.dataTransfer?.files || [])];
    const paths = files
      .map((f) => api.pathForFile(f))
      .filter((p) => typeof p === "string" && p.length > 0);
    if (!paths.length) {
      toast("Could not resolve dropped file paths.");
      return;
    }
    try {
      const registered = await api.registerDroppedPaths(paths);
      state.handoffFiles = registered.files || [];
      renderHandoffFiles();
      toast(`${state.handoffFiles.length} file(s) ready`);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  });

  $("#btn-create-file-handoff")?.addEventListener("click", async () => {
    const instruction = ($("#handoff-instruction")?.value || "").trim();
    const intendedOutcome = ($("#handoff-outcome")?.value || "").trim();
    if (!state.handoffFiles.length) {
      toast("Choose or drop at least one file first.");
      return;
    }
    if (!instruction) {
      toast("Write a short instruction.");
      return;
    }
    $("#handoff-status-line").textContent = "Creating package…";
    try {
      const result = await api.createFromFiles({
        paths: state.handoffFiles.map((f) => f.path),
        instruction,
        intendedOutcome: intendedOutcome || undefined,
      });
      $("#handoff-status-line").textContent = result.hint;
      toast(`Package created · ${result.id.slice(0, 8)}…`);
      state.handoffFiles = [];
      renderHandoffFiles();
      $("#handoff-instruction").value = "";
      $("#handoff-outcome").value = "";
      await refresh();
      await openDetail(result.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      $("#handoff-status-line").textContent = msg;
      toast(msg);
    }
  });
}

async function refreshBridgeStatus() {
  if (typeof api.bridgeStatus !== "function") {
    $("#bridge-status-line").textContent =
      "Bridge status unavailable in this build.";
    const line = $("#ai-provider-line");
    if (line) line.textContent = "AI provider status unavailable in this build.";
    return;
  }
  const st = await api.bridgeStatus();
  if (st.running) {
    const bits = [
      st.adopted
        ? `Using existing bridge at ${st.url} (adopted — no port fight).`
        : `Listening at ${st.url} (this computer only).`,
    ];
    if (st.aiCompletion) {
      bits.push(
        `Run with AI ready (${st.aiProvider || "provider"} / ${st.aiModel || "model"}).`,
      );
    } else if (st.pageExtraction) {
      bits.push(
        st.agentExecution
          ? "Can run page extraction or model-assisted browser steps."
          : "Can run page extraction (DOM — not autonomous AI). Run with AI needs a provider.",
      );
    } else {
      bits.push("Packages only — no Playwright and no AI provider.");
    }
    $("#bridge-status-line").textContent = bits.join(" ");
    $("#settings-bridge-token").value = st.token || "";
  } else {
    $("#bridge-status-line").textContent = st.error
      ? `Bridge not running: ${st.error}`
      : "Bridge not running. Use Restart / adopt bridge, or run: pnpm bridge";
    $("#settings-bridge-token").value = "";
  }

  const providerLine = $("#ai-provider-line");
  if (providerLine) {
    if (st.aiCompletion) {
      providerLine.textContent = `Ready: ${st.aiProvider || "provider"} · model ${st.aiModel || "(default)"}. Keys are never displayed.`;
    } else if (st.running) {
      providerLine.textContent =
        "No provider detected. Install Ollama or LM Studio, or set a cloud key in the desktop process env.";
    } else {
      providerLine.textContent = "Bridge offline — start desktop to probe providers.";
    }
  }
  await refreshAiSettingsUi();
}

async function refreshAiSettingsUi() {
  if (typeof api.listRuntimes !== "function") return;
  const [{ runtimes }, settingsWrap] = await Promise.all([
    api.listRuntimes(),
    api.getAiSettings(),
  ]);
  const line = $("#ai-runtimes-line");
  if (line) {
    line.textContent = (runtimes || [])
      .map((r) => `${r.id}: ${r.ok ? r.message : "offline"}`)
      .join(" · ");
  }
  const list = $("#ai-model-list");
  if (list) {
    list.innerHTML = "";
    for (const r of runtimes || []) {
      for (const m of r.models || []) {
        const opt = document.createElement("option");
        opt.value = m;
        list.appendChild(opt);
      }
    }
  }
  const settings = settingsWrap?.settings;
  if (settings) {
    if ($("#ai-provider-select")) $("#ai-provider-select").value = settings.provider || "auto";
    if ($("#ai-model-input")) $("#ai-model-input").value = settings.model || "";
  } else if (runtimes?.find((r) => r.ok && r.models?.[0])) {
    const first = runtimes.find((r) => r.ok && r.models?.[0]);
    if ($("#ai-model-input") && !$("#ai-model-input").value) {
      $("#ai-model-input").value = first.models[0];
    }
    if ($("#ai-provider-select")) $("#ai-provider-select").value = first.id;
  }
}

function wireAiTasks() {
  $("#btn-refresh-ai")?.addEventListener("click", () => void refreshAiTasks());
  $("#btn-reveal-ai")?.addEventListener("click", async () => {
    const id = state.selectedAiId;
    if (!id || !state.home) return;
    await api.reveal(`${state.home}/ai-tasks/${id}`);
  });
}

async function refreshAiTasks() {
  const list = $("#ai-list");
  const empty = $("#ai-empty");
  const meta = $("#ai-meta");
  const detail = $("#ai-detail");
  if (!list || typeof api.listAiTasks !== "function") return;

  const { tasks } = await api.listAiTasks(50);
  meta.textContent = `${tasks.length} saved AI task(s)`;
  if (!tasks.length) {
    list.innerHTML = "";
    empty?.classList.remove("hidden");
    detail?.classList.add("hidden");
    return;
  }
  empty?.classList.add("hidden");
  list.innerHTML = tasks
    .map((t) => {
      const title = escapeHtml(
        String(t.instruction || t.title || t.url || t.id || "").slice(0, 120),
      );
      const when = formatWhen(String(t.at || ""));
      const status = escapeHtml(String(t.status || "?"));
      const provider = escapeHtml(
        [t.provider, t.model].filter(Boolean).join(" / ") || "—",
      );
      return `<button type="button" class="activity-card" data-ai-id="${escapeHtml(String(t.id))}">
        <div class="activity-title">${title}</div>
        <div class="activity-meta">${status} · ${provider} · ${escapeHtml(when)}</div>
      </button>`;
    })
    .join("");

  list.querySelectorAll("[data-ai-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void openAiTask(btn.getAttribute("data-ai-id"));
    });
  });
}

async function openAiTask(id) {
  if (!id || typeof api.getAiTask !== "function") return;
  const { ok, task } = await api.getAiTask(id);
  const detail = $("#ai-detail");
  if (!ok || !task || !detail) {
    toast("Could not open AI task");
    return;
  }
  state.selectedAiId = id;
  detail.classList.remove("hidden");
  $("#ai-detail-title").textContent = String(task.instruction || "AI result").slice(
    0,
    160,
  );
  $("#ai-detail-meta").textContent = [
    task.status,
    task.provider,
    task.model,
    task.url,
    formatWhen(String(task.at || "")),
  ]
    .filter(Boolean)
    .join(" · ");
  $("#ai-detail-body").textContent =
    String(task.result || task.message || "(no result)") +
    (task.error ? `\n\nError: ${task.error}` : "");
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function boot() {
  wire();
  const info = await api.home();
  state.home = info.home;
  $("#settings-home").value = info.home;
  $("#home-pill").textContent = info.home;
  showView("activity");
  await refresh();
  await refreshBridgeStatus();
  // Auto-refresh My Activity so bridge workflow results appear without a manual click
  setInterval(() => {
    if (state.view === "activity" || state.view === "evidence") {
      void refresh();
    }
    if (state.view === "ai") {
      void refreshAiTasks();
    }
  }, 4000);
}

boot().catch((err) => {
  console.error(err);
  toast("Failed to load activity library");
});

// Used by TABHANDOFF_DEMO_CAPTURE in main process (Phase 5 real UI frames).
window.__tabhandoffReady = boot;
window.refresh = refresh;
