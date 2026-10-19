// Busy tool tabs (M14 P6): a tool working on something shows the tab spinner a
// running query shows, and a job that ends in a tab the user has left is
// announced. A tool panel is unmounted when its tab is not the active one, but
// its async work goes on and still flips the component's signals; so each
// Panel registers a getter over its own busy state, and a busy getter outlives
// the panel until it reads false. One root effect watches them all.

import { createContext, createEffect, createMemo, createRoot, createSignal } from "solid-js";

/** The tool tab a panel is drawn in; App provides it around the tool panes. */
export const ToolTabContext = createContext<number | undefined>(undefined);

type Getter = () => boolean;
const [watched, setWatched] = createSignal<ReadonlyMap<number, Getter>>(new Map());

/** Tool tab ids with work in progress. */
export const busyTools = createRoot(() =>
  createMemo(() => {
    const ids = new Set<number>();
    for (const [id, busy] of watched()) if (busy()) ids.add(id);
    return ids;
  }),
);

let onFinish: (id: number, ms: number) => void = () => {};
/** Called with the tab id and how long the job took whenever one ends. */
export function onToolJobFinished(fn: (id: number, ms: number) => void): void {
  onFinish = fn;
}

/** Tabs whose getter outlived their panel: dropped once they are done. */
const orphans = new Set<number>();

createRoot(() => {
  const since = new Map<number, number>();
  createEffect(() => {
    const now = busyTools();
    for (const id of now) if (!since.has(id)) since.set(id, Date.now());
    for (const [id, at] of [...since]) {
      if (now.has(id)) continue;
      since.delete(id);
      if (orphans.delete(id)) unwatch(id);
      onFinish(id, Date.now() - at);
    }
  });
});

function unwatch(id: number) {
  setWatched((m) => {
    const next = new Map(m);
    next.delete(id);
    return next;
  });
}

/**
 * Watches one panel's busy state for its tab. The returned release is for the
 * panel's cleanup: an idle panel lets go at once, a busy one is kept until its
 * job ends. A panel mounted again for the same tab takes the slot over.
 */
export function watchToolBusy(id: number, busy: Getter): () => void {
  orphans.delete(id);
  setWatched((m) => new Map(m).set(id, busy));
  return () => {
    if (watched().get(id) !== busy) return; // already taken over
    if (busy()) orphans.add(id);
    else unwatch(id);
  };
}
