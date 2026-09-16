import { For, Show, createMemo, createSignal } from "solid-js";
import { driverSchema, engineMonogram, type Connection } from "../utils/connections";
import { searchGroups } from "../utils/connectionSearch";
import { t } from "../utils/i18n";

// Opening a saved connection (issue #525). The bar lists what is already open;
// this is how another one is found and opened. It used to be the whole manager
// crammed into a 280px popover — <details> per group, CRUD, import/export —
// which meant finding one connection among thirty was a matter of folding and
// unfolding groups by hand.
//
// Presentational: the filtering is pure (utils/connectionSearch) and every
// action belongs to the workspace.
export function ConnectionSearch(props: {
  connections: Connection[];
  /** Ids of the connections already open: picking one only focuses it. */
  openIds: string[];
  /** Non-null while a connection is being opened; the list waits rather than
      starting a second one. */
  connectingId: string | null;
  onPick: (c: Connection) => void;
  onNew: () => void;
  onImport: () => void;
  onManage: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = createSignal("");
  const [highlight, setHighlight] = createSignal(0);

  const labelOf = (driver: string) => driverSchema(driver)?.label ?? driver;
  const groups = createMemo(() =>
    searchGroups(props.connections, query(), props.openIds, labelOf),
  );
  /** The hits as one flat list, which is what the arrow keys walk. */
  const flat = createMemo(() => groups().flatMap((g) => g.hits));

  const clampedHighlight = () => Math.min(highlight(), Math.max(flat().length - 1, 0));
  const pick = (c: Connection) => {
    props.onPick(c);
    props.onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = flat().length;
      if (n === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setHighlight((h) => (Math.min(h, n - 1) + step + n) % n);
      return;
    }
    if (e.key === "Enter") {
      const hit = flat()[clampedHighlight()];
      if (hit) {
        e.preventDefault();
        pick(hit.conn);
      }
    }
  };

  return (
    <div class="connsearch" role="dialog" aria-label={t("connsearch.label")} onKeyDown={onKeyDown}>
      <div class="connsearch-field">
        <input
          class="connsearch-input"
          type="search"
          /* Focused on open: the whole point is to type straight away. `autofocus`
             does nothing on an element inserted after parsing (the lesson of
             #338), so the ref focuses it. */
          ref={(el) => queueMicrotask(() => el.focus())}
          placeholder={t("connsearch.placeholder")}
          aria-label={t("connsearch.placeholder")}
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setHighlight(0);
          }}
        />
      </div>

      <div class="connsearch-results">
        <Show
          when={flat().length > 0}
          fallback={
            <p class="connsearch-empty">
              {props.connections.length === 0 ? t("conn.empty") : t("connsearch.noMatch")}
            </p>
          }
        >
          <For each={groups()}>
            {(group) => (
              <>
                <Show when={group.name}>
                  <p class="connsearch-group">{group.name}</p>
                </Show>
                <ul class="connsearch-list">
                  <For each={group.hits}>
                    {(hit) => {
                      const index = () => flat().findIndex((h) => h.conn.id === hit.conn.id);
                      return (
                        <li>
                          <button
                            class="connsearch-hit"
                            classList={{ "is-highlighted": index() === clampedHighlight() }}
                            disabled={props.connectingId !== null}
                            title={hit.isOpen ? t("conn.focus") : t("conn.connect")}
                            onMouseEnter={() => setHighlight(index())}
                            onClick={() => pick(hit.conn)}
                          >
                            <Show when={hit.conn.color}>
                              <span
                                class="conn-color"
                                style={{ background: hit.conn.color }}
                                aria-hidden="true"
                              />
                            </Show>
                            <span class="connbar-mono" aria-hidden="true">
                              {engineMonogram(hit.conn.driver)}
                            </span>
                            <span class="connsearch-text">
                              <span class="connsearch-name">{hit.conn.name}</span>
                              <span class="connbar-sub">
                                {labelOf(hit.conn.driver)}
                                {hit.target ? ` · ${hit.target}` : ""}
                              </span>
                            </span>
                            <Show when={hit.isOpen}>
                              <span class="connsearch-open">{t("connsearch.alreadyOpen")}</span>
                            </Show>
                          </button>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </>
            )}
          </For>
        </Show>
      </div>

      <div class="connsearch-foot">
        <button class="conn-io-btn" onClick={() => props.onNew()}>
          + {t("conn.new")}
        </button>
        <button class="conn-io-btn" onClick={() => props.onImport()}>
          {t("conn.import")}
        </button>
        <span class="toolbar-spacer" />
        <button class="conn-io-btn" onClick={() => props.onManage()}>
          {t("connsearch.manage")}
        </button>
      </div>
    </div>
  );
}
