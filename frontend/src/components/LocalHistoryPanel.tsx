import { Dropdown } from "./Dropdown";
import { For, Show, createMemo, createSignal } from "solid-js";
import { Panel } from "./Panel";
import { t } from "../utils/i18n";
import { currentOs, orderActions } from "../utils/dialog";
import { diffLines, diffSummary, sideBySide } from "../utils/lineDiff";
import { groupByDay } from "../utils/history";
import { countText } from "../utils/confirmText";
import type { TabHistory } from "../utils/localHistory";

// Local history of the editor tabs (issue #674), opened as a tool tab from the
// tab's or the editor's context menu. Lists every tab that has versions — closed
// ones included, so their text can be recovered — with each version's time,
// reason and size, the diff between the picked version and the tab's current
// text, and Restore. Recording and retention are pure (utils/localHistory); the
// workspace owns the store and does the restoring.
// P6 (prototype LocalHistory): versions grouped by day, a summary of what the
// picked version changes, and the diff side by side (version | now).
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
  const rows = createMemo(() => {
    const d = diff();
    return d ? sideBySide(d) : null;
  });
  const summary = createMemo(() => {
    const d = diff();
    return d ? diffSummary(d) : null;
  });
  const days = createMemo(() =>
    groupByDay(
      (doc()?.versions ?? []).map((v, i) => ({ ...v, i })),
      Date.now(),
    ),
  );

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
          {(_doc) => (
            <div class="lhist-body">
              <ul class="history-list lhist-versions" aria-label={t("lhist.versions")}>
                <For each={days()}>
                  {(g) => (
                    <>
                      <li class="history-day" role="presentation">
                        {g.day === "today"
                          ? t("hist.today")
                          : g.day === "yesterday"
                            ? t("hist.yesterday")
                            : new Date(g.entries[0].ts).toLocaleDateString()}
                      </li>
                <For each={g.entries}>
                  {(v) => (
                    <li class="history-item">
                      <button
                        class={`history-run ${v.i === index() ? "active" : ""}`}
                        aria-pressed={v.i === index()}
                        onClick={() => setIndex(v.i)}
                      >
                        <span>{new Date(v.ts).toLocaleTimeString()}</span>
                        <span class="history-meta">
                          {t(`lhist.reason.${v.reason}`)} ·{" "}
                          {t("lhist.size", { n: v.sql.length.toLocaleString() })}
                        </span>
                      </button>
                    </li>
                  )}
                </For>
                    </>
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
                    {(_lines) => (
                      <>
                        <Show when={summary()}>
                          {(sm) => (
                            <p class="lhist-summary">
                              {countText("lhist.added", sm().added)} · {countText("lhist.removed", sm().removed)}
                            </p>
                          )}
                        </Show>
                        <div class="lhist-sides" role="table" aria-label={t("lhist.diffAria")}>
                          <div class="lhist-row lhist-head" role="row">
                            <span role="columnheader">{t("lhist.colVersion")}</span>
                            <span role="columnheader">{isOpen() ? t("lhist.colNow") : t("lhist.colLast")}</span>
                          </div>
                          <For each={rows()!}>
                            {(r) => (
                              <div class="lhist-row" role="row">
                                <span role="cell" class={`lhist-cell lhist-${r.left?.kind ?? "blank"}`}>
                                  <span class="lhist-no">{r.left?.no ?? ""}</span>
                                  {r.left?.text ?? ""}
                                </span>
                                <span role="cell" class={`lhist-cell lhist-${r.right?.kind ?? "blank"}`}>
                                  <span class="lhist-no">{r.right?.no ?? ""}</span>
                                  {r.right?.text ?? ""}
                                </span>
                              </div>
                            )}
                          </For>
                        </div>
                      </>
                    )}
                  </Show>
                </Show>
              </div>
            </div>
          )}
        </Show>
      </Show>

      {/* The action row in the OS order (#692): Restore is the primary. */}
      <div class="panel-foot">
        <span class="dlg-actions">
          {orderActions(currentOs(), [
            <button
              class="btn-primary"
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
            </button>,
            <button
              class="btn"
              disabled={!version()}
              onClick={() => {
                const v = version();
                if (v) props.onOpenCopy(doc()?.title ?? "", v.sql);
              }}
            >
              {t("lhist.openCopy")}
            </button>,
          ])}
        </span>
      </div>
    </Panel>
  );
}
