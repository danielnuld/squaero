import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { withWriteConsent } from "../utils/transport";
import { createStore } from "solid-js/store";
import { schemaDescribe } from "../utils/schema";
import { rowInsert, txBegin, txCommit, txRollback } from "../utils/edit";
import { errorText } from "../utils/errors";
import { runQuery } from "../utils/query";
import {
  defaultGen,
  generateRows,
  makeRng,
  clampCount,
  maxSql,
  nextSequenceStart,
  GEN_KINDS,
  TEMPLATE_TOKENS,
  type ColumnGen,
  type GenKind,
} from "../utils/dataGen";
import { Panel } from "./Panel";
import { t } from "../utils/i18n";
import { Dropdown } from "./Dropdown";
import { RowErrorPolicy, Wizard, WizardField, WizardSummary } from "./Wizard";
import { countText } from "../utils/confirmText";
import { runImport, type ErrorPolicy, type ImportError, type ImportOps, type ImportSummary } from "../utils/importers";
import { RunErrors, RunProgress } from "./RunProgress";
import { TablePreview } from "./TablePreview";
import { formatElapsed } from "../utils/duration";

const PREVIEW_ROWS = 5;
const PREVIEW_SEED = 0x9e3779b9; // stable preview independent of the real run

/**
 * Test-data generator (issue #147): pick a per-column strategy and a row count,
 * preview a deterministic sample, and insert the generated rows into the target
 * table inside a transaction (client-side, reusing the row.insert + tx.* path).
 * The generation logic is the pure helpers in utils/dataGen.ts; this component is
 * the modal that fetches the columns, drives the strategies and applies them.
 */
