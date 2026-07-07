import { For, Show, createMemo, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import {
  driverSchema,
  fieldErrors,
  isValid,
  engineIcon,
  AVAILABLE_DRIVERS,
  DRIVER_SCHEMAS,
  CONNECTION_COLORS,
  type Connection,
} from "../utils/connections";
import { errorText } from "../utils/errors";
import { Panel } from "./Panel";

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
}) {
  const [draft, setDraft] = createStore<Connection>({
    ...props.initial,
    params: { ...props.initial.params },
  });
  // Errors are computed live but only shown once the user attempts to save/test,
  // so a fresh form is not pre-decorated with "required" messages.
  const [showErrors, setShowErrors] = createSignal(false);
  const [test, setTest] = createSignal<TestState>({ kind: "idle" });

  const schema = () => driverSchema(draft.driver);
  const errors = createMemo(() => fieldErrors(draft));

  // Fields are split across tabs so the form is not one long scroll: base
  // (ungrouped) fields live under "General"; each declared group (SSL, SSH…)
  // becomes its own tab. Tabs only appear when a driver actually has groups.
  const GENERAL = "General";
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
  };

  const snapshot = (): Connection => ({ ...draft, params: { ...draft.params } });

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
      setTest({ kind: "ok", msg: "Conexión exitosa." });
    } catch (err) {
      setTest({ kind: "error", msg: errorText(err) });
    }
  };

  return (
    <Panel
      title={props.initial.name ? "Editar conexión" : "Nueva conexión"}
      onClose={props.onCancel}
    >
      <h2>
        <span class="engine-icon">{engineIcon(draft.driver)}</span>{" "}
        {props.initial.name ? "Editar conexión" : "Nueva conexión"}
      </h2>

        <label class="field">
          <span>Nombre</span>
          <input
            type="text"
            class={showErrors() && errors().name ? "input-invalid" : ""}
            value={draft.name}
            onInput={(e) => setDraft("name", e.currentTarget.value)}
            placeholder="Mi base de datos"
          />
          <Show when={showErrors() && errors().name}>
            <span class="field-error">{errors().name}</span>
          </Show>
        </label>

        <div class="field">
          <span>Color</span>
          <div class="color-swatches" role="radiogroup" aria-label="Color de la conexión">
            <button
              type="button"
              class={`color-swatch color-none ${!draft.color ? "selected" : ""}`}
              title="Sin color"
              aria-label="Sin color"
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

        <label class="field">
          <span>Motor</span>
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
                  {name}
                  <Show when={showErrors() && tabHasError(name)}>
                    <span class="form-tab-dot" aria-label="Campos con errores">
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
                  {field.label}
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
                      placeholder={field.placeholder ?? ""}
                      onInput={(e) => setDraft("params", field.key, e.currentTarget.value)}
                    />
                  }
                >
                  <select
                    value={draft.params[field.key] ?? ""}
                    onChange={(e) => setDraft("params", field.key, e.currentTarget.value)}
                  >
                    <For each={field.options ?? []}>
                      {(opt) => <option value={opt.value}>{opt.label}</option>}
                    </For>
                  </select>
                </Show>
                <Show when={showErrors() && errors().params[field.key]}>
                  <span class="field-error">{errors().params[field.key]}</span>
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

        <div class="modal-actions">
          <button onClick={runTest} disabled={test().kind === "testing"}>
            {test().kind === "testing" ? "Probando…" : "Probar conexión"}
          </button>
          <span class="status-spacer" />
          <button onClick={props.onCancel}>Cancelar</button>
          <button class="primary" onClick={save}>
            Guardar
          </button>
        </div>
    </Panel>
  );
}
