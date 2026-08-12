import { For, Show, createMemo, createSignal } from "solid-js";
import { Panel } from "./Panel";
import { searchSnippets, type Snippet } from "../utils/snippets";
import { openContextMenu } from "../utils/contextMenu";
import { t } from "../utils/i18n";

// The snippet library (issues #129, #338): find a saved query among many, look at
// it, and act on it. Master-detail — a filterable list beside the full body — in
// place of the old scroll of every snippet with its body permanently unfolded.
//
// Deliberately NOT an editor. Changing a body happens in the snippet's own tab,
// which already has CodeMirror, schema completion and a Run button; a second,
// worse editor here would be two ways to do one thing. Saving a new snippet is
// likewise the editor toolbar's job (issue #320), which knows the scope that was
// captured and can offer Undo. Filtering is pure (searchSnippets); persistence and
// tab opening are the workspace's.
export function SnippetsPanel(props: {
  entries: Snippet[];
  onOpen: (s: Snippet) => void;
  onInsert: (s: Snippet) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (s: Snippet) => void;
  onRemove: (id: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = createSignal("");
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal("");
  let fileInput!: HTMLInputElement;

  const results = createMemo(() => searchSnippets(props.entries, query()));
  // Follows the list rather than being remembered: a selection filtered out from
  // under you would leave the detail pane showing something not on screen.
  const selected = createMemo(() => {
    const list = results();
    return list.find((s) => s.id === selectedId()) ?? list[0];
  });

  const startRename = (s: Snippet) => {
    setRenamingId(s.id);
    setDraft(s.name);
  };
  const commitRename = () => {
    const id = renamingId();
    if (id !== null && draft().trim()) props.onRename(id, draft().trim());
    setRenamingId(null);
  };

  const menu = (e: MouseEvent, s: Snippet) =>
    openContextMenu(e, [
      { label: t("snip.insert"), action: () => props.onInsert(s) },
      { label: t("snip.rename"), action: () => startRename(s) },
      { label: t("snip.duplicate"), action: () => props.onDuplicate(s) },
      { separator: true },
      { label: t("snip.remove"), danger: true, action: () => props.onRemove(s.id) },
    ]);

  /** Up/down move through the filtered list, Enter opens the highlighted one. */
  const onListKeyDown = (e: KeyboardEvent) => {
    const list = results();
    const at = list.findIndex((s) => s.id === selected()?.id);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = list[at + (e.key === "ArrowDown" ? 1 : -1)];
      if (next) setSelectedId(next.id);
    } else if (e.key === "Enter" && selected()) {
      e.preventDefault();
      props.onOpen(selected()!);
    }
  };

  const onFile = (e: Event) => {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) props.onImport(file);
    (e.currentTarget as HTMLInputElement).value = ""; // allow re-importing the same file
  };

  return (
    <Panel title={t("editor.snippetsTitle")} class="snippets" onClose={props.onClose}>
      <h2>{t("editor.snippetsTitle")}</h2>

      <Show
        when={props.entries.length > 0}
        fallback={<p class="snippet-empty">{t("snip.paletteEmptySet")}</p>}
      >
        <div class="snippet-library">
          <div class="snippet-list-pane">
            <input
              class="snippet-search"
              type="search"
              placeholder={t("snip.searchPlaceholder")}
              aria-label={t("snip.searchLabel")}
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              autofocus
            />
            <Show
              when={results().length > 0}
              fallback={<p class="snippet-empty">{t("snip.noMatches")}</p>}
            >
              <ul class="snippet-list" aria-label={t("snip.listLabel")} onKeyDown={onListKeyDown}>
                <For each={results()}>
                  {(s) => (
                    <li>
                      <button
                        class={`snippet-row ${s.id === selected()?.id ? "selected" : ""}`}
                        aria-current={s.id === selected()?.id}
                        onClick={() => setSelectedId(s.id)}
                        onDblClick={() => props.onOpen(s)}
                        onContextMenu={(e) => menu(e, s)}
                      >
                        <span class="snippet-row-name">{s.name}</span>
                        {/* What it does, which is how a saved query is recognised. */}
                        <span class="snippet-row-hint">{firstLine(s.body)}</span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>

          <Show when={selected()}>
            {(s) => (
              <div class="snippet-detail">
                <div class="snippet-detail-head">
                  <Show
                    when={renamingId() === s().id}
                    fallback={<span class="snippet-detail-name">{s().name}</span>}
                  >
                    <input
                      class="snippet-rename"
                      value={draft()}
                      aria-label={t("snip.renameLabel")}
                      autofocus
                      onInput={(e) => setDraft(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={commitRename}
                    />
                  </Show>
                  <button
                    class="primary"
                    title={t("snip.openTitle")}
                    onClick={() => props.onOpen(s())}
                  >
                    {t("snip.open")}
                  </button>
                  <button
                    class="snippet-more"
                    aria-label={t("snip.more")}
                    title={t("snip.more")}
                    onClick={(e) => menu(e, s())}
                  >
                    ⋯
                  </button>
                </div>
                <pre class="snippet-body">{s().body}</pre>
              </div>
            )}
          </Show>
        </div>
      </Show>

      <div class="modal-actions">
        <span class="snippet-count">
          {props.entries.length === 1
            ? t("snip.countOne")
            : t("snip.count", { n: props.entries.length })}
        </span>
        <span class="modal-actions-spacer" />
        <button onClick={() => fileInput.click()} title={t("snip.importTitle")}>
          {t("snip.import")}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          style="display:none"
          onChange={onFile}
        />
        <button
          onClick={props.onExport}
          disabled={props.entries.length === 0}
          title={t("snip.exportTitle")}
        >
          {t("snip.export")}
        </button>
        <button class="primary" onClick={props.onClose}>
          {t("common.close")}
        </button>
      </div>
    </Panel>
  );
}

/** The first non-blank line of a body, for the one-line hint under a name. */
function firstLine(body: string): string {
  return body.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
}
