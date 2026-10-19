import { For, Show, createSignal } from "solid-js";
import { Dialog } from "./Dialog";
import { WizardField } from "./Wizard";
import { Dropdown } from "./Dropdown";
import { t } from "../utils/i18n";
import { countText } from "../utils/confirmText";
import { exportScopes, type CsvOptions, type ExportScope } from "../utils/exporters";

/** What the user chose; the caller asks where to save and writes it. */
export interface ExportChoice<F extends string = string> {
  format: F;
  scope: ExportScope;
  csv: CsvOptions;
}

const DELIMITERS = [",", ";", "\t", "|"];

/**
 * The export dialog (audit R-36, issue #692): format, which rows — the whole
 * table or query (the default whenever it can be re-read), the page the grid
 * holds, or the marked rows — and CSV's options. «Exportar…» then asks where to
 * save; the progress, with its Cancel, is the app's export toast.
 */
export function ExportDialog<F extends string>(props: {
  formats: { fmt: F; label: string }[];
  initialFormat: F;
  /** Rows the grid holds now. */
  loaded: number;
  /** Rows marked in the grid. */
  marked: number;
  /** The result can be read again in full (a table or a re-runnable query). */
  canReadAll: boolean;
  /** The grid holds only part of it. */
  more: boolean;
  onExport: (choice: ExportChoice<F>) => void;
  onCancel: () => void;
}) {
  const plan = exportScopes({ canReadAll: props.canReadAll, marked: props.marked });
  const [format, setFormat] = createSignal<F>(props.initialFormat);
  const [scope, setScope] = createSignal<ExportScope>(plan.initial);
  const [delimiter, setDelimiter] = createSignal(",");
  const [header, setHeader] = createSignal(true);
  const [nullText, setNullText] = createSignal("");
  const [bom, setBom] = createSignal(false);

  const scopeLabel = (s: ExportScope) =>
    s === "all"
      ? props.more
        ? t("export.scope.allMore", { n: props.loaded })
        : countText("export.scope.all", props.loaded)
      : s === "page"
        ? countText("export.scope.page", props.loaded)
        : countText("export.scope.marked", props.marked);

  return (
    <Dialog
      title={t("export.title")}
      size="md"
      class="export-dialog"
      onCancel={props.onCancel}
      primary={{
        label: t("export.go"),
        onClick: () =>
          props.onExport({
            format: format(),
            scope: scope(),
            csv: { delimiter: delimiter(), header: header(), nullText: nullText(), bom: bom() },
          }),
      }}
    >
      <div class="wiz-form">
        <WizardField label={t("export.format")}>
          <Dropdown
            value={format()}
            options={props.formats.map((f) => ({ value: f.fmt, label: f.label }))}
            onChange={(v) => setFormat(() => v as F)}
          />
        </WizardField>
        <div class="wiz-row" role="radiogroup" aria-label={t("export.scope")}>
          <span class="wiz-label">{t("export.scope")}</span>
          <span class="wiz-ctl wiz-radios">
            <For each={plan.scopes}>
              {(s) => (
                <label>
                  <input type="radio" name="export-scope" checked={scope() === s} onChange={() => setScope(s)} />
                  {scopeLabel(s)}
                </label>
              )}
            </For>
          </span>
          <Show when={scope() === "page" && props.more}>
            <p class="field-error wiz-help">{t("export.pageOnly")}</p>
          </Show>
        </div>
        <Show when={format() === "csv"}>
          <WizardField label={t("export.delimiter")}>
            <Dropdown
              value={delimiter()}
              options={DELIMITERS.map((d) => ({ value: d, label: t(`export.delim.${DELIMITERS.indexOf(d)}`) }))}
              onChange={setDelimiter}
            />
          </WizardField>
          <WizardField label={t("export.nullText")} help={t("export.nullTextHelp")}>
            <input type="text" value={nullText()} onInput={(e) => setNullText(e.currentTarget.value)} />
          </WizardField>
          <div class="wiz-row">
            <span class="wiz-label">{t("export.options")}</span>
            <span class="wiz-ctl wiz-radios">
              <label>
                <input type="checkbox" checked={header()} onChange={(e) => setHeader(e.currentTarget.checked)} />
                {t("export.header")}
              </label>
              <label>
                <input type="checkbox" checked={bom()} onChange={(e) => setBom(e.currentTarget.checked)} />
                {t("export.bom")}
              </label>
            </span>
          </div>
        </Show>
      </div>
    </Dialog>
  );
}
