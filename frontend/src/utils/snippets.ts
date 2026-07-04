// Favorites / snippets model (issue #129): named, reusable SQL fragments the
// user can save and insert into the editor. Pure logic — CRUD over the list,
// import-merge, cursor insertion and (de)serialization; persistence lives in
// snippetStore.ts and the panel in components/SnippetsPanel.tsx. Client-side
// only, like saved connections and query history.

export interface Snippet {
  /** Stable id of the form "snip-N". */
  id: string;
  /** Display name (a "favorite" is just a named query). */
  name: string;
  /** The SQL text inserted at the cursor / loaded into the editor. */
  body: string;
}

/** Next snippet id of the form "snip-N", unique within `list`. */
export function nextSnippetId(list: Snippet[]): string {
  const max = list.reduce((acc, s) => {
    const m = /^snip-(\d+)$/.exec(s.id);
    return m ? Math.max(acc, Number(m[1])) : acc;
  }, 0);
  return `snip-${max + 1}`;
}

/**
 * Append a new snippet (name trimmed, body kept verbatim). A blank name or body
 * is rejected — the list is returned unchanged. Returns a new array.
 */
export function addSnippet(list: Snippet[], name: string, body: string): Snippet[] {
  const n = name.trim();
  if (!n || !body.trim()) return list;
  return [...list, { id: nextSnippetId(list), name: n, body }];
}

/** Rename a snippet by id; a blank name is ignored. Returns a new array. */
export function renameSnippet(list: Snippet[], id: string, name: string): Snippet[] {
  const n = name.trim();
  if (!n) return list;
  return list.map((s) => (s.id === id ? { ...s, name: n } : s));
}

/** Remove a snippet by id. Returns a new array. */
export function removeSnippet(list: Snippet[], id: string): Snippet[] {
  return list.filter((s) => s.id !== id);
}

/**
 * Merge imported snippets into the current set: each incoming snippet is added
 * with a freshly-allocated id (so ids never collide), skipping any that already
 * exist verbatim (same name + body). Returns the merged array.
 */
export function mergeSnippets(current: Snippet[], incoming: Snippet[]): Snippet[] {
  const out = [...current];
  for (const s of incoming) {
    const name = s.name?.trim();
    if (!name || typeof s.body !== "string" || !s.body.trim()) continue;
    if (out.some((e) => e.name === name && e.body === s.body)) continue;
    out.push({ id: nextSnippetId(out), name, body: s.body });
  }
  return out;
}

/**
 * Replace the range [from, to) of `doc` with `insert`, returning the new text
 * and the cursor offset just after the inserted text. Used to drop a snippet in
 * at the editor's selection/cursor.
 */
export function insertIntoText(
  doc: string,
  from: number,
  to: number,
  insert: string,
): { text: string; cursor: number } {
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(doc.length, Math.max(from, to));
  return { text: doc.slice(0, a) + insert + doc.slice(b), cursor: a + insert.length };
}

/** Serialize for storage / export. */
export function serializeSnippets(list: Snippet[]): string {
  return JSON.stringify(list, null, 2);
}

/** Parse stored/imported snippets, dropping malformed entries. [] on garbage. */
export function parseSnippets(raw: string | null): Snippet[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: Snippet[] = [];
  for (const item of data) {
    const s = item as Partial<Snippet>;
    if (typeof s?.id === "string" && typeof s?.name === "string" && typeof s?.body === "string") {
      out.push({ id: s.id, name: s.name, body: s.body });
    }
  }
  return out;
}
