// What an executed statement does to the server BEYOND returning rows, so the UI
// can react to it (issue #317). Today that is one question: did it change the
// object catalog, so the object tree is now stale?
//
// Only the GUI tools (table designer, index manager, structure view) told the
// tree to reload; SQL typed in the editor never did — and the editor is the only
// way to create a stored routine, which is how this surfaced. Engine-neutral: it
// looks at the leading verb of each statement, which is the same on every engine
// Squaero speaks.

import { scrub } from "./queryTarget";

/** Verbs that add, remove or reshape a catalog object. */
const CATALOG_VERB = /(?:^|;)\s*(create|drop|alter|rename|truncate)\b/i;

/**
 * True when running `sql` may have changed what the object tree shows: any of
 * its statements starts with a catalog verb. Comments and string literals are
 * stripped first, so a `SELECT 'drop table x'` does not count. Pure.
 */
export function changesCatalog(sql: string): boolean {
  return CATALOG_VERB.test(scrub(sql));
}
