import { Dropdown } from "./Dropdown";
import { For, Show, createMemo, createSignal } from "solid-js";
import { Panel } from "./Panel";
import { t } from "../utils/i18n";
import { diffLines } from "../utils/lineDiff";
import type { TabHistory } from "../utils/localHistory";

// Local history of the editor tabs (issue #674), opened as a tool tab from the
// tab's or the editor's context menu. Lists every tab that has versions — closed
// ones included, so their text can be recovered — with each version's time,
// reason and size, the diff between the picked version and the tab's current
// text, and Restore. Recording and retention are pure (utils/localHistory); the
// workspace owns the store and does the restoring.
export function LocalHistoryPanel(props: {
  docs: TabHistory[];
  /** The tab the panel was opened for; selected first. */
  tabId: number;
  /** The text an OPEN tab holds now; undefined when the tab is closed. */
  currentSql: (tabId: number) => string | undefined;
  /** Replace an open tab's text with `sql` (recorded as a version by the caller). */
  onRestore: (tabId: number, sql: string) => void;
  /** Open `sql` in a new query tab (how a closed tab's text comes back). */
  onOpenCopy: (title: string, sql: string) => void;
  onClose: () => void;
}) {
  const [docId, setDocId] = createSignal(props.tabId);
  const [index, setIndex] = createSignal(0);
  const doc = createMemo(() => props.docs.find((d) => d.tabId === docId()));
  const version = createMemo(() => doc()?.versions[index()] ?? doc()?.versions[0]);
  const current = () => props.currentSql(docId());
  const isOpen = () => current() !== undefined;
  // A closed tab has no "current" text: compare against its last version.
  const compareTo = () => current() ?? doc()?.versions[0]?.sql ?? "";
  const diff = createMemo(() => {
    const v = version();
    return v ? diffLines(v.sql, compareTo()) : [];
  });
  const identical = () => version()?.sql === compareTo();

  const pickDoc = (id: number) => {
    setDocId(id);
    setIndex(0);
  };

  return (
    <Panel title={t("lhist.title")} class="local-history" onClose={props.onClose}>
      <h2>{t("lhist.title")}</h2>
      <Show
        when={props.docs.length > 0}
        fallback={<p class="history-empty">{t("lhist.none")}</p>}
      >
        <div class="history-controls">
          <Dropdown
            class="history-engine"
            aria-label={t("lhist.docLabel")}
            value={String(docId())}
            options={[
              ...(doc() ? [] : [{ value: String(docId()), label: t("lhist.thisTab") }]),
              ...props.docs.map((d) => ({
                value: String(d.tabId),
                label:
                  props.currentSql(d.tabId) === undefined
                    ? t("lhist.closedDoc", { title: d.title })
                    : d.title,
              })),
            ]}
            onChange={(v) => pickDoc(Number(v))}
          />
        </div>
        <Show
          when={doc()}
          fallback={<p class="history-empty">{t("lhist.noVersions")}</p>}
        >
          {(d) => (
            <div class="lhist-body">
              <ul class="history-list lhist-versions" aria-label={t("lhist.versions")}>
                <For each={d().versions}>
                  {(v, i) => (
                    <li class="history-item">
                      <button
                        class={`history-run ${i() === index() ? "active" : ""}`}
                        aria-pressed={i() === index()}
                        onClick={() => setIndex(i())}
                      >
                        <span>{new Date(v.ts).toLocaleString()}</span>
                        <span class="history-meta">
                          {t(`lhist.reason.${v.reason}`)} ·{" "}
                          {t("lhist.size", { n: v.sql.length.toLocaleString() })}
                        </span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
              <div class="lhist-diff">
                <p class="history-meta">
                  {isOpen() ? t("lhist.diffLegend") : t("lhist.diffLegendClosed")}
                </p>
                <Show
                  when={!identical()}
                  fallback={<p class="history-empty">{t("lhist.identical")}</p>}
                >
                  <Show
                    when={diff()}
                    fallback={
                      <>
                        <p class="history-meta">{t("lhist.diffTooBig")}</p>
                        <pre class="lhist-lines">{version()?.sql}</pre>
                      </>
                    }
                  >
                    {(lines) => (
                      <pre class="lhist-lines">
                        <For each={lines()}>
                          {(l) => (
                            <div class={`lhist-line lhist-${l.kind}`}>
                              {l.kind === "add" ? "+ " : l.kind === "del" ? "− " : "  "}
                              {l.text}
                            </div>
                          )}
                        </For>
                      </pre>
                    )}
                  </Show>
                </Show>
              </div>
            </div>
          )}
        </Show>
      </Show>

      <div class="modal-actions">
        <button
          disabled={!version()}
          onClick={() => {
            const v = version();
            if (v) props.onOpenCopy(doc()?.title ?? "", v.sql);
          }}
        >
          {t("lhist.openCopy")}
        </button>
        <button
          class="primary"
          disabled={!version() || !isOpen() || identical()}
          title={isOpen() ? undefined : t("lhist.closedHint")}
          onClick={() => {
            const v = version();
            if (!v) return;
            props.onRestore(docId(), v.sql);
            // The restore is now the newest version; stay on it, not on
            // whatever slid into the old position.
            setIndex(0);
          }}
        >
          {t("lhist.restore")}
        </button>
      </div>
    </Panel>
  );
}
