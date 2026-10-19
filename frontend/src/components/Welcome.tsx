import { For, Show } from "solid-js";
import { BrandMark } from "./Brand";
import { SafeChip } from "./ConnChips";
import { countText } from "../utils/confirmText";
import { Icon, type IconName } from "./icons";
import { t, locale } from "../utils/i18n";
import { timeAgo } from "../utils/history";
import { connectionTarget, driverSchema, engineMonogram, type Connection } from "../utils/connections";
import { SHORTCUTS, formatKeys, shortcutText, type Shortcut } from "../utils/shortcuts";
import type { TreeNode } from "../utils/tree";

// What the workspace shows with no tab open (issue #694): with nothing
// connected, the welcome — how to start, the recent connections and a few
// shortcuts; with a connection, a home for it — open a table, write a query or
// find an object. Presentational: App passes the data and the same handlers
// its menus and shortcuts use.

const TIP_IDS: Shortcut["id"][] = ["command-palette", "new-tab", "run-query", "run-script", "object-palette"];
const tipsOf = (shortcuts?: readonly Shortcut[]) =>
  TIP_IDS.map((id) => (shortcuts ?? SHORTCUTS).find((s) => s.id === id)).filter(
    (s): s is Shortcut => !!s,
  );
const keyOf = (id: Shortcut["id"], isMac: boolean, shortcuts?: readonly Shortcut[]) => {
  const s = (shortcuts ?? SHORTCUTS).find((x) => x.id === id);
  return s ? formatKeys(s.keys, isMac ? "macos" : "windows") : "";
};

function StartAction(props: {
  icon: IconName;
  title: string;
  sub: string;
  primary?: boolean;
  kbd?: string;
  onClick: () => void;
}) {
  return (
    <button
      class="welcome-action"
      classList={{ "welcome-action-primary": !!props.primary }}
      onClick={() => props.onClick()}
    >
      <span class="welcome-action-icon" aria-hidden="true">
        <Icon name={props.icon} size={16} />
      </span>
      <span class="welcome-action-text">
        <span class="welcome-action-title">{props.title}</span>
        <span class="welcome-action-sub">{props.sub}</span>
      </span>
      <Show when={props.kbd}>
        <kbd>{props.kbd}</kbd>
      </Show>
    </button>
  );
}

export function Welcome(props: {
  recent: { conn: Connection; at: number | null }[];
  connectingId: string | null;
  isMac: boolean;
  shortcuts?: readonly Shortcut[];
  onConnect: (c: Connection) => void;
  onNew: () => void;
  onOpenFile: () => void;
  onImport: () => void;
  onShowAll: () => void;
  onShortcuts: () => void;
  /** Injected in tests; Date.now otherwise. */
  now?: () => number;
}) {
  const now = () => (props.now ?? Date.now)();
  return (
    <div class="welcome">
      <div class="welcome-main">
        <div class="welcome-head">
          <BrandMark size={44} />
          <div>
            <h1>Squaero</h1>
            <p>{t("welcome.lead")}</p>
          </div>
        </div>

        <section class="welcome-section" aria-labelledby="welcome-start">
          <h2 id="welcome-start" class="welcome-label">
            {t("welcome.start")}
          </h2>
          <StartAction
            icon="plus"
            primary
            title={t("welcome.new")}
            sub={t("welcome.newSub")}
            onClick={props.onNew}
          />
          <StartAction
            icon="open"
            title={t("welcome.openFile")}
            sub={t("welcome.openFileSub")}
            onClick={props.onOpenFile}
          />
          <StartAction
            icon="import"
            title={t("welcome.import")}
            sub={t("welcome.importSub")}
            onClick={props.onImport}
          />
        </section>

        <Show when={props.recent.length > 0}>
          <section class="welcome-section" aria-labelledby="welcome-recent">
            <div class="welcome-label-row">
              <h2 id="welcome-recent" class="welcome-label">
                {t("welcome.recent")}
              </h2>
              <button class="welcome-link" onClick={() => props.onShowAll()}>
                {t("welcome.showAll")}
              </button>
            </div>
            <ul class="welcome-recent">
              <For each={props.recent}>
                {(r) => {
                  const engine = () => driverSchema(r.conn.driver)?.label ?? r.conn.driver;
                  const target = () => connectionTarget(r.conn);
                  return (
                    <li>
                      <button
                        class="welcome-conn"
                        style={r.conn.color ? { "--conn-accent": r.conn.color } : undefined}
                        title={t("welcome.connectTo", { name: r.conn.name })}
                        disabled={props.connectingId !== null}
                        aria-busy={props.connectingId === r.conn.id}
                        onClick={() => props.onConnect(r.conn)}
                      >
                        <span class="welcome-conn-bar" aria-hidden="true" />
                        <span class="welcome-conn-mono" aria-hidden="true">
                          {engineMonogram(r.conn.driver)}
                        </span>
                        <span class="welcome-conn-text">
                          <span class="welcome-conn-name">{r.conn.name}</span>
                          <span class="welcome-conn-sub">
                            {target() ? `${engine()} · ${target()}` : engine()}
                          </span>
                        </span>
                        <SafeChip mode={r.conn.safeMode} />
                        <span class="welcome-conn-when">
                          {r.at === null ? t("welcome.neverUsed") : timeAgo(r.at, now(), locale())}
                        </span>
                      </button>
                    </li>
                  );
                }}
              </For>
            </ul>
          </section>
        </Show>
      </div>

      <aside class="welcome-tips" aria-labelledby="welcome-tips">
        <h2 id="welcome-tips" class="welcome-label">
          {t("welcome.shortcuts")}
        </h2>
        <ul>
          <For each={tipsOf(props.shortcuts)}>
            {(s) => (
              <li>
                <kbd>{formatKeys(s.keys, props.isMac ? "macos" : "windows")}</kbd>
                <span>{shortcutText(s, props.isMac ? "macos" : "windows")}</span>
              </li>
            )}
          </For>
        </ul>
        <button class="welcome-link" onClick={() => props.onShortcuts()}>
          {t("welcome.allShortcuts", { keys: keyOf("toggle-help", props.isMac, props.shortcuts) })}
        </button>
      </aside>
    </div>
  );
}

