import { For, Show, createEffect, createSignal, createUniqueId, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { placeBelow } from "../utils/popover";
import { stepIndex, typeAhead } from "../utils/listNav";

// The app's own <select> (issue #687): a WAI-ARIA select-only combobox. The
// trigger is a real <button role="combobox"> so a wrapping <label> still names
// it and Tab reaches it like any control; the list is a role="listbox" rendered
// in a portal, so it floats over modals and clipped panels alike. Focus never
// leaves the button — the active option is published through
// aria-activedescendant, as the APG pattern prescribes.
//
// Keyboard: Down/Up/Enter/Space/Alt+Down open; while open, Down/Up/Home/End/
// Page keys move, letters type ahead, Enter/Space/Tab choose, Escape cancels.
//
// ponytail: the list renders every option; the longest one in the app is a
// schema's table list (hundreds). Virtualize (utils/virtualize) if a list ever
// reaches thousands.

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  "aria-label"?: string;
  /** Shown on the button when `value` matches no option. */
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  title?: string;
  id?: string;
}

const TYPEAHEAD_RESET_MS = 500;

export function Dropdown(props: DropdownProps) {
  const uid = createUniqueId();
  const listId = `dd-list-${uid}`;
  const optId = (i: number) => `dd-opt-${uid}-${i}`;
  let button: HTMLButtonElement | undefined;
  let list: HTMLDivElement | undefined;

  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(-1);
  const [pos, setPos] = createSignal<{ x: number; y: number; w: number } | null>(null);
  let typed = "";
  let typedTimer: ReturnType<typeof setTimeout> | undefined;

  const selectedIndex = () => props.options.findIndex((o) => o.value === props.value);
  const current = () => props.options[selectedIndex()];
  const isDisabled = (i: number) => !!props.options[i]?.disabled;

  const place = () => {
    if (!button || !list) return;
    const a = button.getBoundingClientRect();
    const s = list.getBoundingClientRect();
    const p = placeBelow({
      anchor: a,
      size: { width: Math.max(s.width, a.width), height: s.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    setPos({ x: p.x, y: p.y, w: a.width });
  };

  const show = (at?: number) => {
    if (props.disabled || open()) return;
    const sel = selectedIndex();
    setActive(at ?? (sel >= 0 ? sel : stepIndex(props.options.length, -1, "ArrowDown", isDisabled)));
    setOpen(true);
    // The list is in the DOM only after this tick; measure then, before paint.
    queueMicrotask(place);
  };

  const close = () => {
    setOpen(false);
    setPos(null);
  };

  const choose = (i: number) => {
    const o = props.options[i];
    close();
    if (o && !o.disabled && o.value !== props.value) props.onChange(o.value);
    button?.focus();
  };

  const move = (i: number) => {
    if (i < 0) return;
    setActive(i);
    list?.children[i]?.scrollIntoView?.({ block: "nearest" });
  };

  const typeTo = (ch: string) => {
    if (typedTimer) clearTimeout(typedTimer);
    typed += ch;
    typedTimer = setTimeout(() => (typed = ""), TYPEAHEAD_RESET_MS);
    const i = typeAhead(props.options.map((o) => o.label), active(), typed, isDisabled);
    if (i >= 0) {
      if (open()) move(i);
      else choose(i);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (props.disabled) return;
    const n = props.options.length;
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    // Ctrl+Enter, Shift+Enter and friends belong to the panel around the
    // control (apply, add a row): only a bare key opens the list.
    if (!open()) {
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      switch (e.key) {
        case "ArrowDown":
        case "ArrowUp":
        case "Enter":
        case " ":
          e.preventDefault();
          show();
          return;
        case "Home":
        case "End":
          e.preventDefault();
          show(stepIndex(n, -1, e.key, isDisabled));
          return;
        default:
          if (printable) {
            e.preventDefault();
            typeTo(e.key);
          }
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
      case "Home":
      case "End":
      case "PageDown":
      case "PageUp":
        e.preventDefault();
        if (e.altKey && e.key === "ArrowUp") choose(active());
        else move(stepIndex(n, active(), e.key, isDisabled));
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(active());
        return;
      case "Tab":
        // Tab chooses and moves on, as a native select does with a typed value.
        choose(active());
        return;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      default:
        if (printable) {
          e.preventDefault();
          typeTo(e.key);
        }
    }
  };

  // While open: a mousedown elsewhere, a scroll outside the list or a resize
  // closes, exactly as the context menu does.
  createEffect(() => {
    if (!open()) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target;
      if (t instanceof Node && (button?.contains(t) || list?.contains(t))) return;
      close();
    };
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && list?.contains(e.target)) return;
      close();
    };
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    });
  });

  onCleanup(() => {
    if (typedTimer) clearTimeout(typedTimer);
  });

  return (
    <>
      <button
        type="button"
        ref={button}
        id={props.id}
        class={`dropdown ${props.class ?? ""}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-controls={open() ? listId : undefined}
        aria-activedescendant={open() && active() >= 0 ? optId(active()) : undefined}
        aria-label={props["aria-label"]}
        title={props.title}
        disabled={props.disabled}
        data-value={props.value}
        onClick={() => (open() ? close() : show())}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          // Focus moving into the list (a click on an option) is not a loss.
          if (!(e.relatedTarget instanceof Node && list?.contains(e.relatedTarget))) close();
        }}
      >
        <span class={`dropdown-text ${current() ? "" : "placeholder"}`}>
          {current()?.label ?? props.placeholder ?? ""}
        </span>
        <span class="dropdown-caret" aria-hidden="true" />
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={list}
            id={listId}
            class="dropdown-list"
            role="listbox"
            aria-label={props["aria-label"]}
            tabIndex={-1}
            style={{
              left: `${pos()?.x ?? 0}px`,
              top: `${pos()?.y ?? 0}px`,
              "min-width": `${pos()?.w ?? 0}px`,
              visibility: pos() ? "visible" : "hidden",
            }}
          >
            <For each={props.options}>
              {(o, i) => (
                <div
                  id={optId(i())}
                  role="option"
                  class={`dropdown-option ${i() === active() ? "active" : ""}`}
                  aria-selected={o.value === props.value}
                  aria-disabled={o.disabled || undefined}
                  data-value={o.value}
                  onMouseMove={() => !o.disabled && active() !== i() && setActive(i())}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => !o.disabled && choose(i())}
                >
                  {o.label}
                </div>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </>
  );
}
