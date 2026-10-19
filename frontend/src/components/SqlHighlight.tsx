import { For, createMemo } from "solid-js";
import { highlightSql } from "../utils/sqlHighlight";

/** SQL shown read-only with the editor's syntax colours. */
export function SqlHighlight(props: { sql: string; engine?: string; class?: string; label?: string }) {
  const spans = createMemo(() => highlightSql(props.sql, props.engine));
  return (
    <pre class={`sql-hl ${props.class ?? ""}`} aria-label={props.label} tabindex="0">
      <For each={spans()}>{(s) => (s.cls ? <span class={s.cls}>{s.text}</span> : s.text)}</For>
    </pre>
  );
}
