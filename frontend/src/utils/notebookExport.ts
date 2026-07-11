// Export a notebook to Markdown or a self-contained HTML document (issue #262).
// Markdown cells are emitted verbatim; SQL cells become fenced `sql` blocks;
// where a cell has a result it is rendered as a table (capped). Pure and
// unit-tested. The HTML build reuses the Markdown renderer and HTML escaper.

import type { Notebook } from "./notebook";
import type { ResultSet } from "./query";
import { renderMarkdown, escapeHtml } from "./markdown";

/** Max result rows included per cell in an export, so a large grid stays sane. */
export const EXPORT_ROW_CAP = 200;

const mdCell = (v: string | null) =>
  (v ?? "NULL").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** A result as a Markdown table (or an affected-rows note for a non-SELECT). */
function mdTable(r: ResultSet): string {
  if (r.columns.length === 0) {
    return `_${r.rowsAffected} fila(s) afectada(s)._`;
  }
  const head = "| " + r.columns.map((c) => mdCell(c.name)).join(" | ") + " |";
  const sep = "| " + r.columns.map(() => "---").join(" | ") + " |";
  const rows = r.rows
    .slice(0, EXPORT_ROW_CAP)
    .map((row) => "| " + row.map(mdCell).join(" | ") + " |");
  const more =
    r.rows.length > EXPORT_ROW_CAP
      ? `\n\n_… ${r.rows.length - EXPORT_ROW_CAP} fila(s) más._`
      : "";
  return [head, sep, ...rows].join("\n") + more;
}

/** Serialize a notebook to Markdown. `results` supplies each SQL cell's grid. */
export function notebookToMarkdown(
  nb: Notebook,
  results?: Map<string, ResultSet>,
): string {
  const parts: string[] = [`# ${nb.name}`];

  if (nb.params.length > 0) {
    parts.push("**Parámetros**");
    parts.push(nb.params.map((p) => `- \`:${p.name}\` = ${p.value}`).join("\n"));
  }

  for (const cell of nb.cells) {
    if (cell.kind === "markdown") {
      if (cell.source.trim() !== "") {
        parts.push(cell.source);
      }
      continue;
    }
    parts.push("```sql\n" + cell.source + "\n```");
    const res = results?.get(cell.id);
    if (res) {
      parts.push(mdTable(res));
    }
  }
  return parts.join("\n\n") + "\n";
}

/** A result as an HTML table (escaped), or an affected-rows note. */
function htmlTable(r: ResultSet): string {
  if (r.columns.length === 0) {
    return `<p class="nb-affected">${r.rowsAffected} fila(s) afectada(s).</p>`;
  }
  const head =
    "<tr>" + r.columns.map((c) => `<th>${escapeHtml(c.name)}</th>`).join("") + "</tr>";
  const rows = r.rows
    .slice(0, EXPORT_ROW_CAP)
    .map(
      (row) =>
        "<tr>" +
        row.map((v) => `<td>${v === null ? "<em>NULL</em>" : escapeHtml(v)}</td>`).join("") +
        "</tr>",
    )
    .join("");
  const more =
    r.rows.length > EXPORT_ROW_CAP
      ? `<p class="nb-more">… ${r.rows.length - EXPORT_ROW_CAP} fila(s) más.</p>`
      : "";
  return `<table class="nb-result"><thead>${head}</thead><tbody>${rows}</tbody></table>${more}`;
}

const HTML_CSS = `
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  pre { background: #f4f4f5; padding: 0.8rem; border-radius: 6px; overflow-x: auto; }
  code { font-family: ui-monospace, monospace; }
  table.nb-result { border-collapse: collapse; width: 100%; margin: 0.5rem 0 1.5rem; font-size: 14px; }
  table.nb-result th, table.nb-result td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; }
  table.nb-result th { background: #f4f4f5; }
  .nb-more, .nb-affected { color: #666; font-size: 13px; }
`;

/** Serialize a notebook to a self-contained HTML document. */
export function notebookToHtml(nb: Notebook, results?: Map<string, ResultSet>): string {
  const body: string[] = [`<h1>${escapeHtml(nb.name)}</h1>`];

  if (nb.params.length > 0) {
    const items = nb.params
      .map((p) => `<li><code>:${escapeHtml(p.name)}</code> = ${escapeHtml(p.value)}</li>`)
      .join("");
    body.push(`<p><strong>Parámetros</strong></p><ul>${items}</ul>`);
  }

  for (const cell of nb.cells) {
    if (cell.kind === "markdown") {
      if (cell.source.trim() !== "") {
        body.push(renderMarkdown(cell.source));
      }
      continue;
    }
    body.push(`<pre class="nb-sql"><code>${escapeHtml(cell.source)}</code></pre>`);
    const res = results?.get(cell.id);
    if (res) {
      body.push(htmlTable(res));
    }
  }

  return (
    `<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n` +
    `<title>${escapeHtml(nb.name)}</title>\n<style>${HTML_CSS}</style>\n</head>\n` +
    `<body>\n${body.join("\n")}\n</body>\n</html>\n`
  );
}
