import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { PortableHandoffPackage } from "@tabhandoff/protocol";
import { readHandoffPackage, PortableError } from "./portable.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function listHtml(items: string[]): string {
  if (!items.length) return "<p><em>None</em></p>";
  return `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
}

/**
 * Build a self-contained HTML preview of a handoff package.
 * Safe for sharing: no credentials, no auto-execution, no network calls.
 * Readable without installing TabHandoff (open in any browser).
 */
export function renderInspectHtml(pkg: PortableHandoffPackage): string {
  const claims = (pkg.claims ?? [])
    .map(
      (c) =>
        `<li><strong>${esc(c.kind)}</strong>: ${esc(c.text)}${
          c.source ? ` <span class="muted">(${esc(c.source)})</span>` : ""
        }</li>`,
    )
    .join("");
  const tests = (pkg.tests ?? [])
    .map(
      (t) =>
        `<tr><td>${esc(t.id)}</td><td><code>${esc(t.command)}</code></td><td>${esc(
          t.result,
        )}</td><td>${esc(t.expected ?? "")}</td></tr>`,
    )
    .join("");
  const events = pkg.execution.events
    .map(
      (e) =>
        `<li><time>${esc(e.at)}</time> <span class="kind">${esc(
          e.kind,
        )}</span> ${esc(e.tool ?? "")}: ${esc(e.detail)}</li>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>TabHandoff inspect — ${esc(pkg.id)}</title>
<style>
  :root { color-scheme: light; --bg:#f6f3ee; --ink:#1c1917; --muted:#78716c; --card:#fff; --accent:#0f766e; --warn:#9a3412; }
  body { margin:0; font:16px/1.5 "Segoe UI", system-ui, sans-serif; background:linear-gradient(160deg,#f6f3ee,#e7e5e4); color:var(--ink); }
  main { max-width:720px; margin:0 auto; padding:2rem 1.25rem 4rem; }
  h1 { font-size:1.5rem; margin:0 0 .25rem; }
  .sub { color:var(--muted); margin-bottom:1.5rem; }
  section { background:var(--card); border:1px solid #d6d3d1; border-radius:12px; padding:1rem 1.25rem; margin:1rem 0; }
  h2 { font-size:1rem; margin:0 0 .75rem; color:var(--accent); text-transform:uppercase; letter-spacing:.04em; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:.85rem; }
  .warn { color:var(--warn); font-size:.9rem; }
  .muted { color:var(--muted); }
  .kind { display:inline-block; padding:.05rem .4rem; border-radius:4px; background:#ecfdf5; color:#065f46; font-size:.75rem; }
  table { width:100%; border-collapse:collapse; font-size:.9rem; }
  th, td { text-align:left; padding:.35rem .25rem; border-bottom:1px solid #e7e5e4; vertical-align:top; }
  footer { margin-top:2rem; font-size:.85rem; color:var(--muted); }
</style>
</head>
<body>
<main>
  <h1>TabHandoff package</h1>
  <p class="sub">Inspect-only preview — no credentials, no auto-run. Schema ${esc(
    pkg.schemaVersion,
  )} · id <code>${esc(pkg.id)}</code></p>

  <section>
    <h2>Task</h2>
    <p><strong>Instruction:</strong> ${esc(pkg.instruction)}</p>
    ${
      pkg.intendedOutcome
        ? `<p><strong>Intended outcome:</strong> ${esc(pkg.intendedOutcome)}</p>`
        : ""
    }
    <p><strong>Status:</strong> ${esc(pkg.execution.status)} · agentLaunched=${
      pkg.execution.agentLaunched
    }</p>
    ${
      pkg.page
        ? `<p><strong>Page:</strong> ${esc(pkg.page.title || "(untitled)")} — <code>${esc(
            pkg.page.url,
          )}</code></p>`
        : ""
    }
  </section>

  <section>
    <h2>Acceptance criteria</h2>
    ${listHtml(pkg.acceptanceCriteria ?? [])}
  </section>

  <section>
    <h2>Completed / remaining</h2>
    <p><strong>Previous results</strong></p>
    ${listHtml(pkg.previousResults)}
    <p><strong>Remaining work</strong></p>
    ${listHtml(pkg.remainingWork)}
    <p><strong>Missing inputs</strong></p>
    ${listHtml(pkg.missingInputs ?? [])}
  </section>

  <section>
    <h2>Claims (honesty labels)</h2>
    ${claims ? `<ul>${claims}</ul>` : "<p><em>None recorded</em></p>"}
  </section>

  <section>
    <h2>Tests</h2>
    ${
      tests
        ? `<table><thead><tr><th>id</th><th>command</th><th>result</th><th>expected</th></tr></thead><tbody>${tests}</tbody></table>`
        : "<p><em>None declared</em></p>"
    }
  </section>

  <section>
    <h2>Permissions</h2>
    ${
      pkg.permissions
        ? `<pre>${esc(JSON.stringify(pkg.permissions, null, 2))}</pre>`
        : "<p><em>Not specified (treat as deny-all)</em></p>"
    }
  </section>

  <section>
    <h2>Events</h2>
    <ul>${events || "<li><em>None</em></li>"}</ul>
  </section>

  <section>
    <h2>Safety</h2>
    <p class="warn">${esc(pkg.untrustedContentWarning)}</p>
    <p class="muted">This HTML is a static preview. Richer continuation requires TabHandoff CLI/MCP after you approve.</p>
  </section>

  <footer>
    previousHandoffId: ${esc(pkg.previousHandoffId ?? "(none)")}<br/>
    sourceAgent: ${esc(pkg.sourceAgent ?? "")} → destinationAgent: ${esc(
      pkg.destinationAgent ?? "",
    )}
  </footer>
</main>
</body>
</html>`;
}

export type InspectWriteResult = {
  id: string;
  htmlPath: string;
  packagePath: string;
};

/** Write INSPECT.html next to handoff.json (or to --out). */
export async function writeInspectHtml(
  target: string,
  options?: { home?: string; outPath?: string },
): Promise<InspectWriteResult> {
  const { dir, package: pkg } = await readHandoffPackage(target, {
    home: options?.home,
  });
  const htmlPath = options?.outPath
    ? path.resolve(options.outPath)
    : path.join(dir, "INSPECT.html");
  try {
    await writeFile(htmlPath, renderInspectHtml(pkg), "utf8");
  } catch (err) {
    throw new PortableError(
      `Failed to write inspect HTML: ${err instanceof Error ? err.message : String(err)}`,
      "export_failed",
    );
  }
  return {
    id: pkg.id,
    htmlPath,
    packagePath: path.join(dir, "handoff.json"),
  };
}
