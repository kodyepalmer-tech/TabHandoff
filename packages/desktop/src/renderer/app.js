/* global tabhandoff */

/** @typedef {import('../../src/preload').DesktopApi} DesktopApi */

const api = /** @type {DesktopApi} */ (window.tabhandoff);

const state = {
  view: "activity",
  records: [],
  hostnames: [],
  selectedId: null,
  selected: null,
  home: "",
  imageCache: new Map(),
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
    detail: "#view-detail",
    evidence: "#view-evidence",
    settings: "#view-settings",
  };
  const target = $(map[name] || map.activity);
  target?.classList.add("is-visible");

  $$(".nav-item").forEach((btn) => {
    const view = btn.getAttribute("data-view");
    btn.classList.toggle("is-active", view === name || (name === "detail" && view === "activity"));
  });
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
    body.innerHTML = `
      <div class="item-top">
        <span class="host">${escapeHtml(r.hostname)}</span>
        <span class="status ${escapeHtml(r.status)}">${escapeHtml(r.status)}</span>
      </div>
      <div class="item-title">${escapeHtml(r.pageTitle || r.hostname)}</div>
      <div class="item-instruction">${escapeHtml(r.instruction)}</div>
      <div class="item-foot">
        <span>${escapeHtml(formatWhen(r.createdAt))}</span>
        <span>${r.screenshotCount} screenshot${r.screenshotCount === 1 ? "" : "s"}</span>
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

  $("#detail-title").textContent = record.pageTitle || record.hostname || "Activity";
  $("#detail-sub").textContent = `${record.status} · ${formatWhen(record.createdAt)} · ${record.url}`;

  $("#detail-kv").innerHTML = `
    <dt>Website</dt><dd>${escapeHtml(record.hostname)}</dd>
    <dt>URL</dt><dd><a href="#" data-url="${escapeAttr(record.url)}">${escapeHtml(record.url)}</a></dd>
    <dt>Instruction</dt><dd>${escapeHtml(record.instruction)}</dd>
    <dt>Note</dt><dd>${escapeHtml(record.note || "—")}</dd>
    <dt>Mode</dt><dd>${escapeHtml(record.mode || "—")}</dd>
    <dt>ID</dt><dd><code>${escapeHtml(record.id)}</code></dd>
  `;
  $("#detail-kv").querySelector("a")?.addEventListener("click", (e) => {
    e.preventDefault();
    void api.openExternal(record.url);
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
}

boot().catch((err) => {
  console.error(err);
  toast("Failed to load activity library");
});
