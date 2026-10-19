import { Segmented } from "./Segmented";
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { withWriteConsent } from "../utils/transport";
import { Panel } from "./Panel";
import { t } from "../utils/i18n";
import { schemaDescribe } from "../utils/schema";
import { rowInsert, txBegin, txCommit, txRollback } from "../utils/edit";
import { QueryError } from "../utils/query";
import {
  parseJson,
  parseCsv,
  parseClipboard,
  emptyAsNull,
  mapByName,
  hasMapping,
  runImport,
  detectEncoding,
  decodeBytes,
  detectDialect,
  detectDelimiter,
  targetColumns,
  DELIMITERS,
  QUOTES,
  ENCODINGS,
  type ColumnMapping,
  type CsvDialect,
  type ErrorPolicy,
  type ImportError,
  type ImportOps,
  type ImportSummary,
  type ParsedTable,
  type TargetColumn,
  type TextEncoding,
} from "../utils/importers";
import { openWorkbook, isXlsxName, type XlsxWorkbook } from "../utils/xlsxRead";
import { Dropdown } from "./Dropdown";
import { RowErrorPolicy, Wizard, WizardField, WizardSummary } from "./Wizard";
import { ColumnMapper } from "./ColumnMapper";
import { RunErrors, RunProgress } from "./RunProgress";
import { TablePreview } from "./TablePreview";
import { countText } from "../utils/confirmText";
import { formatElapsed } from "../utils/duration";

/** What the wizard says for each delimiter and encoding (catalog keys). */
const DELIM_KEY: Record<string, string> = { ",": "comma", ";": "semicolon", "\t": "tab", "|": "pipe" };
const ENC_LABEL: Record<TextEncoding, string> = {
  "utf-8": "UTF-8",
  "windows-1252": "Windows-1252",
  "utf-16le": "UTF-16 LE",
  "utf-16be": "UTF-16 BE",
};

/** A run in flight: what is done so far, for the progress view. */
interface Running {
  startedAt: number;
  done: number;
  total: number;
  errors: ImportError[];
}

/**
 * Import wizard (issues #31/#32, #692): pick a CSV/JSON/XLSX file or paste
 * rows, check the format it was read with (delimiter, quote, encoding, header
 * — detected, changeable), map its columns onto the target's with an example
 * of each value, and load the rows inside one transaction with determinate
 * progress, the errors as they happen and a Cancelar that rolls everything
 * back. The parsing, detection, mapping and apply are utils/importers.ts.
 */
