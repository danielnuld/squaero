import { For, Show, createSignal, onCleanup, type JSX } from "solid-js";
import { t } from "../utils/i18n";
import { formatElapsed } from "../utils/duration";
import { etaParts, progressFacts } from "../utils/progress";
import { copyText } from "../utils/rowCopy";
import { Icon } from "./icons";

/** One failure seen so far: where (a row number, a statement, an object) and why. */
export interface RunError {
  where: string;
  message: string;
}

/**
 * A long wizard run on screen (R-01, issue #692): what it does, a determinate
 * bar with «2140 de 4812 filas · 44 % · quedan unos 8 s», the counters, the
 * clock, and the errors as they happen — never a dead screen. The wizard's
 * footer carries the Cancelar; this view only reports.
 */
export function RunProgress(props: {
  title: string;
  done: number;
  /** null: not known yet, the bar is indeterminate. */
  total: number | null;
  /** «filas», «tablas», «sentencias»: the catalog base of `prog.of`. */
  unit: "rows" | "tables" | "statements" | "objects";
  startedAt: number;
  /** Counters under the bar: «2138 insertadas», «2 con error, omitidas». */
  counts?: { label: string; tone?: "ok" | "error" }[];
  errors?: RunError[];
  /** What the error policy does with a failure, said beside the list. */
  errorPolicy?: string;
  /** One line at the bottom: what Cancelar does (rolls back, deletes the file). */
  note?: string;
  children?: JSX.Element;
}) {
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(timer));

  const elapsed = () => Math.max(0, now() - props.startedAt);
  const facts = () => progressFacts(props.done, props.total, elapsed());
  const line = () => {
    const f = facts();
    const parts = [
      props.total === null
        ? t(`prog.done.${props.unit}`, { done: props.done })
        : t(`prog.of.${props.unit}`, { done: props.done, total: props.total }),
    ];
    if (f.percent !== null) parts.push(`${f.percent} %`);
    if (f.etaMs !== null && f.remaining) {
      const e = etaParts(f.etaMs);
      parts.push(t(`prog.eta.${e.unit}`, { n: e.n }));
    }
    return parts.join(" · ");
  };
  const errors = () => props.errors ?? [];

  return (
    <section class="run-progress" aria-label={props.title}>
      <h3>{props.title}</h3>
      <div
        class={facts().percent === null ? "app-toast-bar indeterminate" : "app-toast-bar"}
        role="progressbar"
        aria-label={props.title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={facts().percent ?? undefined}
      >
        <span class="app-toast-bar-fill" style={facts().percent === null ? undefined : { width: `${facts().percent}%` }} />
      </div>
      <p class="run-progress-line" role="status">
        {line()}
      </p>
      <p class="run-progress-counts">
        <For each={props.counts ?? []}>
          {(c) => <span class={c.tone === "error" ? "run-count is-error" : "run-count"}>{c.label}</span>}
        </For>
        <span class="run-count">{t("prog.elapsed", { time: formatElapsed(elapsed()) })}</span>
      </p>
      {props.children}
      <Show when={errors().length > 0}>
        <div class="run-errors">
          <div class="run-errors-head">
            <strong>{t("prog.errorsSoFar", { n: errors().length })}</strong>
            <Show when={props.errorPolicy}>
              <span class="help">{props.errorPolicy}</span>
            </Show>
            <span class="toolbar-spacer" />
            <button
              type="button"
              class="btn"
              onClick={() => copyText(errors().map((e) => `${e.where}\t${e.message}`).join("\n"))}
            >
              <Icon name="copy" size={14} />
              {t("prog.copyErrors")}
            </button>
          </div>
          <ul class="import-errors">
            {/* The first hundred: enough to see the pattern; Copiar has them all. */}
            <For each={errors().slice(0, 100)}>
              {(e) => (
                <li>
                  {e.where}: {e.message}
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
      <Show when={props.note}>
        <p class="help">{props.note}</p>
      </Show>
    </section>
  );
}
