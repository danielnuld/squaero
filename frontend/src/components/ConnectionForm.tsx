import { For, Show, createMemo, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import {
  driverSchema,
  fieldErrors,
  isValid,
  engineIcon,
  AVAILABLE_DRIVERS,
  DRIVER_SCHEMAS,
  type Connection,
} from "../utils/connections";
import { errorText } from "../utils/errors";

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

  const selectDriver = (driver: string) => {
    setDraft({ driver, params: {} });
    setTest({ kind: "idle" });
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
    <div class="modal-backdrop" onClick={props.onCancel}>
      <div class="modal" onClick={(e) => e.stopPropagation()}>
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

        <Show when={schema()}>
          {(s) => (
            <For each={s().fields}>
              {(field, i) => (
                <>
                  <Show when={field.group && field.group !== s().fields[i() - 1]?.group}>
                    <h3 class="field-group">{field.group}</h3>
                  </Show>
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
                </>
              )}
            </For>
          )}
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
      </div>
    </div>
  );
}
