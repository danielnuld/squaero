import { Show, type JSX } from "solid-js";
import { openContextMenu, type MenuItem } from "../utils/contextMenu";
import { runButtonLabel, runChoices, type RunInfo, type RunScope } from "../utils/runScope";
import { displayKeys } from "../utils/shortcuts";
import { t } from "../utils/i18n";
import { Icon } from "./icons";

// The SQL editor's run toolbar (issue #691, M14 R-01/R-02/R-04/R-19/R-20):
//
//   [● conexión · base ▾] [▶ Ejecutar sentencia | ▾] [■] | Formatear | Auto/Manual | ··· | Más
//
// The connection selector first, so what the query runs against is never out of
// sight. The primary button NAMES what it runs (the statement under the cursor,
// or the selection) and its menu offers the three scopes with what each covers
// now. «Detener» is always there, enabled only while something runs. Everything
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
  /** Shown at the end of the bar instead of nothing (the snippet name field). */
  children?: JSX.Element;
}) {
  const keys = (k: string) => (k ? displayKeys(k, props.isMac) : undefined);

  const scopeMenu = (e: MouseEvent) =>
    openContextMenu(
      e,
      runChoices(props.info).map((c) => ({
        label: t(c.label),
        hint: [t(c.hint.key, c.hint.params), keys(c.keys)].filter(Boolean).join(" · "),
        disabled: c.disabled,
        action: () => props.onRun(c.scope),
      })),
    );

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
      <span class="editor-run">
        <button
          class="edit-btn edit-btn-primary editor-run-main"
          disabled={props.running}
          title={props.info.hasSelection ? t("editor.runSelectionTitle") : t("editor.runStatementTitle")}
          onClick={() => props.onRun()}
        >
          <Icon name="play" size={14} class="eb-ic" /> {t(runButtonLabel(props.info))}
        </button>
        <button
          class="edit-btn edit-btn-primary editor-run-scope"
          disabled={props.running}
          aria-haspopup="menu"
          aria-label={t("editor.scopeMenu")}
          title={t("editor.scopeMenu")}
          onClick={scopeMenu}
        >
          <Icon name="chevron-down" size={12} />
        </button>
      </span>
      <button
        class="edit-btn edit-btn-icon editor-stop"
        classList={{ "is-running": props.running }}
        disabled={!props.running || !!props.stopBlocked}
        aria-label={props.running ? t("editor.stop") : t("editor.stopIdle")}
        title={props.running ? (props.stopBlocked ?? t("editor.stopTitle")) : t("editor.stopIdle")}
        onClick={() => props.onStop()}
      >
        <Icon name="stop" size={14} />
      </button>
      <span class="toolbar-sep" aria-hidden="true" />
      <button class="edit-btn" title={t("editor.formatTitle")} onClick={() => props.onFormat()}>
        <Icon name="format" size={14} class="eb-ic" /> {t("editor.format")}
      </button>
      <Show when={props.tx}>
        <span class="toolbar-sep" aria-hidden="true" />
        {props.tx}
      </Show>
      <span class="toolbar-spacer" />
      {props.children}
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
