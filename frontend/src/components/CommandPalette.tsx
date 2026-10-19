import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { t } from "../utils/i18n";
import {
  filterCommands,
  groupByCategory,
  inScope,
  nextScope,
  scopesFor,
  stepIndex,
  type Command,
  type PaletteScope,
} from "../utils/commandPalette";
import { keyLabel } from "../utils/shortcuts";

let paletteSeq = 0;

// Command palette overlay (issue #174). A lightweight, focused overlay — NOT a
// tool tab — is the right pattern here (the same justified exception as the
// context menu): it floats above everything, is keyboard-driven, and dismisses
// on Escape / outside click. Ctrl/Cmd+K (wired in App) toggles it. Filtering and
// grouping are pure (utils/commandPalette + utils/fuzzy); this component owns
// only the query text, the active-row index, and the keyboard/mouse wiring.
export function CommandPalette(props: {
  open: boolean;
  commands: Command[];
  /** Overrides the search input's placeholder (e.g. object-only mode). */
  placeholder?: string;
  /** Hints shown under the results (what Enter and its modifiers do). */
  footer?: string;
  /** Message when the palette opens with nothing to search (issue #320). */
  emptySetLabel?: string;
  onClose: () => void;
}) {
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  const [scope, setScope] = createSignal<PaletteScope>("all");
  let inputEl: HTMLInputElement | undefined;
  // ids for aria-controls / aria-activedescendant, unique per palette.
  const uid = `cmdk${++paletteSeq}`;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  const matched = createMemo(() => filterCommands(props.commands, query()));
  const scopes = createMemo(() => scopesFor(props.commands));
  const results = createMemo(() => matched().filter((c) => inScope(c, scope())));
  const countIn = (s: PaletteScope) => matched().filter((c) => inScope(c, s)).length;
  const groups = createMemo(() => groupByCategory(results()));
  // Visual (grouped) order is what the keyboard navigates, not the raw score
  // order — flatten the groups so the highlight matches what the user sees.
  const flat = createMemo(() => groups().flatMap((g) => g.items));
  const activeIndex = () => Math.min(active(), flat().length - 1);
  const activeId = () => flat()[activeIndex()]?.id;

  // Fresh state + focus every time the palette opens. The input lives inside the
  // Show, so it only exists once open; defer focus to a microtask so it runs
  // after the element has mounted.
  createEffect(() => {
    if (props.open) {
      setQuery("");
      setActive(0);
      setScope("all");
      queueMicrotask(() => inputEl?.focus());
    }
  });

  /** The highlighted command, whose body the preview pane shows. */
  const activeCmd = () => flat()[Math.min(active(), flat().length - 1)];

  const runAt = (index: number, alt?: "shift" | "mod") => {
    const cmd = flat()[index];
    // An unavailable command stays listed with its reason; it does not run.
    if (!cmd || cmd.disabled) return;
    props.onClose();
    // A command with no alternate activation runs its primary action whatever
    // the modifier — pressing Shift must never silently do nothing.
    if (alt && cmd.runAlt) cmd.runAlt(alt);
    else cmd.run();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => stepIndex(a, 1, flat().length));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => stepIndex(a, -1, flat().length));
        break;
      case "Enter":
        e.preventDefault();
        runAt(
          Math.min(active(), flat().length - 1),
          e.shiftKey ? "shift" : e.ctrlKey || e.metaKey ? "mod" : undefined,
        );
        break;
      case "Escape":
        e.preventDefault();
        props.onClose();
        break;
      case "Tab":
        // Tab moves between the scopes, not out of the dialog.
        if (scopes().length === 0) break;
        e.preventDefault();
        setScope((s) => nextScope(scopes(), s, e.shiftKey ? -1 : 1));
        setActive(0);
        break;
    }
  };

  // A second guard so Escape closes even if focus somehow leaves the input.
  const onDocKey = (e: KeyboardEvent) => {
    if (props.open && e.key === "Escape") props.onClose();
  };
  onMount(() => document.addEventListener("keydown", onDocKey));
  onCleanup(() => document.removeEventListener("keydown", onDocKey));

  return (
    <Show when={props.open}>
      <div class="cmdk-backdrop" onMouseDown={() => props.onClose()}>
        <div
          class="cmdk"
          role="dialog"
          aria-modal="true"
          aria-label={t("cmdk.title")}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            ref={inputEl}
            class="cmdk-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={`${uid}-list`}
            aria-activedescendant={flat().length > 0 ? optionId(activeIndex()) : undefined}
            placeholder={props.placeholder ?? t("cmdk.placeholder")}
            aria-label={t("cmdk.inputLabel")}
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <Show when={scopes().length > 0}>
            <div class="cmdk-scopes" role="tablist" aria-label={t("cmdk.scopes")}>
              <For each={scopes()}>
                {(s) => (
                  <button
                    type="button"
                    role="tab"
                    tabIndex={-1}
                    class="cmdk-scope"
                    classList={{ on: s === scope() }}
                    aria-selected={s === scope()}
                    aria-controls={`${uid}-list`}
                    onClick={() => {
                      setScope(s);
                      setActive(0);
                      inputEl?.focus();
                    }}
                  >
                    {t(`cmdk.scope.${s}`)} <span class="cmdk-scope-count">{countIn(s)}</span>
                  </button>
                )}
              </For>
              <span class="cmdk-scope-hint">{t("cmdk.scopeHint", { keys: keyLabel("Tab") })}</span>
            </div>
          </Show>
          <div class="cmdk-body">
          <div class="cmdk-results" id={`${uid}-list`} role="listbox" aria-label={t("cmdk.results")}>
            <Show
              when={flat().length > 0}
              fallback={
                <div class="cmdk-empty">
                  {props.commands.length === 0 && props.emptySetLabel
                    ? props.emptySetLabel
                    : t("cmdk.noResults")}
                </div>
              }
            >
              <For each={groups()}>
                {(g) => (
                  <div class="cmdk-group" role="group" aria-labelledby={`${uid}-g-${g.category}`}>
                    <div class="cmdk-group-label" id={`${uid}-g-${g.category}`}>
                      {g.label}
                    </div>
                    <For each={g.items}>
                      {(c) => {
                        const index = () => flat().findIndex((x) => x.id === c.id);
                        return (
                          <div
                            id={optionId(index())}
                            role="option"
                            class={`cmdk-item ${c.id === activeId() ? "active" : ""}`}
                            aria-selected={c.id === activeId()}
                            aria-disabled={c.disabled ? "true" : undefined}
                            onMouseEnter={() => setActive(index())}
                            onClick={() => runAt(index())}
                          >
                            <span class="cmdk-item-label">{c.label}</span>
                            <Show when={c.disabled ?? c.hint}>
                              {(text) => (
                                <span class="cmdk-item-hint">
                                  {c.disabled ? t("cmdk.unavailable", { reason: text() }) : text()}
                                </span>
                              )}
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                )}
              </For>
            </Show>
          </div>
          <Show when={activeCmd()?.preview}>
            {(body) => <pre class="cmdk-preview">{body()}</pre>}
          </Show>
          </div>
          <Show when={props.footer}>
            <div class="cmdk-footer">{props.footer}</div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
