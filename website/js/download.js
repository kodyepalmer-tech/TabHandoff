const REPO = "kodyepalmer-tech/TabHandoff";
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

/** @typedef {{ name: string, browser_download_url: string, size: number }} GhAsset */

/**
 * Classify a release asset into platform + kind for UI rows.
 * @param {string} name
 */
function classify(name) {
  const lower = name.toLowerCase();
  if (lower === "sha256sums" || lower.endsWith(".blockmap")) return null;
  if (lower.includes("mac") || lower.endsWith(".dmg") || lower.endsWith(".pkg")) {
    const arch = lower.includes("arm64")
      ? "arm64"
      : lower.includes("x64") ||
          lower.includes("x86_64") ||
          lower.includes("amd64") ||
          lower.includes("intel")
        ? "x64"
        : "universal/x64";
    return { os: "mac", label: `macOS disk image (${arch})`, arch };
  }
  if (
    lower.endsWith(".exe") ||
    lower.endsWith(".msi") ||
    (lower.includes("win") && !lower.includes("darwin"))
  ) {
    return { os: "win", label: "Windows installer (x64)", arch: "x64" };
  }
  if (lower.endsWith(".appimage")) {
    return { os: "linux", label: "Linux AppImage (x64)", arch: "x64" };
  }
  if (lower.endsWith(".deb") || lower.endsWith(".rpm")) {
    return {
      os: "linux",
      label: lower.endsWith(".rpm")
        ? "Linux RPM (x64)"
        : "Debian / Ubuntu package (x64)",
      arch: "amd64",
    };
  }
  return null;
}

function detectPlatform() {
  const ua = navigator.userAgent || "";
  const plat = navigator.platform || "";
  if (/Mac|iPhone|iPad|iPod/i.test(ua) || /Mac/i.test(plat)) return "mac";
  if (/Win/i.test(ua) || /Win/i.test(plat)) return "win";
  return "linux";
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * @param {string} os
 * @param {GhAsset[]} assets
 * @param {string | null} checksumUrl
 * @param {string | null} version
 */
function renderOs(os, assets, checksumUrl, version) {
  const list = document.querySelector(`.asset-list[data-os="${os}"]`);
  if (!list) return;

  const matched = [];
  for (const asset of assets) {
    const info = classify(asset.name);
    if (info && info.os === os) matched.push({ asset, info });
  }

  list.innerHTML = "";

  if (!matched.length) {
    const li = document.createElement("li");
    li.className = "asset-row";
    li.innerHTML = `
      <div>
        <span class="asset-label">Installer</span>
        <span class="asset-sub">No published asset for this platform yet</span>
      </div>
      <span class="badge-soon">Coming soon</span>
    `;
    list.appendChild(li);
  } else {
    for (const { asset, info } of matched) {
      const li = document.createElement("li");
      li.className = "asset-row";
      const size = formatBytes(asset.size);
      li.innerHTML = `
        <div>
          <span class="asset-label">${info.label}</span>
          <span class="asset-sub">${asset.name}${size ? " · " + size : ""}${
            version ? " · " + version : ""
          }</span>
        </div>
        <a class="btn btn-primary" href="${asset.browser_download_url}">Download</a>
      `;
      list.appendChild(li);
    }
  }

  if (checksumUrl) {
    const li = document.createElement("li");
    li.className = "asset-row checksums";
    li.innerHTML = `
      <div>
        <span class="asset-label">Checksums</span>
        <span class="asset-sub">SHA-256</span>
      </div>
      <a href="${checksumUrl}">SHA256SUMS</a>
    `;
    list.appendChild(li);
  }
}

function selectPlatform(os) {
  for (const btn of document.querySelectorAll(".platform-tabs button")) {
    const on = btn.dataset.platform === os;
    btn.setAttribute("aria-selected", on ? "true" : "false");
  }
  for (const panel of document.querySelectorAll(".download-panel")) {
    panel.hidden = panel.id !== `panel-${os}`;
  }
}

async function main() {
  const status = document.getElementById("release-status");
  const initial = detectPlatform();
  selectPlatform(initial);

  for (const btn of document.querySelectorAll(".platform-tabs button")) {
    btn.addEventListener("click", () => selectPlatform(btn.dataset.platform));
  }

  // Render honest empty state first
  for (const os of ["mac", "win", "linux"]) {
    renderOs(os, [], null, null);
  }

  try {
    const res = await fetch(API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (res.status === 404) {
      status.textContent =
        "No GitHub Release published yet. Installers will appear here after the first tagged release. Use the current path below each platform.";
      return;
    }
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = await res.json();
    /** @type {GhAsset[]} */
    const assets = data.assets || [];
    const version = data.tag_name || data.name || null;
    const checksum = assets.find(
      (a) => a.name.toLowerCase() === "sha256sums",
    );
    const checksumUrl = checksum?.browser_download_url ?? null;

    status.innerHTML = version
      ? `Latest release: <strong>${version}</strong>${
          data.html_url
            ? ` · <a href="${data.html_url}">release notes</a>`
            : ""
        }`
      : "Latest release loaded.";

    for (const os of ["mac", "win", "linux"]) {
      renderOs(os, assets, checksumUrl, version);
    }
  } catch (err) {
    status.textContent =
      "Could not reach GitHub Releases right now. Platforms show Coming soon until assets can be verified — use the source path below, or open the Releases page directly.";
    console.warn(err);
  }
}

main();
