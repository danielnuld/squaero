import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import {
  driverSchema,
  connectionTarget,
  defaultConnectionName,
  fieldErrors,
  isValid,
  engineIcon,
  engineMonogram,
  AVAILABLE_DRIVERS,
  DRIVER_SCHEMAS,
  CONNECTION_COLORS,
  CONNECTION_ICONS,
  type Connection,
  type DriverField,
} from "../utils/connections";
import {
  fieldRows,
  formSections,
  needsCertificates,
  sectionStatus,
  securityHint,
  type SectionId,
  type SectionStatus,
} from "../utils/connectionFormSections";
import { errorText, INFORMIX_CSDK_URL, isInformixClientMissing } from "../utils/errors";
import { openExternal } from "../utils/openExternal";
import { canPickFile, pickFile } from "../utils/pickFile";
import { Panel } from "./Panel";
import { t } from "../utils/i18n";

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  /** `ms`: measured here, because the core reports neither latency nor version. */
  | { kind: "ok"; ms: number }
  /* `clientMissing`: the Informix driver found no IBM client (issue #506), so the
     message is install guidance with a link rather than the raw diagnostic. */
  | { kind: "error"; msg: string; clientMissing?: boolean };

/** The sections the form draws, including the two it owns itself. */
type PaneId = SectionId | "engine" | "appearance";

const SECTION_LABEL: Record<PaneId, string> = {
  engine: "cform.engine",
  server: "cform.section.server",
  file: "cform.section.file",
  auth: "cform.section.auth",
  security: "cform.section.security",
  ssh: "cform.section.ssh",
  appearance: "cform.section.appearance",
};

const STATUS_LABEL: Record<SectionStatus, string> = {
  ok: "cform.status.ok",
  error: "cform.status.error",
  off: "cform.status.off",
  pending: "cform.status.pending",
};

const STATUS_MARK: Record<SectionStatus, string> = {
  ok: "✓",
  error: "!",
  off: "—",
  pending: "·",
};

/**
 * Tunnel fields that only matter when the database is NOT on the machine you
 * SSH into, or when the host-key policy needs changing. Folded away by default:
 * they are four of the eleven fields and nobody fills them on a first connection.
 */
const SSH_ADVANCED = new Set([
  "ssh_target_host",
  "ssh_target_port",
  "ssh_host_key_policy",
  "ssh_known_hosts",
]);

