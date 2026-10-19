import { Show, type JSX } from "solid-js";
import { openContextMenu, type MenuItem } from "../utils/contextMenu";
import { runButtonLabel, runChoices, type RunInfo, type RunScope } from "../utils/runScope";
import { formatKeys } from "../utils/shortcuts";
import { t } from "../utils/i18n";
import { Icon } from "./icons";

// The SQL editor's run toolbar (issue #691, M14 R-01/R-02/R-04/R-19/R-20):
//
//   [● conexión · base ▾] [▶ Ejecutar sentencia | ▾] | Formatear | Auto/Manual | ··· | Más
//
// The connection selector first, so what the query runs against is never out of
// sight. The primary button NAMES what it runs (the statement under the cursor,
// or the selection) and its menu offers the three scopes with what each covers
// now. While a run goes on, «■ Detener» stands where the run button was. Everything
// else used rarely lives under «Más». Presentational: the workspace owns the
// state and builds the menus that depend on it.
export function EditorToolbar(props: {
  /** The tab's connection, or null when it has none. */
  conn: { name: string; color?: string; db?: string | null } | null;
  /** The connection selector's menu (other open connections, databases). */
  connItems: () => MenuItem[];
  info: RunInfo;
  running: boolean;
  /** Why a running query cannot be stopped (engine without cancel), if so. */
  stopBlocked?: string;
  isMac: boolean;
  onRun: (scope?: RunScope) => void;
  onStop: () => void;
  onFormat: () => void;
  /** The transaction controls of the tab's connection (TxControls). */
  tx?: JSX.Element;
  /** The «Más» menu; gets the click so an entry can open a menu of its own there. */
  moreItems: (e: MouseEvent) => MenuItem[];
  /** The connection runs in manual transaction mode: nothing commits on its own. */
  manual?: boolean;
  /** Switches the connection to manual mode; absent when it has no transactions. */
  onUseManual?: () => void;
}) {
  const keys = (k: string) => (k ? formatKeys(k, props.isMac ? "macos" : "windows") : undefined);

  // The three scopes as a radio set, the one Ctrl+Enter runs checked; then, when
  // the script writes and each statement commits on its own, a warning that
  // says which statement and offers manual mode (M14 EditorRunMenu).
  const scopeMenu = (e: MouseEvent) => {
    const items: MenuItem[] = runChoices(props.info).map((c) => ({
      label: t(c.label),
      hint: [t(c.hint.key, c.hint.params), keys(c.keys)].filter(Boolean).join(" · "),
      disabled: c.disabled,
      checked: c.current,
      action: () => props.onRun(c.scope),
    }));
    const write = props.info.firstWrite;
    if (write && !props.manual) {
      items.push(
        { separator: true },
        { note: t("editor.scriptWritesAuto", { verb: write.verb, n: write.line }) },
      );
      if (props.onUseManual) items.push({ label: t("editor.useManual"), action: props.onUseManual });
    }
    items.push({ separator: true }, { note: t("editor.scopeHelp") });
    openContextMenu(e, items);
  };

  const connLabel = () =>
    props.conn
      ? props.conn.db
        ? t("editor.connDbAria", { name: props.conn.name, db: props.conn.db })
        : t("editor.connAria", { name: props.conn.name })
      : t("editor.noConn");

  return (
    <div class="edit-toolbar editor-toolbar" role="toolbar" aria-label={t("editor.toolbarAria")}>
      <button
        class="editor-conn"
        aria-haspopup="menu"
        aria-label={connLabel()}
        title={t("editor.connTitle")}
        onClick={(e) => openContextMenu(e, props.connItems())}
      >
        <span
          class="editor-conn-dot"
          aria-hidden="true"
          style={{ background: props.conn?.color ?? "var(--text-dim)" }}
        />
        <span class="editor-conn-name">{props.conn?.name ?? t("editor.noConn")}</span>
        <Show when={props.conn?.db}>
          <span class="editor-conn-db">· {props.conn!.db}</span>
        </Show>
        <Icon name="chevron-down" size={12} class="eb-caret" />
      </button>
      {/* While something runs, «Detener» takes the run button's place (M14
          EditorRunning): the one thing that can be done to a run then. */}
      <Show
        when={props.running}
        fallback={
          <span class="editor-run">
            <button
              class="edit-btn edit-btn-primary editor-run-main"
              title={t(props.info.hasSelection ? "editor.runSelectionTitle" : "editor.runStatementTitle", { keys: keys("Mod+Enter")! })}
              onClick={() => props.onRun()}
            >
              <Icon name="play" size={14} class="eb-ic" /> {t(runButtonLabel(props.info))}
            </button>
            <button
              class="edit-btn edit-btn-primary editor-run-scope"
              aria-haspopup="menu"
              aria-label={t("editor.scopeMenu")}
              title={t("editor.scopeMenu")}
              onClick={scopeMenu}
            >
              <Icon name="chevron-down" size={12} />
            </button>
          </span>
        }
      >
        <button
          class="edit-btn editor-stop is-running"
          disabled={!!props.stopBlocked}
          title={props.stopBlocked ?? t("editor.stopTitle")}
          onClick={() => props.onStop()}
        >
          <Icon name="stop" size={14} class="eb-ic" /> {t("editor.stop")}
        </button>
      </Show>
      <span class="toolbar-sep" aria-hidden="true" />
      <button class="edit-btn" title={t("editor.formatTitle", { keys: keys("Mod+Shift+F")! })} onClick={() => props.onFormat()}>
        <Icon name="format" size={14} class="eb-ic" /> {t("editor.format")}
      </button>
      <Show when={props.tx}>
        <span class="toolbar-sep" aria-hidden="true" />
        {props.tx}
      </Show>
      <span class="toolbar-spacer" />
      <button
        class="edit-btn"
        aria-haspopup="menu"
        aria-label={t("editor.moreAria")}
        title={t("editor.moreAria")}
        onClick={(e) => openContextMenu(e, props.moreItems(e))}
      >
        {t("editor.more")} <Icon name="more" size={14} class="eb-ic" />
      </button>
    </div>
  );
}
