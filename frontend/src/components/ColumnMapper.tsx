import { For, Show } from "solid-js";
import { t } from "../utils/i18n";
import {
  assignedCount,
  convertPreview,
  mapByName,
  type ColumnMapping,
  type TargetColumn,
} from "../utils/importers";
import { Dropdown } from "./Dropdown";

const OMIT = ""; // the option value that leaves a column unset

/**
 * The mapping step of import and transfer (#692): each target column with its
 * type, the source column it takes, and how the first row's value reads there
 * («1 → true», a warning when it does not fit). Above it, «n de m columnas
 * asignadas» and «Asignar por nombre»; a column the database assigns
 * (autoincrement) is offered as «Omitir · la genera la BD».
 */
export function ColumnMapper(props: {
  targets: TargetColumn[];
  sourceHeaders: string[];
  mapping: ColumnMapping;
  onChange: (mapping: ColumnMapping) => void;
  /** The first source row, for the «Ejemplo» column; absent hides it. */
  example?: (string | null)[];
  /** «Asignar por nombre» leaves autoincrement columns out (default true). */
  skipAuto?: boolean;
}) {
  const autoNames = () => props.targets.filter((c) => c.auto).map((c) => c.name);
  const sample = (col: TargetColumn) => {
    const src = props.mapping[col.name];
    if (src == null || !props.example) return null;
    const i = props.sourceHeaders.indexOf(src);
    return convertPreview(i >= 0 ? (props.example[i] ?? null) : null, col.type);
  };
  const set = (col: string, value: string) => props.onChange({ ...props.mapping, [col]: value === OMIT ? null : value });

  return (
    <section class="colmap" aria-label={t("imp.mapping")}>
      <div class="colmap-head">
        <h3>{t("imp.mapping")}</h3>
        <span class="help" role="status">
          {t("imp.assigned", { n: assignedCount(props.mapping), total: props.targets.length })}
          <Show when={autoNames().length > 0 && (props.skipAuto ?? true)}>
            {" · "}
            {t("imp.autoSkipped", { names: autoNames().join(", ") })}
          </Show>
        </span>
        <span class="toolbar-spacer" />
        <button type="button" class="btn" onClick={() => props.onChange(mapByName(props.sourceHeaders, props.targets, props.skipAuto ?? true))}>
          {t("imp.byName")}
        </button>
      </div>
      <div class={props.example ? "colmap-grid has-example" : "colmap-grid"} role="table">
        <div class="colmap-row colmap-th" role="row">
          <span role="columnheader">{t("imp.col.target")}</span>
          <span aria-hidden="true" />
          <span role="columnheader">{t("imp.col.source")}</span>
          <Show when={props.example}>
            <span role="columnheader">{t("imp.col.example")}</span>
          </Show>
        </div>
        <For each={props.targets}>
          {(col) => (
            <div class="colmap-row" role="row">
              <span class="colmap-target" role="cell">
                <span class="map-target">{col.name}</span>
                <Show when={col.type}>
                  <span class="colmap-type">{col.type}</span>
                </Show>
              </span>
              <span class="map-arrow" aria-hidden="true">
                ←
              </span>
              <span role="cell">
                <Dropdown
                  aria-label={t("imp.sourceFor", { name: col.name })}
                  value={props.mapping[col.name] ?? OMIT}
                  options={[
                    { value: OMIT, label: col.auto ? t("imp.omitAuto") : t("imp.omit") },
                    ...props.sourceHeaders.map((h) => ({ value: h, label: h })),
                  ]}
                  onChange={(v) => set(col.name, v)}
                  class="map-select"
                />
              </span>
              <Show when={props.example}>
                <span class="colmap-example" role="cell">
                  <Show
                    when={sample(col)}
                    fallback={<span class="help">{col.auto && props.mapping[col.name] == null ? t("imp.autoNote") : ""}</span>}
                  >
                    {(s) => (
                      <>
                        <span class={s().text === "NULL" ? "cell-null" : undefined}>{s().text}</span>
                        <Show when={s().to}>
                          <span class="colmap-to"> → {s().to}</span>
                        </Show>
                        <Show when={s().warn}>
                          <span class="field-error colmap-warn">{t(s().warn!)}</span>
                        </Show>
                      </>
                    )}
                  </Show>
                </span>
              </Show>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}