export function DataGenerator(props: {
  connId: string;
  target: { table: string; db?: string; schema?: string };
  /** The connection's engine: quotes the MAX(pk) query. */
  engine?: string;
  onClose: () => void;
  onGenerated?: () => void;
}) {
  const [gens, setGens] = createStore<ColumnGen[]>([]);
  const [count, setCount] = createSignal(10);
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [summary, setSummary] = createSignal<(ImportSummary & { ms: number }) | null>(null);
  /** The run in flight, for the progress view. */
  const [running, setRunning] = createSignal<{ startedAt: number; done: number; total: number; errors: ImportError[] } | null>(null);
  /** «Otra muestra» draws the preview from the next seed. */
  const [seed, setSeed] = createSignal(PREVIEW_SEED);
  let ctl: AbortController | null = null;
  onCleanup(() => ctl?.abort());
  // Generating into a table with data hits its keys more often than an import
  // does, so the safe default is all or nothing.
  const [policy, setPolicy] = createSignal<ErrorPolicy>("abort");

  onMount(async () => {
    try {
      const desc = await schemaDescribe(
        props.connId,
        props.target.table,
        props.target.db,
        props.target.schema,
      );
      const idx = (n: string) => desc.columns.findIndex((c) => c.name === n);
      const ni = idx("name");
      const ti = idx("type");
      const pi = idx("pk");
      const cols = desc.rows
        .map((r) => ({
          name: ni >= 0 ? r[ni] : null,
          type: (ti >= 0 ? r[ti] : null) ?? "text",
          pk: pi >= 0 && (r[pi] ?? "0") !== "0",
        }))
        .filter((c): c is { name: string; type: string; pk: boolean } => !!c.name);
      const defaults = cols.map((c) => defaultGen(c.name, c.type, c.pk));
      // A key sequence starts after the rows already there (audit A-29), not
      // at 1 where the first insert would collide. Unreadable: it stays at 1.
      for (const g of defaults) {
        if (g.kind !== "sequence") continue;
        try {
          const r = await runQuery(props.connId, maxSql(g.column, props.target, props.engine ?? "sqlite"), 1);
          g.seqStart = nextSequenceStart(r.rows[0]?.[0]);
        } catch {
          /* no MAX: the start stays editable at 1 */
        }
      }
      setGens(defaults);
      setLoaded(true);
    } catch (err) {
      setError(errorText(err));
    }
  });

  const patch = (i: number, key: keyof ColumnGen, value: string | number) =>
    setGens(i, key as keyof ColumnGen, value as never);
  const patchNum = (i: number, key: keyof ColumnGen, value: string) =>
    patch(i, key, Number(value));

  // Deterministic preview (fixed seed) so the sample is stable as the form is
  // edited; the real run uses Math.random for varied data.
  const preview = createMemo(() =>
    generateRows([...gens], Math.min(clampCount(count()), PREVIEW_ROWS), makeRng(seed())),
  );
  const activeCols = createMemo(() => gens.filter((g) => g.kind !== "skip").map((g) => g.column));

  const generate = async () => {
    const n = clampCount(count());
    const cols = activeCols();
    if (cols.length === 0) {
      setError(t("dg.allSkipped"));
      return;
    }
    // The generated rows go through the import path: one transaction, and the
    // same «si una fila falla» choice the import wizard offers.
    const rows = generateRows([...gens], n, Math.random);
    const table = { headers: cols, rows: rows.map((r) => cols.map((c) => r[c] ?? null)) };
    const mapping = Object.fromEntries(cols.map((c) => [c, c]));
    const ops: ImportOps = {
      begin: () => txBegin(props.connId),
      commit: () => txCommit(props.connId),
      rollback: () => txRollback(props.connId),
      insert: async (values) => {
        await rowInsert(props.connId, props.target, values, false);
      },
    };
    const run = new AbortController();
    ctl = run;
    const startedAt = Date.now();
    setRunning({ startedAt, done: 0, total: rows.length, errors: [] });
    setError(null);
    try {
      const result = await withWriteConsent(
        props.connId,
        [`INSERT INTO ${props.target.table} … (${rows.length})`],
        () =>
          runImport(table, mapping, policy(), ops, {
            onProgress: (done) => setRunning((r) => r && { ...r, done }),
            onError: (e) => setRunning((r) => r && { ...r, errors: [...r.errors, e] }),
            signal: run.signal,
          }),
      );
      setSummary({ ...result, ms: Date.now() - startedAt });
      if (result.inserted > 0) props.onGenerated?.();
    } catch (err) {
      setError(run.signal.aborted ? t("dg.cancelled") : errorText(err));
    } finally {
      if (ctl === run) ctl = null;
      setRunning(null);
    }
  };
  const errorsOf = (errs: ImportError[]) =>
    errs.map((e) => ({ where: t("imp.rowN", { n: e.row + 1 }), message: e.message }));
  const policyText = () => (policy() === "skip" ? t("dg.policySkipNote") : t("imp.policyAbortNote"));

  return (
    <Panel title={t("dg.title")} wide onClose={props.onClose} dirty={!!running()}>
      <Wizard
        title={t("dg.heading", { name: props.target.table })}
        subtitle={t("dg.subtitle")}
        steps={[t("dg.step.configure"), t("dg.step.result")]}
        step={summary() || running() ? 1 : 0}
        error={error()}
        primary={
          summary() || running()
            ? undefined
            : {
                label: countText("dg.generateN", clampCount(count())),
                onClick: () => void generate(),
                disabled: !loaded() || activeCols().length === 0,
              }
        }
        cancelLabel={running() ? t("dg.cancelRun") : summary() ? t("common.close") : undefined}
        onCancel={running() ? () => ctl?.abort() : props.onClose}
      >
        <Show when={running()}>
          {(r) => (
            <RunProgress
              title={t("dg.running", { table: props.target.table })}
              done={r().done}
              total={r().total}
              unit="rows"
              startedAt={r().startedAt}
              counts={[
                { label: countText("imp.insertedN", r().done - r().errors.length) },
                ...(r().errors.length > 0
                  ? [{ label: countText("imp.failedN", r().errors.length), tone: "error" as const }]
                  : []),
              ]}
              errors={errorsOf(r().errors)}
              errorPolicy={policyText()}
              note={t("imp.cancelNote", { table: props.target.table })}
            />
          )}
        </Show>
        <Show when={summary()}>
          {(sum) => (
            <>
              <p role="status">
                {sum().aborted
                  ? t("imp.abortedResult", { table: props.target.table })
                  : t("dg.doneResult", { table: props.target.table })}
              </p>
              <WizardSummary
                stats={[
                  { value: sum().inserted, label: t("dg.stat.inserted") },
                  { value: sum().errors.length, label: t("imp.stat.failed"), error: sum().errors.length > 0 },
                  { value: formatElapsed(sum().ms), label: t("imp.stat.time") },
                ]}
              />
              <RunErrors
                errors={errorsOf(sum().errors)}
                title={countText("imp.failedRows", sum().errors.length)}
                policy={sum().aborted ? t("imp.policyAbortNote") : t("dg.policySkipNote")}
              />
            </>
          )}
        </Show>
        <Show when={!summary() && !running()}>
          <div class="wiz-form">
            <WizardField label={t("dg.rowCount")} help={t("dg.rowCountHelp")}>
              <input
                type="number"
                min="1"
                max="10000"
                value={count()}
                onInput={(e) => setCount(Number(e.currentTarget.value))}
              />
            </WizardField>
            <RowErrorPolicy name="dgpolicy" value={policy()} onChange={setPolicy} />
          </div>

          <Show when={loaded()} fallback={<p class="grid-empty">{t("dg.loadingColumns")}</p>}>
            <table class="td-table">
              <thead>
                <tr>
                  <th>{t("dg.column")}</th>
                  <th>{t("dg.type")}</th>
                  <th>{t("dg.strategy")}</th>
                  <th>{t("dg.params")}</th>
                </tr>
              </thead>
              <tbody>
                <For each={gens}>
                  {(g, i) => (
                    <tr>
                      <td>{g.column}</td>
                      <td class="col-type">{g.type}</td>
                      <td>
                        <Dropdown
                          value={g.kind}
                          options={GEN_KINDS.map((k) => ({ value: k.kind, label: t(k.label) }))}
                          onChange={(v) => patch(i(), "kind", v as GenKind)}
                          class="map-select"
                        />
                      </td>
                      <td>
                        <Show when={g.kind === "sequence"}>
                          <span class="dg-params">
                            <label>{t("dg.start")} <input class="td-in dg-num" type="number" value={g.seqStart} onInput={(e) => patchNum(i(), "seqStart", e.currentTarget.value)} /></label>
                            <label>{t("dg.step")} <input class="td-in dg-num" type="number" value={g.seqStep} onInput={(e) => patchNum(i(), "seqStep", e.currentTarget.value)} /></label>
                          </span>
                        </Show>
                        <Show when={g.kind === "number"}>
                          <span class="dg-params">
                            <label>{t("dg.min")} <input class="td-in dg-num" type="number" value={g.min} onInput={(e) => patchNum(i(), "min", e.currentTarget.value)} /></label>
                            <label>{t("dg.max")} <input class="td-in dg-num" type="number" value={g.max} onInput={(e) => patchNum(i(), "max", e.currentTarget.value)} /></label>
                            <label>{t("dg.decimals")} <input class="td-in dg-num" type="number" value={g.decimals} onInput={(e) => patchNum(i(), "decimals", e.currentTarget.value)} /></label>
                          </span>
                        </Show>
                        <Show when={g.kind === "date"}>
                          <span class="dg-params">
                            <label>{t("dg.from")} <input class="td-in" type="date" value={g.from} onInput={(e) => patch(i(), "from", e.currentTarget.value)} /></label>
                            <label>{t("dg.to")} <input class="td-in" type="date" value={g.to} onInput={(e) => patch(i(), "to", e.currentTarget.value)} /></label>
                          </span>
                        </Show>
                        <Show when={g.kind === "list"}>
                          <input class="td-in dg-wide" placeholder={t("dg.listPlaceholder")} value={g.list} onInput={(e) => patch(i(), "list", e.currentTarget.value)} />
                        </Show>
                        <Show when={g.kind === "text"}>
                          <input
                            class="td-in dg-wide"
                            aria-label={t("dg.templateFor", { name: g.column })}
                            title={t("dg.templateHelp", { tokens: TEMPLATE_TOKENS.join(" ") })}
                            value={g.template}
                            onInput={(e) => patch(i(), "template", e.currentTarget.value)}
                          />
                        </Show>
                        <Show when={g.kind === "fixed"}>
                          <input class="td-in dg-wide" placeholder={t("dg.fixedPlaceholder")} value={g.fixed} onInput={(e) => patch(i(), "fixed", e.currentTarget.value)} />
                        </Show>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>

            <p class="help">{t("dg.templateHelp", { tokens: TEMPLATE_TOKENS.join(" ") })}</p>
            <TablePreview
              title={t("dg.preview", { shown: preview().length, total: clampCount(count()) })}
              table={{ headers: activeCols(), rows: preview().map((r) => activeCols().map((c) => r[c] ?? null)) }}
            />
            <div>
              <button type="button" class="btn" onClick={() => setSeed((s) => s + 1)}>
                {t("dg.anotherSample")}
              </button>
            </div>
          </Show>
        </Show>
      </Wizard>
    </Panel>
  );
}