// Data-driven connection form: fields come from the selected driver's schema,
// so a new engine needs no UI changes. "Probar" opens and immediately closes a
// real connection through the core; secrets are kept only in memory.
//
// One page of sections, in the order of the task (issue #531). It used to be
// TABS built from DriverField.group, which is what hid the SSH tunnel: nothing
// said it existed, and it turns itself on by typing into a field of a tab nobody
// opened — the model has no flag for the tunnel, the core opens it when
// `ssh_host` has a value. Sections put everything on one surface, the side index
// says which ones still want something, and the right-hand column keeps the
// preview and the connection test in sight while you scroll.
export function ConnectionForm(props: {
  initial: Connection;
  onSave: (c: Connection) => void;
  onCancel: () => void;
  onTest: (c: Connection) => Promise<void>;
  /** Save and open it straight away. Absent → the button is not drawn. */
  onSaveAndConnect?: (c: Connection) => void;
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
  const [tried, setTried] = createSignal(false);
  const [test, setTest] = createSignal<TestState>({ kind: "idle" });

  // Database picker (issue: pick the main DB from a live list). Fetched lazily
  // when the user asks for it; reset when the engine changes.
  const [dbList, setDbList] = createSignal<string[] | null>(null);
  const [dbLoading, setDbLoading] = createSignal(false);
  const [dbError, setDbError] = createSignal<string | null>(null);

  // The tunnel's switch is view state, not model state: the saved connection has
  // no flag for it (the core opens the tunnel when `ssh_host` has a value), so
  // an editing session starts with the switch wherever the data left it.
  // Turning it OFF keeps what was typed, so turning it back on does not mean
  // retyping a bastion; `snapshot()` is what actually drops the ssh_* keys.
  const [sshOn, setSshOn] = createSignal((props.initial.params.ssh_host ?? "").trim() !== "");

  const schema = () => driverSchema(draft.driver);
  const errors = createMemo(() => fieldErrors(draft, { sshRequired: sshOn() }));

  const panes = createMemo<{ id: PaneId; fields: DriverField[] }[]>(() => {
    const s = schema();
    return [
      { id: "engine" as PaneId, fields: [] },
      ...(s ? formSections(s).map((sec) => ({ id: sec.id as PaneId, fields: sec.fields })) : []),
      { id: "appearance" as PaneId, fields: [] },
    ];
  });

  const statusOf = (pane: { id: PaneId; fields: DriverField[] }): SectionStatus => {
    // The two the form owns are never incomplete: an engine is always picked,
    // and everything under "appearance" is optional by definition.
    if (pane.id === "engine" || pane.id === "appearance") return "ok";
    return sectionStatus(
      { id: pane.id as SectionId, fields: pane.fields },
      draft,
      errors(),
      { tried: tried(), sshOn: sshOn() },
    );
  };

  // Jumping to a section, and knowing which one is on screen.
  const [current, setCurrent] = createSignal<PaneId>("engine");
  const paneEls = new Map<PaneId, HTMLElement>();
  const registerPane = (id: PaneId) => (el: HTMLElement) => {
    paneEls.set(id, el);
  };

  const jumpTo = (id: PaneId) => {
    setCurrent(id);
    // Guarded: jsdom has no layout and does not implement scrollIntoView, and a
    // test must not die on a scroll.
    paneEls.get(id)?.scrollIntoView?.({ block: "start" });
  };

  onMount(() => {
    // Highlighting the visible section is a nicety: where it is unavailable the
    // index still jumps, which is the part that matters.
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const shown = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!shown) return;
        for (const [id, el] of paneEls) {
          if (el === shown.target) setCurrent(id);
        }
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );
    for (const el of paneEls.values()) io.observe(el);
    onCleanup(() => io.disconnect());
  });

  const selectDriver = (driver: string) => {
    setDraft({ driver, params: {} });
    setTest({ kind: "idle" });
    setSshOn(false);
    setDbList(null);
    setDbError(null);
  };

  const snapshot = (): Connection => {
    const params = { ...draft.params };
    // Saved with the switch off, the tunnel keys go: leaving an ssh_user behind
    // would be dead data, and leaving an ssh_host behind would silently keep
    // tunnelling — the very thing the switch exists to make visible.
    if (!sshOn()) {
      for (const key of Object.keys(params)) {
        if (key.startsWith("ssh_")) delete params[key];
      }
    }
    return { ...draft, params };
  };

  /** What the connection will be called: what was typed, or the deduced name. */
  const deducedName = () => defaultConnectionName(draft);
  const named = (c: Connection): Connection =>
    c.name.trim()
      ? c
      : { ...c, name: defaultConnectionName(c) || DRIVER_SCHEMAS[c.driver]?.label || c.driver };

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
    setTried(true);
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

  /** Takes the user to the first thing that is wrong, instead of just refusing. */
  const goToFirstError = () => {
    const bad = Object.keys(errors().params)[0];
    if (!bad) return;
    for (const pane of panes()) {
      if (pane.fields.some((f) => f.key === bad)) {
        jumpTo(pane.id);
        return;
      }
    }
  };

  /** Shared by save, save-and-connect and test: check, or go to what is wrong. */
  const ready = (): boolean => {
    setTried(true);
    if (isValid(errors())) return true;
    goToFirstError();
    return false;
  };

  const save = () => {
    if (ready()) props.onSave(named(snapshot()));
  };

  const saveAndConnect = () => {
    if (ready()) props.onSaveAndConnect?.(named(snapshot()));
  };

  const runTest = async () => {
    if (!ready()) return;
    setTest({ kind: "testing" });
    // Measured here because the core reports no latency of its own; showing a
    // number nobody measured would be worse than showing none.
    const started = performance.now();
    try {
      await props.onTest(snapshot());
      setTest({ kind: "ok", ms: Math.round(performance.now() - started) });
    } catch (err) {
      setTest(
        isInformixClientMissing(err)
          ? { kind: "error", msg: t("ifx.clientMissing"), clientMissing: true }
          : { kind: "error", msg: errorText(err) },
      );
    }
  };

  const field = (f: DriverField) => (
    <label class="cf-field">
      <span class="cf-label">
        {t(f.label)}
        <Show when={!f.required}>
          <span class="cf-optional">{t("cform.optional")}</span>
        </Show>
      </span>
      <div class="cf-input-row">
        <Show
          when={f.type === "select"}
          fallback={
            <input
              type={f.type === "password" ? "password" : f.type === "number" ? "number" : "text"}
              class={tried() && errors().params[f.key] ? "input-invalid" : ""}
              value={draft.params[f.key] ?? ""}
              /* Placeholders go through t() as well: most are hostnames, ports and
                 paths that read the same in any language, and an unknown key
                 resolves to itself, so only the ones that ARE keys get translated. */
              placeholder={f.placeholder ? t(f.placeholder) : ""}
              onInput={(e) => setDraft("params", f.key, e.currentTarget.value)}
            />
          }
        >
          <select
            value={draft.params[f.key] ?? ""}
            onChange={(e) => setDraft("params", f.key, e.currentTarget.value)}
          >
            <For each={f.options ?? []}>
              {(opt) => <option value={opt.value}>{t(opt.label)}</option>}
            </For>
          </select>
        </Show>
        <Show when={f.type === "file" && canPickFile()}>
          <button
            type="button"
            class="cf-inline-btn"
            title={t("cform.browseTitle")}
            onClick={async () => {
              const path = await pickFile(t(f.label));
              if (path) setDraft("params", f.key, path);
            }}
          >
            {t("cform.browse")}
          </button>
        </Show>
        {/* Inside the field, not under it: listing the server's databases is a
            way of FILLING THIS BOX, and a button parked below reads like an
            action of the form. */}
        <Show when={f.fetch === "databases" && props.onListDatabases}>
          <button
            type="button"
            class="cf-inline-btn"
            title={t("cform.listDbTitle")}
            disabled={dbLoading()}
            onClick={loadDatabases}
          >
            {dbLoading() ? t("panel.loading") : t("cform.listDb")}
          </button>
        </Show>
      </div>
      <Show when={f.fetch === "databases" && dbList()}>
        {(list) => (
          <select
            class="db-picker-select"
            value={draft.params[f.key] ?? ""}
            onChange={(e) => setDraft("params", f.key, e.currentTarget.value)}
          >
            <option value="">{list().length > 0 ? t("cform.pickDb") : t("cform.noDbs")}</option>
            <For each={list()}>{(db) => <option value={db}>{db}</option>}</For>
          </select>
        )}
      </Show>
      <Show when={f.fetch === "databases" && dbError()}>
        <span class="field-error">{dbError()}</span>
      </Show>
      <Show when={tried() && errors().params[f.key]}>
        <span class="field-error">{t(errors().params[f.key])}</span>
      </Show>
    </label>
  );

  /** A choice laid out as one strip, so every option is readable at once. */
  const segmented = (f: DriverField) => (
    <div class="cf-seg" role="radiogroup" aria-label={t(f.label)}>
      <For each={f.options ?? []}>
        {(opt) => {
          const on = () => (draft.params[f.key] ?? "") === opt.value;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={on()}
              class="cf-seg-btn"
              classList={{ "is-on": on() }}
              onClick={() => setDraft("params", f.key, opt.value)}
            >
              {t(opt.label)}
            </button>
          );
        }}
      </For>
    </div>
  );

  /**
   * Security, explained. The dropdown said "verify_ca" and left the user to
   * work out what that protects; each choice now carries a sentence, and the
   * certificate boxes only appear for the modes that actually read them.
   */
  const securityPane = (fields: DriverField[]) => {
    const main = fields.find((f) => f.options);
    const certs = fields.filter((f) => f.type === "file");
    const value = () => (main ? draft.params[main.key] ?? "" : "");
    return (
      <>
        <Show when={main}>
          {(f) => (
            <div class="cf-field">
              <span class="cf-label">{t(f().label)}</span>
              {segmented(f())}
              <p class="cf-hint">{t(securityHint(f().key, value()))}</p>
            </div>
          )}
        </Show>
        <Show when={certs.length > 0 && needsCertificates(value())}>
          <For each={certs}>{field}</For>
        </Show>
      </>
    );
  };

  /** The tunnel, with a switch — the thing the tabs never gave it. */
  const sshPane = (fields: DriverField[]) => {
    const auth = fields.find((f) => f.key === "ssh_auth");
    const basic = fields.filter((f) => f.key !== "ssh_auth" && !SSH_ADVANCED.has(f.key));
    const advanced = fields.filter((f) => SSH_ADVANCED.has(f.key));
    return (
      <>
        <label class="cf-switch">
          <input
            type="checkbox"
            checked={sshOn()}
            onChange={(e) => setSshOn(e.currentTarget.checked)}
          />
          <span>{t("cform.sshOn")}</span>
        </label>
        <Show when={sshOn()}>
          <For each={fieldRows(basic)}>
            {(row) => (
              <div class="cf-row" classList={{ "is-pair": row.length > 1 }}>
                <For each={row}>{field}</For>
              </div>
            )}
          </For>
          <Show when={auth}>
            {(f) => (
              <div class="cf-field">
                <span class="cf-label">{t(f().label)}</span>
                {segmented(f())}
              </div>
            )}
          </Show>
          {/* Folded: four of the eleven fields, and nobody fills them on a first
              connection — they are for a database that is not on the machine you
              SSH into. */}
          <Show when={advanced.length > 0}>
            <details class="cf-advanced">
              <summary>{t("cform.sshAdvanced")}</summary>
              <For each={advanced}>{field}</For>
            </details>
          </Show>
        </Show>
      </>
    );
  };

  return (
    <Panel
      title={props.initial.name ? t("cform.edit") : t("cform.new")}
      onClose={props.onCancel}
      class="cf-panel"
    >
      <div class="cf">
        <nav class="cf-index" aria-label={t("cform.sections")}>
          <ul>
            <For each={panes()}>
              {(pane) => {
                const status = () => statusOf(pane);
                return (
                  <li>
                    <button
                      type="button"
                      class="cf-index-item"
                      classList={{ "is-current": current() === pane.id }}
                      data-status={status()}
                      /* Spelled out rather than left to the glyph: "✓" read aloud
                         is nothing, and the mark is the only thing that says
                         whether a section still wants something. The names never
                         repeat a field's own label, or asking for the field by
                         name lands here instead. */
                      aria-label={`${t(SECTION_LABEL[pane.id])}: ${t(STATUS_LABEL[status()])}`}
                      onClick={() => jumpTo(pane.id)}
                    >
                      <span class="cf-index-name" aria-hidden="true">
                        {t(SECTION_LABEL[pane.id])}
                      </span>
                      <span class="cf-index-mark" aria-hidden="true">
                        {STATUS_MARK[status()]}
                      </span>
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </nav>

        <div class="cf-main">
          <section class="cf-section" ref={registerPane("engine")}>
            <h3 class="cf-section-title">{t("cform.engine")}</h3>
            {/* Cards, not a <select>: the engine decides every other field on
                this page, and a collapsed dropdown is the one control that hides
                what you are choosing between. */}
            <div class="cf-engines" role="radiogroup" aria-label={t("cform.engine")}>
              <For each={AVAILABLE_DRIVERS}>
                {(d) => {
                  const port = () =>
                    DRIVER_SCHEMAS[d]?.fields.find((f) => f.key === "port")?.placeholder ?? "";
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={draft.driver === d}
                      class="cf-engine"
                      classList={{ "is-on": draft.driver === d }}
                      onClick={() => selectDriver(d)}
                    >
                      <span class="cf-engine-mono" aria-hidden="true">
                        {engineMonogram(d)}
                      </span>
                      <span class="cf-engine-text">
                        <span class="cf-engine-name">{DRIVER_SCHEMAS[d]?.label ?? d}</span>
                        <Show when={port()}>
                          <span class="cf-engine-port">{port()}</span>
                        </Show>
                      </span>
                    </button>
                  );
                }}
              </For>
            </div>
          </section>

          <For each={panes().filter((p) => p.id !== "engine" && p.id !== "appearance")}>
            {(pane) => (
              <section class="cf-section" ref={registerPane(pane.id)}>
                <h3 class="cf-section-title">{t(SECTION_LABEL[pane.id])}</h3>
                <Show
                  when={pane.id === "security"}
                  fallback={
                    <Show
                      when={pane.id === "ssh"}
                      fallback={
                        <For each={fieldRows(pane.fields)}>
                          {(row) => (
                            <div class="cf-row" classList={{ "is-pair": row.length > 1 }}>
                              <For each={row}>{field}</For>
                            </div>
                          )}
                        </For>
                      }
                    >
                      {sshPane(pane.fields)}
                    </Show>
                  }
                >
                  {securityPane(pane.fields)}
                </Show>
              </section>
            )}
          </For>

          <section class="cf-section" ref={registerPane("appearance")}>
            <h3 class="cf-section-title">{t("cform.section.appearance")}</h3>

            {/* Last, and optional: naming a connection before knowing what it
                connects to is the form asking for the one thing the user cannot
                answer yet. Left empty, it saves the deduced name. */}
            <label class="cf-field">
              <span class="cf-label">
                {t("cform.name")}
                <span class="cf-optional">{t("cform.optional")}</span>
              </span>
              <input
                type="text"
                value={draft.name}
                placeholder={deducedName() || t("cform.namePlaceholder")}
                onInput={(e) => setDraft("name", e.currentTarget.value)}
              />
            </label>

            <div class="cf-field">
              <span class="cf-label">{t("cform.color")}</span>
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
            <label class="cf-field">
              <span class="cf-label">
                {t("cform.group")}
                <span class="cf-optional">{t("cform.optional")}</span>
              </span>
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

            <div class="cf-field">
              <span class="cf-label">{t("cform.icon")}</span>
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
          </section>
        </div>

        {/* Sticky, so what you are building and whether it answers stay in sight
            while the form scrolls. */}
        <aside class="cf-side">
          <div class="cf-card">
            <h4 class="cf-card-title">{t("cform.preview")}</h4>
            <div class="cf-preview">
              <span
                class="cf-preview-accent"
                style={draft.color ? { background: draft.color } : undefined}
                aria-hidden="true"
              />
              <span class="cf-engine-mono" aria-hidden="true">
                {engineMonogram(draft.driver)}
              </span>
              <span class="cf-preview-text">
                <span class="cf-preview-name">
                  {draft.name.trim() || deducedName() || t("cform.unnamed")}
                </span>
                <span class="cf-preview-sub">
                  {DRIVER_SCHEMAS[draft.driver]?.label ?? draft.driver}
                  {connectionTarget(draft) ? ` · ${connectionTarget(draft)}` : ""}
                </span>
              </span>
            </div>
          </div>

          <div class="cf-card cf-test" data-state={test().kind}>
            <h4 class="cf-card-title">{t("cform.testTitle")}</h4>
            <Show when={test().kind === "idle"}>
              <p class="cf-test-line">{t("cform.testIdle")}</p>
            </Show>
            <Show when={test().kind === "testing"}>
              <p class="cf-test-line">{t("cform.testing")}</p>
            </Show>
            <Show when={test().kind === "ok"}>
              <p class="cf-test-line test-ok">
                {t("cform.testOkMs", { ms: (test() as { ms: number }).ms })}
              </p>
            </Show>
            <Show when={test().kind === "error"}>
              <p class="cf-test-line test-error">{(test() as { msg: string }).msg}</p>
              <Show when={(test() as { clientMissing?: boolean }).clientMissing}>
                {/* A button, not an <a>: the webview would navigate itself away;
                    openExternal hands the URL to the default browser. */}
                <button class="edit-btn" onClick={() => openExternal(INFORMIX_CSDK_URL)}>
                  {t("ifx.clientMissingLink")}
                </button>
              </Show>
            </Show>
            <Show when={tried() && !isValid(errors())}>
              <p class="cf-test-line test-error">{t("cform.saveBlocked", { detail: "" })}</p>
            </Show>
          </div>
        </aside>
      </div>

      {/* Outside the scrolling area: saving and testing are what the page is
          for, and having to scroll to reach them is how a long form loses you. */}
      <div class="cf-foot">
        <button onClick={runTest} disabled={test().kind === "testing"}>
          {test().kind === "testing" ? t("cform.testing") : t("cform.test")}
        </button>
        <span class="status-spacer" />
        <button onClick={props.onCancel}>{t("common.cancel")}</button>
        <button class={props.onSaveAndConnect ? "" : "primary"} onClick={save}>
          {t("cform.save")}
        </button>
        <Show when={props.onSaveAndConnect}>
          <button class="primary" onClick={saveAndConnect}>
            {t("cform.saveAndConnect")}
          </button>
        </Show>
      </div>
    </Panel>
  );
}
