#!/usr/bin/env node
/**
 * Capture a real TabHandoff demo strip / GIF from live CLI + desktop UI.
 * Never fabricates progress, screenshots, or agent success.
 *
 * Usage:
 *   node scripts/capture-demo.mjs
 *   TABHANDOFF_HOME=/path node scripts/capture-demo.mjs
 */
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  copyFile,
  readdir,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../packages/cli/node_modules/playwright/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "docs", "assets");
const framesDir = path.join(outDir, "demo-frames");

const cli = path.join(root, "packages", "cli", "dist", "index.js");
const url = process.env.TABHANDOFF_DEMO_URL || "https://example.com";
const instruction =
  process.env.TABHANDOFF_DEMO_INSTRUCTION ||
  "Extract the main heading and first paragraph as markdown";

function run(cmd, args, opts = {}) {
  const { env = {}, cwd = root, allowFail = false } = opts;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      process.stderr.write(d);
    });
    child.on("close", (code) => {
      if (code === 0 || allowFail) resolve({ stdout, stderr, code });
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}\n${stderr}`));
    });
  });
}

function parseJsonBlob(text) {
  const i = text.indexOf("{");
  const j = text.lastIndexOf("}");
  if (i < 0 || j < 0) throw new Error("No JSON in command output");
  return JSON.parse(text.slice(i, j + 1));
}

async function ensureHome() {
  if (process.env.TABHANDOFF_HOME?.trim()) {
    return process.env.TABHANDOFF_HOME.trim();
  }
  const home = await mkdtemp(path.join(tmpdir(), "tabhandoff-capture-"));
  process.env.TABHANDOFF_HOME = home;
  return home;
}

async function findLatestSucceeded(home) {
  const receipts = path.join(home, "receipts");
  try {
    await access(receipts);
  } catch {
    return null;
  }
  const ids = await readdir(receipts);
  let best = null;
  for (const id of ids) {
    const shots = path.join(receipts, id, "screenshots");
    try {
      const files = await readdir(shots);
      if (files.includes("01-loaded.png") && files.includes("02-result.png")) {
        const st = await readFile(path.join(home, "jobs", `${id}.json`), "utf8").catch(
          () => null,
        );
        if (st) {
          const job = JSON.parse(st);
          if (job.status === "succeeded") {
            best = { id, receiptDir: path.join(receipts, id), job };
          }
        } else {
          best = { id, receiptDir: path.join(receipts, id), job: null };
        }
      }
    } catch {
      /* skip */
    }
  }
  return best;
}

async function runRealHandoff(home) {
  console.log("→ Running real page extraction…");
  const { stdout } = await run(
    process.execPath,
    [cli, "run", "--url", url, "--instruction", instruction, "--wait"],
    { env: { TABHANDOFF_HOME: home } },
  );
  const job = parseJsonBlob(stdout);
  if (job.status !== "succeeded") {
    throw new Error(`Handoff did not succeed: ${JSON.stringify(job)}`);
  }
  return {
    id: job.id,
    receiptDir: path.dirname(job.receiptPath),
    job,
  };
}

async function captureDesktop(home, outPng) {
  console.log("→ Capturing real desktop My Activity UI…");
  await run("pnpm", ["--filter", "@tabhandoff/desktop", "build"], {
    env: { TABHANDOFF_HOME: home },
  });
  const desktopDir = path.join(root, "packages", "desktop");
  const electronCli = path.join(desktopDir, "node_modules", "electron", "cli.js");
  const env = {
    TABHANDOFF_HOME: home,
    TABHANDOFF_DEMO_CAPTURE: outPng,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
  };
  const electronArgs = [electronCli, ".", "--no-sandbox"];
  const hasDisplay = Boolean(process.env.DISPLAY);
  if (hasDisplay) {
    await run(process.execPath, electronArgs, { env, cwd: desktopDir });
  } else {
    await run(
      "xvfb-run",
      ["-a", "-s", "-screen 0 1400x900x24", process.execPath, ...electronArgs],
      { env, cwd: desktopDir },
    );
  }
  await access(outPng);
}

async function labelFrame(browser, opts) {
  const page = await browser.newPage({
    viewport: { width: opts.width, height: opts.height },
  });
  const imgB64 = opts.imagePath
    ? (await readFile(opts.imagePath)).toString("base64")
    : null;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Source+Sans+3:wght@400;600&display=swap');
  html,body{margin:0;padding:0;width:${opts.width}px;height:${opts.height}px;background:#0b0b0c;color:#f4f4f5;
    font-family:'Source Sans 3',system-ui,sans-serif;overflow:hidden}
  .wrap{display:grid;grid-template-rows:auto 1fr auto;height:100%}
  .bar{padding:18px 22px 10px;display:flex;justify-content:space-between;align-items:baseline;gap:12px}
  .step{font-family:Syne,sans-serif;font-weight:800;font-size:28px;letter-spacing:-0.02em}
  .honest{font-size:13px;color:#a1a1aa;max-width:70%}
  .stage{margin:0 18px;border:1px solid #27272a;border-radius:12px;overflow:hidden;background:#111;
    display:flex;align-items:center;justify-content:center}
  .stage img{width:100%;height:100%;object-fit:cover;object-position:top}
  .pre{white-space:pre-wrap;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;
    padding:16px;color:#e4e4e7;width:100%;height:100%;overflow:hidden;box-sizing:border-box}
  .foot{padding:10px 22px 16px;font-size:12px;color:#71717a}
  .pill{display:inline-block;border:1px solid #3f3f46;border-radius:999px;padding:2px 10px;margin-right:8px}
</style></head><body>
  <div class="wrap">
    <div class="bar">
      <div class="step">${opts.title}</div>
      <div class="honest">${opts.subtitle}</div>
    </div>
    <div class="stage" style="height:${opts.height - 110}px">
      ${
        imgB64
          ? `<img alt="" src="data:image/png;base64,${imgB64}" />`
          : `<div class="pre">${opts.text || ""}</div>`
      }
    </div>
    <div class="foot">
      <span class="pill">real run</span>
      <span class="pill">local evidence</span>
      ${opts.footer || ""}
    </div>
  </div>
</body></html>`;
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(200);
  const out = path.join(framesDir, opts.filename);
  await page.screenshot({ path: out, type: "png" });
  await page.close();
  return out;
}

