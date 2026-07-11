import { describe, it, expect } from "vitest";
import { notebookToMarkdown, notebookToHtml } from "../../src/utils/notebookExport";
import type { Notebook } from "../../src/utils/notebook";
import type { ResultSet } from "../../src/utils/query";

const nb: Notebook = {
  id: "nb-1",
  name: "Ventas 2024",
  params: [{ name: "y", value: "2024" }],
  cells: [
    { id: "cell-1", kind: "markdown", source: "## Resumen\nTexto **importante**." },
    { id: "cell-2", kind: "sql", source: "SELECT id, name FROM t" },
  ],
};

const result: ResultSet = {
  columns: [
    { name: "id", type: "int" },
    { name: "name", type: "text" },
  ],
  rows: [
    ["1", "alice"],
    ["2", null],
  ],
  truncated: false,
  rowsAffected: 0,
};

describe("notebookToMarkdown", () => {
  it("emits the title, params, markdown, fenced SQL and a result table", () => {
    const md = notebookToMarkdown(nb, new Map([["cell-2", result]]));
    expect(md).toContain("# Ventas 2024");
    expect(md).toContain("`:y` = 2024");
    expect(md).toContain("## Resumen"); // markdown cell verbatim
    expect(md).toContain("```sql\nSELECT id, name FROM t\n```");
    expect(md).toContain("| id | name |");
    expect(md).toContain("| 1 | alice |");
    expect(md).toContain("| 2 | NULL |"); // SQL NULL rendered
  });

  it("omits result tables when no results are supplied", () => {
    const md = notebookToMarkdown(nb);
    expect(md).not.toContain("| id | name |");
  });
});

describe("notebookToHtml", () => {
  it("is a self-contained document with escaped content and a table", () => {
    const html = notebookToHtml(nb, new Map([["cell-2", result]]));
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<h1>Ventas 2024</h1>");
    expect(html).toContain("<table class=\"nb-result\">");
    expect(html).toContain("<th>id</th>");
    expect(html).toContain("<em>NULL</em>"); // null cell
  });

  it("escapes HTML in a SQL cell so it cannot inject markup", () => {
    const evil: Notebook = {
      id: "nb-x",
      name: "x",
      params: [],
      cells: [{ id: "cell-1", kind: "sql", source: "SELECT '<script>'" }],
    };
    const html = notebookToHtml(evil);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
