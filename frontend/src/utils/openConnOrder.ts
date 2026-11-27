// The explorer's open connections (issue #824): grouped by their saved
// connection group and reorderable by the user.
//
// The grouping follows the connection manager's (groupConnections): the
// ungrouped first, with no heading — so whoever never uses groups sees the
// explorer as before — then each named group in alphabetical order. Inside a
// group the sections keep the order of the open list, which is what dragging
// a section changes. A section only moves inside its own group: the group it
// belongs to is a property of the saved connection, edited in the manager.

import { groupConnections, type Connection, type ConnectionGroup } from "./connections";

/** One heading's sections; `name` null is the ungrouped bucket, drawn without one. */
export type OpenGroup<T> = ConnectionGroup<T>;

/** The open connections split into their saved groups. Pure. */
export function groupOpenConns<T extends { defId: string }>(
  open: readonly T[],
  saved: readonly Connection[],
): OpenGroup<T>[] {
  const byId = new Map(saved.map((c) => [c.id, c]));
  // A section whose saved connection is gone (deleted while open) is ungrouped.
  const tagged = open.map((conn) => ({ conn, group: byId.get(conn.defId)?.group }));
  return groupConnections(tagged).map((g) => ({ name: g.name, conns: g.conns.map((x) => x.conn) }));
}

/** The group name `defId` falls in ("" = ungrouped), or null if not open. */
function groupOf<T extends { defId: string }>(groups: OpenGroup<T>[], defId: string): string | null {
  const g = groups.find((x) => x.conns.some((c) => c.defId === defId));
  return g ? (g.name ?? "") : null;
}

/** Whether `from` may be dropped on `onto`: both open and in the same group. Pure. */
export function canDropOn<T extends { defId: string }>(
  groups: OpenGroup<T>[],
  from: string,
  onto: string,
): boolean {
  const a = groupOf(groups, from);
  return a !== null && from !== onto && a === groupOf(groups, onto);
}

/**
 * Moves the open connection `from` to where `onto` sits in the open list: after
 * it when coming from above, before it when coming from below (the same rule as
 * a tab). Anything else — unknown ids, different groups — leaves it. Pure.
 */
export function moveOpenConn<T extends { defId: string }>(
  open: readonly T[],
  saved: readonly Connection[],
  from: string,
  onto: string,
): T[] {
  if (!canDropOn(groupOpenConns(open, saved), from, onto)) return [...open];
  const next = [...open];
  const i = next.findIndex((o) => o.defId === from);
  const to = next.findIndex((o) => o.defId === onto);
  const [moved] = next.splice(i, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The section `dir` steps from `defId` inside its group (Alt+↑/↓), or null. Pure. */
export function neighborInGroup<T extends { defId: string }>(
  groups: OpenGroup<T>[],
  defId: string,
  dir: 1 | -1,
): string | null {
  for (const g of groups) {
    const i = g.conns.findIndex((c) => c.defId === defId);
    if (i >= 0) return g.conns[i + dir]?.defId ?? null;
  }
  return null;
}
