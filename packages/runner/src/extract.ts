import type { Page } from "playwright";

export type ExtractResult = {
  markdown: string;
  title: string;
  mode: "dom" | "llm";
};

/**
 * Deterministic DOM extractor for common public-page instructions.
 * Used when no LLM API key is set, and as a fast path for extract-style tasks.
 */
export async function extractFromPage(
  page: Page,
  instruction: string,
): Promise<ExtractResult> {
  const title = await page.title();
  const lower = instruction.toLowerCase();

  const data = await page.evaluate(() => {
    const pickText = (el: Element | null | undefined) =>
      (el?.textContent ?? "").replace(/\s+/g, " ").trim();

    const headings = Array.from(
      document.querySelectorAll("h1, h2, h3, h4"),
    ).map((el) => ({
      level: Number(el.tagName.slice(1)),
      text: pickText(el),
    })).filter((h) => h.text.length > 0);

    const paragraphs = Array.from(document.querySelectorAll("p"))
      .map((el) => pickText(el))
      .filter((t) => t.length > 20)
      .slice(0, 12);

    const links = Array.from(document.querySelectorAll("a[href]"))
      .map((a) => {
        const href = (a as HTMLAnchorElement).href;
        const text = pickText(a);
        return { text, href };
      })
      .filter((l) => l.text && l.href.startsWith("http"))
      .slice(0, 40);

    const tables = Array.from(document.querySelectorAll("table")).slice(0, 5).map((table) => {
      const rows = Array.from(table.querySelectorAll("tr")).slice(0, 30).map((tr) =>
        Array.from(tr.querySelectorAll("th, td")).map((c) => pickText(c)),
      );
      return rows;
    });

    const main =
      pickText(document.querySelector("main")) ||
      pickText(document.querySelector("article")) ||
      pickText(document.body).slice(0, 4000);

    return {
      headings,
      paragraphs,
      links,
      tables,
      main: main.slice(0, 4000),
    };
  });

  const wantsHeadings =
    /heading|h1|title|outline|toc|table of contents/.test(lower) ||
    /extract.*(page|doc)/.test(lower);
  const wantsPricing = /pric|plan|tier|cost|\$/.test(lower);
  const wantsTable = /table|markdown table/.test(lower);
  const wantsLinks = /link|href|anchor/.test(lower);
  const wantsParagraph =
    /paragraph|summary|intro|first paragraph|main (content|text)/.test(lower);

  const lines: string[] = [];
  lines.push(`# ${title || "Untitled page"}`);
  lines.push("");
  lines.push(`_Source: ${page.url()}_`);
  lines.push("");
  lines.push(`## Instruction`);
  lines.push(instruction.trim());
  lines.push("");

  if (wantsPricing || wantsTable) {
    lines.push(`## Tables`);
    if (data.tables.length === 0) {
      lines.push("_No HTML tables found. Falling back to headings + pricing-like text._");
      lines.push("");
      const priceLike = data.paragraphs.filter((p) => /\$|€|£|usd|month|year|free|pro|team/i.test(p));
      for (const p of priceLike.slice(0, 8)) {
        lines.push(`- ${p}`);
      }
      // also dump heading outline often used on pricing pages
      for (const h of data.headings.slice(0, 20)) {
        lines.push(`${"#".repeat(Math.min(h.level + 1, 6))} ${h.text}`);
      }
    } else {
      for (const [i, table] of data.tables.entries()) {
        lines.push(`### Table ${i + 1}`);
        if (table[0]) {
          lines.push(`| ${table[0].join(" | ")} |`);
          lines.push(`| ${table[0].map(() => "---").join(" | ")} |`);
          for (const row of table.slice(1)) {
            lines.push(`| ${row.join(" | ")} |`);
          }
        }
        lines.push("");
      }
    }
  } else if (wantsLinks) {
    lines.push(`## Links`);
    for (const l of data.links.slice(0, 25)) {
      lines.push(`- [${l.text}](${l.href})`);
    }
  } else if (wantsHeadings && !wantsParagraph) {
    lines.push(`## Headings`);
    for (const h of data.headings.slice(0, 40)) {
      lines.push(`${"#".repeat(Math.min(h.level, 6))} ${h.text}`);
    }
  } else {
    lines.push(`## Content`);
    if (data.headings[0]) {
      lines.push(`### ${data.headings[0].text}`);
      lines.push("");
    }
    if (data.paragraphs[0]) {
      lines.push(data.paragraphs[0]);
      lines.push("");
    }
    if (wantsHeadings || data.paragraphs.length === 0) {
      for (const h of data.headings.slice(0, 15)) {
        lines.push(`${"#".repeat(Math.min(h.level + 1, 6))} ${h.text}`);
      }
    }
    if (!data.paragraphs[0] && !data.headings[0]) {
      lines.push(data.main.slice(0, 1500));
    }
  }

  lines.push("");
  lines.push(`## Extraction mode`);
  lines.push("`dom` (deterministic; no model key required)");

  return {
    title: title || "Untitled",
    markdown: lines.join("\n").trim() + "\n",
    mode: "dom",
  };
}