async function composeStrip(framePaths, outPath) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 520 },
  });
  const imgs = [];
  for (const p of framePaths) {
    imgs.push((await readFile(p)).toString("base64"));
  }
  const html = `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
  html,body{margin:0;background:#09090b;width:1600px;height:520px;overflow:hidden}
  .row{display:grid;grid-template-columns:repeat(${framePaths.length},1fr);gap:10px;padding:12px;height:100%;box-sizing:border-box}
  .cell{border:1px solid #27272a;border-radius:10px;overflow:hidden}
  .cell img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}
</style></head><body>
  <div class="row">
    ${imgs.map((b) => `<div class="cell"><img src="data:image/png;base64,${b}"/></div>`).join("")}
  </div>
</body></html>`;
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(150);
  await page.screenshot({ path: outPath, type: "png" });
  await browser.close();
}

async function composeGif(framePaths, outPath) {
  // Prefer ffmpeg palette GIF; fall back to animated webp via ffmpeg.
  const listFile = path.join(framesDir, "frames.txt");
  await writeFile(
    listFile,
    framePaths.map((p) => `file '${p}'\nduration 1.4`).join("\n") +
      `\nfile '${framePaths[framePaths.length - 1]}'\n`,
  );
  try {
    await run("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-vf",
      "scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer",
      "-loop",
      "0",
      outPath,
    ]);
    return outPath;
  } catch {
    const webp = outPath.replace(/\.gif$/i, ".webp");
    await run("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-vf",
      "scale=960:-1:flags=lanczos",
      "-loop",
      "0",
      webp,
    ]);
    return webp;
  }
}

async function main() {
  await mkdir(framesDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const home = await ensureHome();
  console.log(`TABHANDOFF_HOME=${home}`);

  let handoff = await findLatestSucceeded(home);
  if (!handoff) {
    handoff = await runRealHandoff(home);
  } else {
    console.log(`→ Reusing succeeded handoff ${handoff.id}`);
  }

  const shot1 = path.join(handoff.receiptDir, "screenshots", "01-loaded.png");
  const shot2 = path.join(handoff.receiptDir, "screenshots", "02-result.png");
  await access(shot1);
  await access(shot2);

  // Copy raw evidence frames into docs for inspection.
  await copyFile(shot1, path.join(outDir, "tabhandoff-demo-screenshot.png"));
  await copyFile(shot2, path.join(outDir, "tabhandoff-demo-screenshot-result.png"));

  const desktopPng = path.join(framesDir, "04-desktop-my-activity.png");
  await captureDesktop(home, desktopPng);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const receipt = await readFile(
    path.join(handoff.receiptDir, "receipt.md"),
    "utf8",
  );
  const receiptSnippet = receipt.split("\n").slice(0, 28).join("\n");

  const f1 = await labelFrame(browser, {
    width: 720,
    height: 520,
    filename: "01-capture.png",
    title: "1 · Capture",
    subtitle: "Isolated Chromium opened the live page (no cookies copied).",
    imagePath: shot1,
    footer: `id ${handoff.id.slice(0, 8)}…`,
  });
  const f2 = await labelFrame(browser, {
    width: 720,
    height: 520,
    filename: "02-package.png",
    title: "2 · Package",
    subtitle: "Portable handoff + receipt written under ~/.tabhandoff/receipts/.",
    text: receiptSnippet
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;"),
    footer: "package + receipt.md · local only",
  });
  const f3 = await labelFrame(browser, {
    width: 720,
    height: 520,
    filename: "03-extract.png",
    title: "3 · Page extraction",
    subtitle: "Deterministic DOM extract — not autonomous AI (no API key).",
    imagePath: shot2,
    footer: "mode: dom · agentLaunched: false",
  });
  const f4 = await labelFrame(browser, {
    width: 720,
    height: 520,
    filename: "04-evidence.png",
    title: "4 · Evidence",
    subtitle: "Desktop My Activity — real Electron UI of this machine’s receipts.",
    imagePath: desktopPng,
    footer: "TABHANDOFF_DEMO_CAPTURE · honest local library",
  });
  await browser.close();

  const strip = path.join(outDir, "tabhandoff-demo-strip.png");
  await composeStrip([f1, f2, f3, f4], strip);

  const gifPath = path.join(outDir, "tabhandoff-demo.gif");
  const anim = await composeGif([f1, f2, f3, f4], gifPath);

  const manifest = {
    capturedAt: new Date().toISOString(),
    handoffId: handoff.id,
    home,
    url,
    instruction,
    mode: "dom",
    agentLaunched: false,
    label:
      "Page extraction (deterministic DOM — not autonomous AI). Real CLI + desktop capture.",
    frames: [f1, f2, f3, f4, desktopPng],
    strip,
    animation: anim,
  };
  await writeFile(
    path.join(framesDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  console.log("\n✅ Demo artifacts");
  console.log(`  strip: ${strip}`);
  console.log(`  anim:  ${anim}`);
  console.log(`  frames: ${framesDir}`);
  console.log(`  manifest: ${path.join(framesDir, "manifest.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
