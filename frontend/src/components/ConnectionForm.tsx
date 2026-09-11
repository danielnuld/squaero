import { For, Show, createMemo, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import {
  driverSchema,
  fieldErrors,
  isValid,
  connIcon,
  engineIcon,
  AVAILABLE_DRIVERS,
  DRIVER_SCHEMAS,
  CONNECTION_COLORS,
  CONNECTION_ICONS,
  type Connection,
} from "../utils/connections";
import { errorText } from "../utils/errors";
import { canPickFile, pickFile } from "../utils/pickFile";
import { Panel } from "./Panel";
import { t } from "../utils/i18n";

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; msg: string }
  | { kind: "error"; msg: string };

// Data-driven connection form: fields come from the selected driver's schema,
// so a new engine needs no UI changes. "Probar" opens and immediately closes a
// real connection through the core; secrets are kept only in memory.
export function ConnectionForm(props: {
  initial: Connection;
  onSave: (c: Connection) => void;
  onCancel: () => void;
  onTest: (c: Connection) => Promise<void>;
  /** Lists the server's databases from the details entered so far, for the
      database picker. Absent → the picker button is not shown. */
  onListDatabases?: (c: Connection) => Promise<string[]>;
  /** Group names already in use, offered as suggestions in the group field. */
  groups?: string[];
}) {
  const [draft, setDraft] = createStore<Connection>({
    ...props.initial,
    params: { ...props.initial.params },
  });
  // Errors are computed live but only shown once the user attempts to save/test,
  // so a fresh form is not pre-decorated with "required" messages.
  const [showErrors, setShowErrors] = createSignal(false);
  const [test, setTest] = createSignal<TestState>({ kind: "idle" });

  // Database picker (issue: pick the main DB from a live list). Fetched lazily
  // when the user clicks "Cargar lista"; reset when the engine changes.
  const [dbList, setDbList] = createSignal<string[] | null>(null);
  const [dbLoading, setDbLoading] = createSignal(false);
  const [dbError, setDbError] = createSignal<string | null>(null);

  const schema = () => driverSchema(draft.driver);
  const errors = createMemo(() => fieldErrors(draft));

  // Fields are split across tabs so the form is not one long scroll: base
  // (ungrouped) fields live under "General"; each declared group (SSL, SSH…)
  // becomes its own tab. Tabs only appear when a driver actually has groups.
  const GENERAL = "cform.general";
  const groups = createMemo(() => {
    const gs: string[] = [];
    for (const f of schema()?.fields ?? []) {
      if (f.group && !gs.includes(f.group)) gs.push(f.group);
    }
    return gs;
  });
  const tabNames = createMemo(() => [GENERAL, ...groups()]);
  const [activeFormTab, setActiveFormTab] = createSignal(GENERAL);
  const fieldsFor = (tab: string) =>
    (schema()?.fields ?? []).filter((f) =>
      tab === GENERAL ? !f.group : f.group === tab,
    );
  // Whether a tab has any field currently in error (to flag it once errors show).
  const tabHasError = (tab: string) =>
    fieldsFor(tab).some((f) => errors().params[f.key]);

  const selectDriver = (driver: string) => {
    setDraft({ driver, params: {} });
    setTest({ kind: "idle" });
    setActiveFormTab(GENERAL);
    setDbList(null);
    setDbError(null);
  };

  const snapshot = (): Connection => ({ ...draft, params: { ...draft.params } });

  // Populate the database dropdown from a live lookup that reuses the details
  // entered so far. Requires every OTHER required field (host, user…) to be
  // valid — the database itself is exactly what we are trying to discover.
  const canListDatabases = createMemo(() => {
    if (!props.onListDatabases) return false;
    const errs = errors().params;
    return !Object.keys(errs).some((k) => k !== "database");
  });

  const loadDatabases = async () => {
    if (!props.onListDatabases) return;
    setShowErrors(true);
    if (!canListDatabases()) return;
    setDbError(null);
    setDbLoading(true);
    try {
      setDbList(await props.onListDatabases(snapshot()));
    } catch (err) {
      setDbError(errorText(err));
      setDbList(null);
    } finally {
      setDbLoading(false);
    }
  };

  const save = () => {
    setShowErrors(true);
    if (isValid(errors())) {
      props.onSave(snapshot());
    }
  };

  const runTest = async () => {
    setShowErrors(true);
    if (!isValid(errors())) {
      return;
    }
    setTest({ kind: "testing" });
    try {
      await props.onTest(snapshot());
      setTest({ kind: "ok", msg: t("cform.testOk") });
    } catch (err) {
      setTest({ kind: "error", msg: errorText(err) });
    }
  };

  return (
    <Panel
      title={props.initial.name ? t("cform.edit") : t("cform.new")}
      onClose={props.onCancel}
    >
      <h2>
        <span class="engine-icon">{connIcon(draft)}</span>{" "}
        {props.initial.name ? t("cform.edit") : t("cform.new")}
      </h2>

        <label class="field">
          <span>{t("cform.name")}</span>
          <input
            type="text"
            class={showErrors() && errors().name ? "input-invalid" : ""}
            value={draft.name}
            onInput={(e) => setDraft("name", e.currentTarget.value)}
            placeholder={t("cform.namePlaceholder")}
          />
          <Show when={showErrors() && errors().name}>
            <span class="field-error">{t(errors().name!)}</span>
          </Show>
        </label>

        <div class="field">
          <span>{t("cform.color")}</span>
          <div class="color-swatches" role="radiogroup" aria-label={t("cform.color")}>
            <button
              type="button"
              class={`color-swatch color-none ${!draft.color ? "selected" : ""}`}
              title={t("cform.noColor")}
              aria-label={t("cform.noColor")}
              aria-checked={!draft.color}
              role="radio"
              onClick={() => setDraft("color", undefined)}
            />
            <For each={CONNECTION_COLORS}>
              {(c) => (
                <button
                  type="button"
                  class={`color-swatch ${draft.color === c ? "selected" : ""}`}
                  style={{ background: c }}
                  title={c}
                  aria-label={c}
                  aria-checked={draft.color === c}
                  role="radio"
                  onClick={() => setDraft("color", c)}
                />
              )}
            </For>
          </div>
        </div>

        {/* A group is just this label: typing a new name creates it, clearing it
            from the last connection removes it. The datalist suggests the ones
            already in use. */}
        <label class="field">
          <span>{t("cform.group")}</span>
          <input
            type="text"
            list="conn-groups"
            value={draft.group ?? ""}
            onInput={(e) => setDraft("group", e.currentTarget.value)}
            placeholder={t("cform.noGroup")}
          />
          <datalist id="conn-groups">
            <For each={props.groups ?? []}>{(g) => <option value={g} />}</For>
          </datalist>
        </label>

        <div class="field">
          <span>{t("cform.icon")}</span>
          <div class="icon-swatches">
            <button
              type="button"
              class={`icon-swatch icon-engine ${!draft.icon ? "selected" : ""}`}
              title={t("cform.engineIcon")}
              aria-pressed={!draft.icon}
              onClick={() => setDraft("icon", undefined)}
            >
              {engineIcon(draft.driver)} {t("cform.engineIconShort")}
            </button>
            <For each={CONNECTION_ICONS}>
              {(emoji) => (
                <button
                  type="button"
                  class={`icon-swatch ${draft.icon === emoji ? "selected" : ""}`}
                  title={emoji}
                  aria-pressed={draft.icon === emoji}
                  onClick={() => setDraft("icon", draft.icon === emoji ? undefined : emoji)}
                >
                  {emoji}
                </button>
              )}
            </For>
            <input
              type="text"
              class="icon-input"
              maxLength={4}
              value={draft.icon ?? ""}
              title={t("cform.otherEmojiTitle")}
              aria-label={t("cform.otherEmoji")}
              onInput={(e) => setDraft("icon", e.currentTarget.value || undefined)}
            />
          </div>
        </div>

        <label class="field">
          <span>{t("cform.engine")}</span>
          <select
            value={draft.driver}
            onChange={(e) => selectDriver(e.currentTarget.value)}
          >
            <For each={AVAILABLE_DRIVERS}>
              {(d) => (
                <option value={d}>
                  {engineIcon(d)} {DRIVER_SCHEMAS[d]?.label ?? d}
                </option>
              )}
            </For>
          </select>
        </label>

        <Show when={groups().length > 0}>
          <div class="form-tabs" role="tablist">
            <For each={tabNames()}>
              {(name) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeFormTab() === name}
                  class={`form-tab ${activeFormTab() === name ? "active" : ""} ${
                    showErrors() && tabHasError(name) ? "has-error" : ""
                  }`}
                  onClick={() => setActiveFormTab(name)}
                >
                  {t(name)}
                  <Show when={showErrors() && tabHasError(name)}>
                    <span class="form-tab-dot" aria-label={t("cform.tabHasErrors")}>
                      ●
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>

        <Show when={schema()}>
          <For each={fieldsFor(activeFormTab())}>
            {(field) => (
              <label class="field">
                <span>
                  {t(field.label)}
                  {field.required ? " *" : ""}
                </span>
                <Show
                  when={field.type === "select"}
                  fallback={
                    <input
                      type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
                      class={
                        showErrors() && errors().params[field.key] ? "input-invalid" : ""
                      }
                      value={draft.params[field.key] ?? ""}
                      /* Placeholders go through t() as well: most are hostnames, ports and
                         paths that read the same in any language, and an unknown key
                         resolves to itself, so only the ones that ARE keys get translated. */
                      placeholder={field.placeholder ? t(field.placeholder) : ""}
                      onInput={(e) => setDraft("params", field.key, e.currentTarget.value)}
                    />
                  }
                >
                  <select
                    value={draft.params[field.key] ?? ""}
                    onChange={(e) => setDraft("params", field.key, e.currentTarget.value)}
                  >
                    <For each={field.options ?? []}>
                      {(opt) => <option value={opt.value}>{t(opt.label)}</option>}
                    </For>
                  </select>
                </Show>
                <Show when={field.type === "file" && canPickFile()}>
                  <button
                    type="button"
                    class="status-btn"
                    title={t("cform.browseTitle")}
                    onClick={async () => {
                      const path = await pickFile(t(field.label));
                      if (path) setDraft("params", field.key, path);
                    }}
                  >
                    {t("cform.browse")}
                  </button>
                </Show>
                <Show when={field.fetch === "databases" && props.onListDatabases}>
                  <div class="db-picker">
                    <button
                      type="button"
                      class="status-btn"
                      title={t("cform.listDbTitle")}
                      disabled={dbLoading()}
                      onClick={loadDatabases}
                    >
                      {dbLoading() ? t("panel.loading") : t("cform.listDb")}
                    </button>
                    <Show when={dbList()}>
                      {(list) => (
                        <select
                          class="db-picker-select"
                          value={draft.params[field.key] ?? ""}
                          onChange={(e) =>
                            setDraft("params", field.key, e.currentTarget.value)
                          }
                        >
                          <option value="">
                            {list().length > 0 ? t("cform.pickDb") : t("cform.noDbs")}
                          </option>
                          <For each={list()}>
                            {(db) => <option value={db}>{db}</option>}
                          </For>
                        </select>
                      )}
                    </Show>
                  </div>
                  <Show when={dbError()}>
                    <span class="field-error">{dbError()}</span>
                  </Show>
                </Show>
                <Show when={showErrors() && errors().params[field.key]}>
                  <span class="field-error">{t(errors().params[field.key])}</span>
                </Show>
              </label>
            )}
          </For>
        </Show>

        <Show when={test().kind === "ok"}>
          <p class="test-ok">{(test() as { msg: string }).msg}</p>
        </Show>
        <Show when={test().kind === "error"}>
          <p class="test-error">{(test() as { msg: string }).msg}</p>
        </Show>

        <Show when={showErrors() && !isValid(errors())}>
          <p class="test-error">
            {t("cform.saveBlocked", {
              detail: errors().name ? t("cform.saveBlockedName") : "",
            })}
          </p>
        </Show>

        <div class="modal-actions">
          <button onClick={runTest} disabled={test().kind === "testing"}>
            {test().kind === "testing" ? t("cform.testing") : t("cform.test")}
          </button>
          <span class="status-spacer" />
          <button onClick={props.onCancel}>{t("common.cancel")}</button>
          <button class="primary" onClick={save}>
            {t("cform.save")}
          </button>
        </div>
    </Panel>
  );
}
