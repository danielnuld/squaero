import { Index, type JSX } from "solid-js";
import { stepIndex } from "../utils/listNav";

export interface SegmentedOption<T> {
  value: T;
  label: JSX.Element;
  title?: string;
  disabled?: boolean;
}

/** Arrow keys of a horizontal radio group, as the list navigation spells them. */
const STEP: Record<string, string> = {
  ArrowRight: "ArrowDown",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowUp",
  ArrowUp: "ArrowUp",
  Home: "Home",
  End: "End",
};

/**
 * The one segmented control (R-29): a WAI-ARIA radio group. Only the checked
 * option is in the Tab order (roving tabindex); the arrows move the choice and
 * the focus together, wrapping and skipping disabled options; Home/End jump to
 * the ends.
 */
export function Segmented<T>(props: {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Extra classes on the group. */
  class?: string;
}) {
  const checked = () => props.options.findIndex((o) => o.value === props.value);
  /** The option that takes the Tab stop: the checked one, else the first enabled. */
  const tabStop = () => {
    const i = checked();
    return i >= 0 && !props.options[i].disabled ? i : stepIndex(props.options.length, -1, "Home", (n) => !!props.options[n].disabled);
  };
  let group: HTMLDivElement | undefined;
  const onKeyDown = (e: KeyboardEvent) => {
    const key = STEP[e.key];
    if (!key) return;
    e.preventDefault();
    const next = stepIndex(props.options.length, tabStop(), key, (n) => !!props.options[n].disabled);
    if (next < 0) return;
    props.onChange(props.options[next].value);
    group?.querySelectorAll<HTMLElement>("[role=radio]")[next]?.focus();
  };
  return (
    <div
      ref={group}
      class={`seg${props.class ? ` ${props.class}` : ""}`}
      role="radiogroup"
      aria-label={props.label}
      onKeyDown={onKeyDown}
    >
      {/* Index, not For: the options are rebuilt on every read (labels follow
          the language), and the buttons — and the focus — must survive that. */}
      <Index each={props.options}>
        {(o, i) => (
          <button
            type="button"
            role="radio"
            class="seg-btn"
            classList={{ on: i === checked() }}
            aria-checked={i === checked()}
            tabIndex={i === tabStop() ? 0 : -1}
            disabled={o().disabled}
            title={o().title}
            onClick={() => props.onChange(o().value)}
          >
            {o().label}
          </button>
        )}
      </Index>
    </div>
  );
}