export function ImportWizard(props: {
  connId: string;
  target: { table: string; db?: string; schema?: string };
  /** The target's engine: recognises SQLite's rowid key as autoincrement. */
  engine?: string;
  /**
   * Delimited text to start from instead of a file (issue #383): what was on
   * the clipboard when the user pasted over the grid. The wizard opens on its
   * clipboard tab with this already parsed and mapped — the preview and the
   * transactional apply are the same ones a file goes through, because pasting
   * into someone's database is not a thing to do with less ceremony than that.
   */
  initialText?: string;
  onClose: () => void;
  onImported?: () => void;
}) {
  const [targets, setTargets] = createSignal<TargetColumn[]>([]);
  const [parsed, setParsed] = createSignal<ParsedTable | null>(null);
  const [fileName, setFileName] = createSignal("");
  const [fileSize, setFileSize] = createSignal(0);
  /** A delimited file's bytes, kept so a change of encoding re-reads them. */
  const [bytes, setBytes] = createSignal<Uint8Array | null>(null);
  const [encoding, setEncoding] = createSignal<TextEncoding>("utf-8");
  const [dialect, setDialect] = createSignal<CsvDialect>({ delimiter: ",", quote: '"', header: true });
  const [editFormat, setEditFormat] = createSignal(false);
  const [mapping, setMapping] = createSignal<ColumnMapping>({});
  // XLSX workbooks carry multiple sheets; keep the opened workbook + the chosen
  // sheet so switching sheets re-reads without re-opening the file (issue #142).
  const [workbook, setWorkbook] = createSignal<XlsxWorkbook | null>(null);
  const [sheetName, setSheetName] = createSignal("");
  const [policy, setPolicy] = createSignal<ErrorPolicy>("skip");
  /** Where the rows come from: a file on disk, or delimited text pasted in. */
  const [source, setSource] = createSignal<"file" | "clipboard">(props.initialText ? "clipboard" : "file");
  const [pasted, setPasted] = createSignal(props.initialText ?? "");
  /** Delimited text has no NULL; the user says which empty cells are one. */
  const [blankIsNull, setBlankIsNull] = createSignal(true);
  const [running, setRunning] = createSignal<Running | null>(null);
  const [summary, setSummary] = createSignal<(ImportSummary & { ms: number }) | null>(null);
  const [stage, setStage] = createSignal<0 | 1>(0);
  const [error, setError] = createSignal<string | null>(null);

  let ctl: AbortController | null = null;
  onCleanup(() => ctl?.abort());

  onMount(async () => {
    try {
      const desc = await schemaDescribe(props.connId, props.target.table, props.target.db, props.target.schema);
      setTargets(targetColumns(desc, props.engine));
      // Text pasted in before the describe came back was mapped against an
      // empty column list; now that the columns are here, map it properly.
      const already = parsed();
      if (already) setMapping(mapByName(already.headers, targets()));
    } catch (err) {
      setError(err instanceof QueryError ? err.message : String(err));
    }
  });

  // Load a parsed table into the mapping UI (shared by every source).
  const useTable = (table: ParsedTable) => {
    setParsed(table);
    setMapping(mapByName(table.headers, targets()));
  };

  /** Re-read the pasted text. Cheap enough to redo on every keystroke. */
  const usePasted = (text: string) => {
    setPasted(text);
    setError(null);
    setSummary(null);
    if (text.trim() === "") {
      setParsed(null);
      return;
    }
    useTable(parseClipboard(text));
  };

  if (props.initialText) useTable(parseClipboard(props.initialText));

  /** What actually gets imported: the parsed rows, with the NULL rule applied. */
  const effective = (): ParsedTable | null => {
    const table = parsed();
    if (!table) return null;
    return source() === "clipboard" && blankIsNull() ? emptyAsNull(table) : table;
  };

  /** Re-read the kept bytes with the current encoding and dialect. */
  const reparse = () => {
    const b = bytes();
    if (!b) return;
    const d = dialect();
    useTable(parseCsv(decodeBytes(b, encoding()), d.delimiter, d.quote, d.header));
  };
  const changeDialect = (patch: Partial<CsvDialect>) => {
    setDialect((d) => ({ ...d, ...patch }));
    reparse();
  };
  const changeEncoding = (enc: TextEncoding) => {
    setEncoding(enc);
    reparse();
  };

  // Switch the active sheet of the opened workbook, re-reading it.
  const selectSheet = (name: string) => {
    const wb = workbook();
    if (!wb) return;
    setSheetName(name);
    useTable(wb.read(name));
  };

  const onFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setError(null);
    setSummary(null);
    setEditFormat(false);
    try {
      const raw = new Uint8Array(await file.arrayBuffer());
      setFileName(file.name);
      setFileSize(raw.length);
      setWorkbook(null);
      setSheetName("");
      setBytes(null);
      if (isXlsxName(file.name)) {
        const wb = openWorkbook(raw);
        if (wb.sheets.length === 0) throw new Error(t("imp.noSheets"));
        setWorkbook(wb);
        const first = wb.sheets[0].name;
        setSheetName(first);
        useTable(wb.read(first));
        return;
      }
      const enc = detectEncoding(raw);
      const text = decodeBytes(raw, enc);
      if (file.name.toLowerCase().endsWith(".json") || (!file.name.toLowerCase().endsWith(".csv") && text.trimStart().startsWith("["))) {
        useTable(parseJson(text));
        return;
      }
      setEncoding(enc);
      setDialect(detectDialect(text));
      setBytes(raw);
      reparse();
    } catch (err) {
      setParsed(null);
      setWorkbook(null);
      setBytes(null);
      setError(t("imp.readFailed", { message: err instanceof Error ? err.message : String(err) }));
    }
  };

  const formatText = () => {
    const d = dialect();
    return [
      "CSV",
      t(`imp.delim.${DELIM_KEY[d.delimiter]}`),
      ENC_LABEL[encoding()],
      d.header ? t("imp.withHeader") : t("imp.noHeader"),
    ].join(" · ");
  };
  const pastedDelimiter = () => {
    const text = pasted();
    const header = text.split(/\r?\n/, 1)[0] ?? "";
    return header.includes("\t") ? "\t" : detectDelimiter(text);
  };

  const runNow = async () => {
    const table = effective();
    if (!table || !hasMapping(mapping())) return;
    const run = new AbortController();
    ctl = run;
    const startedAt = Date.now();
    setRunning({ startedAt, done: 0, total: table.rows.length, errors: [] });
    setError(null);
    const ops: ImportOps = {
      begin: () => txBegin(props.connId),
      commit: () => txCommit(props.connId),
      rollback: () => txRollback(props.connId),
      insert: async (values) => {
        await rowInsert(props.connId, props.target, values, false);
      },
    };
    try {
      const result = await withWriteConsent(
        props.connId,
        [`INSERT INTO ${props.target.table} … (${table.rows.length})`],
        () =>
          runImport(table, mapping(), policy(), ops, {
            onProgress: (done) => setRunning((r) => r && { ...r, done }),
            onError: (e) => setRunning((r) => r && { ...r, errors: [...r.errors, e] }),
            signal: run.signal,
          }),
      );
      setSummary({ ...result, ms: Date.now() - startedAt });
      if (result.inserted > 0) props.onImported?.();
    } catch (err) {
      // Cancelled (rolled back), or a transaction-control failure (begin/commit).
      setError(run.signal.aborted ? t("imp.cancelled") : err instanceof QueryError ? err.message : String(err));
    } finally {
      if (ctl === run) ctl = null;
      setRunning(null);
    }
  };

  /** The step on screen: 0 where the rows come from, 1 columns, 2 import / the result. */
  const step = () => (summary() || running() ? 2 : stage());
  const rowCount = () => effective()?.rows.length ?? 0;
  const sourceName = () => (source() === "clipboard" ? t("imp.pastedSource") : fileName());
  const errorsOf = (errs: ImportError[]) =>
    errs.map((e) => ({ where: t("imp.rowN", { n: e.row + 1 }), message: e.message }));
  const policyText = () => (policy() === "skip" ? t("imp.policySkipNote") : t("imp.policyAbortNote"));

  return (
    <Panel wide onClose={props.onClose} dirty={!!running() || (!summary() && (!!parsed() || pasted().trim() !== ""))}>
      <Wizard
        title={t("imp.title", { name: props.target.table })}
        subtitle={
          step() === 0
            ? t("imp.subtitle", { n: targets().length })
            : countText("imp.fromSource", rowCount(), { source: sourceName() })
        }
        steps={[t("imp.step.source"), t("imp.step.columns"), t("imp.step.import")]}
        step={step()}
        error={error()}
        onBack={step() === 1 ? () => setStage(0) : undefined}
        primary={
          step() === 0
            ? { label: t("wiz.next"), onClick: () => setStage(1), disabled: !effective() }
            : step() === 1
              ? {
                  label: countText("imp.importN", rowCount()),
                  onClick: () => void runNow(),
                  disabled: !effective() || !hasMapping(mapping()),
                }
              : undefined
        }
        cancelLabel={running() ? t("imp.cancelRun") : step() === 2 ? t("common.close") : undefined}
        onCancel={running() ? () => ctl?.abort() : props.onClose}
      >
        <Show when={step() === 0}>
          <div class="wiz-form">
            <WizardField label={t("imp.targetTable")}>
              <span>{countText("imp.targetCols", targets().length, { table: props.target.table })}</span>
            </WizardField>
            <div class="wiz-row">
              <span class="wiz-label">{t("imp.sourceLabel")}</span>
              <span class="wiz-ctl">
                <Segmented
                  label={t("imp.sourceLabel")}
                  options={[
                    { value: "file" as const, label: t("imp.file") },
                    { value: "clipboard" as const, label: t("imp.clipboard") },
                  ]}
                  value={source()}
                  onChange={(v) => {
                    setSource(v);
                    if (v === "clipboard") usePasted(pasted());
                  }}
                />
              </span>
            </div>
            <Show when={source() === "file"}>
              <WizardField
                label={t("imp.filePick")}
                help={fileName() ? t("imp.fileChosen", { name: fileName(), kb: Math.max(1, Math.round(fileSize() / 1024)) }) : t("imp.fileHelp")}
              >
                <input
                  type="file"
                  accept=".csv,.txt,.tsv,.json,.xlsx,text/csv,text/plain,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={onFile}
                />
              </WizardField>
              <Show when={bytes()}>
                <WizardField label={t("imp.format")} help={t("imp.formatDetected")}>
                  <span>{formatText()}</span>
                  <button type="button" class="btn" aria-expanded={editFormat()} onClick={() => setEditFormat((v) => !v)}>
                    {t("imp.formatChange")}
                  </button>
                </WizardField>
                <Show when={editFormat()}>
                  <WizardField label={t("imp.delimiter")}>
                    <Dropdown
                      value={dialect().delimiter}
                      options={DELIMITERS.map((d) => ({ value: d, label: t(`imp.delim.${DELIM_KEY[d]}`) }))}
                      onChange={(v) => changeDialect({ delimiter: v })}
                    />
                  </WizardField>
                  <WizardField label={t("imp.quote")}>
                    <Dropdown
                      value={dialect().quote}
                      options={QUOTES.map((q) => ({ value: q, label: t(q === '"' ? "imp.quote.double" : "imp.quote.single") }))}
                      onChange={(v) => changeDialect({ quote: v })}
                    />
                  </WizardField>
                  <WizardField label={t("imp.encoding")}>
                    <Dropdown
                      value={encoding()}
                      options={ENCODINGS.map((e) => ({ value: e, label: ENC_LABEL[e] }))}
                      onChange={(v) => changeEncoding(v as TextEncoding)}
                    />
                  </WizardField>
                  <div class="wiz-row">
                    <span class="wiz-label">{t("imp.headerRow")}</span>
                    <label class="wiz-ctl import-check">
                      <input
                        type="checkbox"
                        checked={dialect().header}
                        onChange={(e) => changeDialect({ header: e.currentTarget.checked })}
                      />
                      {t("imp.headerRowHelp")}
                    </label>
                  </div>
                </Show>
              </Show>
            </Show>
            <Show when={workbook() && workbook()!.sheets.length > 1}>
              <WizardField label={t("imp.sheet")}>
                <Dropdown
                  value={sheetName()}
                  options={workbook()!.sheets.map((s) => ({ value: s.name, label: s.name }))}
                  onChange={(v) => selectSheet(v)}
                  class="map-select"
                />
              </WizardField>
            </Show>
          </div>

          {/* A textarea rather than navigator.clipboard.readText(): reading the
              clipboard needs a permission the webview may simply deny, while
              pasting INTO a field always works and is the gesture people already
              have in their fingers. */}
          <Show when={source() === "clipboard"}>
            <div class="import-field">
              <label class="import-paste-label" for="import-paste">
                {t("imp.pasteLabel")}
              </label>
              <textarea
                id="import-paste"
                class="import-paste"
                rows="6"
                spellcheck={false}
                placeholder={t("imp.pastePlaceholder")}
                value={pasted()}
                onInput={(e) => usePasted(e.currentTarget.value)}
              />
              <Show when={pasted().trim() !== ""}>
                <p class="help">
                  {t("imp.pastedFormat", {
                    format: pastedDelimiter() === "\t" ? "TSV" : "CSV",
                    delim: t(`imp.delim.${DELIM_KEY[pastedDelimiter()]}`),
                  })}
                </p>
              </Show>
            </div>
            <label class="import-check">
              <input type="checkbox" checked={blankIsNull()} onChange={(e) => setBlankIsNull(e.currentTarget.checked)} />
              {t("imp.blankIsNull")}
            </label>
          </Show>

          <Show when={effective()}>
            {(table) => (
              <TablePreview
                title={t("imp.previewOf", {
                  source: sourceName(),
                  rows: countText("imp.rowsN", table().rows.length),
                  cols: countText("imp.colsN", table().headers.length),
                })}
                table={table()}
              />
            )}
          </Show>
        </Show>

        <Show when={step() === 1 && effective()}>
          {(table) => (
            <>
              <ColumnMapper
                targets={targets()}
                sourceHeaders={table().headers}
                mapping={mapping()}
                onChange={setMapping}
                example={table().rows[0]}
              />
              <div class="wiz-form">
                <RowErrorPolicy name="policy" value={policy()} onChange={setPolicy} />
                <WizardField label={t("imp.transaction")}>
                  <span>{t("imp.txHelp")}</span>
                </WizardField>
              </div>
            </>
          )}
        </Show>

        <Show when={running()}>
          {(r) => (
            <RunProgress
              title={t("imp.running", { source: sourceName(), table: props.target.table })}
              done={r().done}
              total={r().total}
              unit="rows"
              startedAt={r().startedAt}
              counts={[
                { label: countText("imp.insertedN", r().done - r().errors.length) },
                ...(r().errors.length > 0
                  ? [{ label: countText("imp.failedN", r().errors.length), tone: "error" as const }]
                  : []),
                { label: countText("imp.pendingN", r().total - r().done) },
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
                  : t("imp.doneResult", { table: props.target.table })}
              </p>
              <WizardSummary
                stats={[
                  { value: sum().inserted, label: t("imp.stat.inserted") },
                  { value: sum().errors.length, label: t("imp.stat.failed"), error: sum().errors.length > 0 },
                  { value: formatElapsed(sum().ms), label: t("imp.stat.time") },
                ]}
              />
              <RunErrors
                errors={errorsOf(sum().errors)}
                title={countText("imp.failedRows", sum().errors.length)}
                policy={sum().aborted ? t("imp.policyAbortNote") : t("imp.policySkipNote")}
              />
            </>
          )}
        </Show>
      </Wizard>
    </Panel>
  );
}
