// Read-only SQL highlighting (DDL view, audit A-28): the same lang-sql parser
// and per-engine dialect the editor uses, cut into spans carrying lezer's
// `tok-*` classes. A whole CodeMirror instance for text nobody edits would be
// the heavier way to the same colours.

import { classHighlighter, highlightCode } from "@lezer/highlight";
import { editorDialect } from "./sqlDialect";

/** A run of text and its token classes ("" for plain text and line breaks). */
export interface SqlSpan {
  text: string;
  cls: string;
}

export function highlightSql(sql: string, engine?: string | null): SqlSpan[] {
  const tree = editorDialect(engine).language.parser.parse(sql);
  const out: SqlSpan[] = [];
  highlightCode(
    sql,
    tree,
    classHighlighter,
    (text, cls) => out.push({ text, cls }),
    () => out.push({ text: "\n", cls: "" }),
  );
  return out;
}