const MAX_TABLES = 8;

export function ConnectedHome(props: {
  name: string;
  engine: string;
  color?: string;
  db?: string | null;
  recentTables: TreeNode[];
  isMac: boolean;
  shortcuts?: readonly Shortcut[];
  onNewQuery: () => void;
  onFindObject: () => void;
  onOpenTable: (node: TreeNode) => void;
  /** Rows per table, from the catalog (an estimate on most engines). */
  rowCounts?: Record<string, number>;
  /** The connection's places (ConnectedNoTab): absent ones are not drawn. */
  onObjectList?: () => void;
  onEr?: () => void;
  onDataSearch?: () => void;
  onNewTable?: () => void;
  onTools?: (e: MouseEvent) => void;
}) {
  const links = () =>
    [
      { label: "home.objectList", run: props.onObjectList },
      { label: "home.er", run: props.onEr },
      { label: "home.dataSearch", run: props.onDataSearch },
      { label: "home.newTable", run: props.onNewTable },
    ].filter((l): l is { label: string; run: () => void } => !!l.run);
  return (
    <div class="welcome welcome-home">
      <div class="welcome-main">
        <div class="welcome-home-title">
          <span
            class="welcome-home-dot"
            aria-hidden="true"
            style={props.color ? { "--conn-accent": props.color } : undefined}
          />
          <h1>{t("home.ready", { name: props.name })}</h1>
        </div>
        <p class="welcome-home-sub">
          {props.db ? `${props.engine} · ${props.db}. ` : `${props.engine}. `}
          {t("home.lead")}
        </p>
        <div class="welcome-home-actions">
          <button class="btn btn-primary" onClick={() => props.onNewQuery()}>
            {t("home.newQuery")}
            <kbd>{keyOf("new-tab", props.isMac, props.shortcuts)}</kbd>
          </button>
          <button class="btn" onClick={() => props.onFindObject()}>
            {t("home.findObject")}
            <kbd>{keyOf("object-palette", props.isMac, props.shortcuts)}</kbd>
          </button>
        </div>
        <Show when={props.recentTables.length > 0}>
          <section class="welcome-section" aria-labelledby="home-recent">
            <h2 id="home-recent" class="welcome-label">
              {t("home.recentTables")}
            </h2>
            <ul class="welcome-tables">
              <For each={props.recentTables.slice(0, MAX_TABLES)}>
                {(node) => (
                  <li>
                    <button
                      class="welcome-table"
                      title={t("empty.openTable", { name: node.label })}
                      onClick={() => props.onOpenTable(node)}
                    >
                      <Icon name={node.kind === "view" ? "view" : "table"} size={14} />
                      {node.label}
                      <Show when={props.rowCounts?.[node.label] !== undefined}>
                        <span class="welcome-table-rows">
                          {countText("tree.rows", props.rowCounts![node.label])}
                        </span>
                      </Show>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>
        <Show when={links().length > 0 || props.onTools}>
          <section class="welcome-section" aria-labelledby="home-places">
            <h2 id="home-places" class="welcome-label">
              {t("home.places")}
            </h2>
            <div class="welcome-home-links">
              <For each={links()}>
                {(l) => (
                  <button class="welcome-link" onClick={() => l.run()}>
                    {t(l.label)}
                  </button>
                )}
              </For>
              <Show when={props.onTools}>
                <button class="welcome-link" aria-haspopup="menu" onClick={(e) => props.onTools!(e)}>
                  {t("home.tools")}
                </button>
              </Show>
            </div>
          </section>
        </Show>
      </div>
    </div>
  );
}
