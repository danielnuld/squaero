// Finding a saved connection to open (issue #525). The bar's list is what is
// already open; opening another one goes through a search, because a list of
// <details> groups is no way to find one connection among thirty imported from
// DBeaver.
//
// Pure: the component renders what searchGroups returns. The engine's label is
// injected (labelOf) rather than read here — this module must not know the
// locale, like the rest of connections.ts.

import { connectionTarget, groupConnections, type Connection } from "./connections";

/** One connection as the search offers it. */
export interface SearchHit {
  conn: Connection;
  /** Already open: picking it only focuses it, it does not open a second session. */
  isOpen: boolean;
  /** Where it points, the same line the bar shows under the name. */
  target: string;
}

/** Connections that matched, grouped as the sidebar groups them. */
export interface SearchGroup {
  /** The group's label, or null for the ungrouped bucket. */
  name: string | null;
  hits: SearchHit[];
}

/**
 * Fold case and strip diacritics, so "nomina" finds "Nómina".
 *
 * NFD splits an accented letter into letter + combining mark, and the range
 * below is those marks; without this, a Spanish name is only findable by
 * someone willing to type the accent.
 */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Whether a connection matches `query`, over its name, engine label, target and
 * group. An empty query matches everything (the search opens showing the whole
 * list). Every term has to appear somewhere, so "mysql prod" narrows instead of
 * widening.
 */
export function matchesConnection(
  conn: Connection,
  query: string,
  engineLabel: string,
): boolean {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = fold(
    [conn.name, engineLabel, conn.driver, connectionTarget(conn), conn.group ?? ""].join(" "),
  );
  return terms.every((t) => haystack.includes(t));
}

/**
 * The matches, grouped in the order the sidebar already uses (ungrouped first,
 * then groups alphabetically) so the search reads like the list it replaces.
 * Empty groups are dropped; a group with no matches is noise.
 */
export function searchGroups(
  conns: readonly Connection[],
  query: string,
  openIds: readonly string[],
  labelOf: (driver: string) => string,
): SearchGroup[] {
  const open = new Set(openIds);
  const kept = conns.filter((c) => matchesConnection(c, query, labelOf(c.driver)));
  return groupConnections([...kept])
    .map((g) => ({
      name: g.name,
      hits: g.conns.map((conn) => ({
        conn,
        isOpen: open.has(conn.id),
        target: connectionTarget(conn),
      })),
    }))
    .filter((g) => g.hits.length > 0);
}
