import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import {
  filterCommands,
  groupByCategory,
  stepIndex,
  type Command,
} from "../utils/commandPalette";

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
  onClose: () => void;
}) {
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  let inputEl: HTMLInputElement | undefined;

  const results = createMemo(() => filterCommands(props.commands, query()));
  const groups = createMemo(() => groupByCategory(results()));
  // Visual (grouped) order is what the keyboard navigates, not the raw score
  // order — flatten the groups so the highlight matches what the user sees.
  const flat = createMemo(() => groups().flatMap((g) => g.items));
  const activeId = () => flat()[Math.min(active(), flat().length - 1)]?.id;

  // Fresh state + focus every time the palette opens. The input lives inside the
  // Show, so it only exists once open; defer focus to a microtask so it runs
  // after the element has mounted.
  createEffect(() => {
    if (props.open) {
      setQuery("");
      setActive(0);
      queueMicrotask(() => inputEl?.focus());
    }
  });

  const runAt = (index: number) => {
    const cmd = flat()[index];
    if (!cmd) return;
    props.onClose();
    cmd.run();
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
        runAt(Math.min(active(), flat().length - 1));
        break;
      case "Escape":
        e.preventDefault();
        props.onClose();
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
        <div class="cmdk" role="dialog" aria-label="Paleta de comandos" onMouseDown={(e) => e.stopPropagation()}>
          <input
            ref={inputEl}
            class="cmdk-input"
            type="text"
            placeholder={props.placeholder ?? "Buscar herramientas, objetos, snippets, historial…"}
            aria-label="Buscar comandos"
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <div class="cmdk-results">
            <Show
              when={flat().length > 0}
              fallback={<div class="cmdk-empty">Sin resultados</div>}
            >
              <For each={groups()}>
                {(g) => (
                  <div class="cmdk-group">
                    <div class="cmdk-group-label">{g.label}</div>
                    <For each={g.items}>
                      {(c) => (
                        <button
                          class={`cmdk-item ${c.id === activeId() ? "active" : ""}`}
                          onMouseEnter={() =>
                            setActive(flat().findIndex((x) => x.id === c.id))
                          }
                          onClick={() =>
                            runAt(flat().findIndex((x) => x.id === c.id))
                          }
                        >
                          <span class="cmdk-item-label">{c.label}</span>
                          <Show when={c.hint}>
                            <span class="cmdk-item-hint">{c.hint}</span>
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
