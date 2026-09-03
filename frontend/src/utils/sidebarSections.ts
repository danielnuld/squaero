// Sidebar explorer state when several connections are open (issue #444). The
// sidebar shows one collapsible section per open connection, so two pieces of
// state stop being global: which sections are collapsed, and the objects each
// connection's tree has loaded (one shared list meant the last tree to load
// overwrote the autocomplete and the command palette). Pure and testable; the
// component only holds the signal.

/** Collapse or expand one connection's section, returning a new set. */
export function toggleSection(
  collapsed: ReadonlySet<string>,
  defId: string,
): Set<string> {
  const next = new Set(collapsed);
  if (!next.delete(defId)) next.add(defId);
  return next;
}

/** The objects one connection's tree has loaded, or none. */
export function connObjects<T>(
  map: Readonly<Record<string, T[]>>,
  defId: string | null,
): T[] {
  return (defId && map[defId]) || [];
}

/** Record the objects a connection's tree just loaded. */
export function setConnObjects<T>(
  map: Readonly<Record<string, T[]>>,
  defId: string,
  objects: T[],
): Record<string, T[]> {
  return { ...map, [defId]: objects };
}

/** Forget a connection's objects — it was closed, and its entry would otherwise
    outlive it (and reappear stale if the same connection is opened again). */
export function dropConnObjects<T>(
  map: Readonly<Record<string, T[]>>,
  defId: string,
): Record<string, T[]> {
  if (map[defId] === undefined) return map as Record<string, T[]>;
  const next = { ...map };
  delete next[defId];
  return next;
}
