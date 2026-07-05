// Import/export of saved connections (issue #188). Backing up, sharing and
// migrating connections between machines. Security is the point: by default the
// export OMITS passwords (the JSON carries host/port/user/db/driver; passwords
// are entered at connect time). Including passwords is an explicit, warned opt-in
// that writes them in plaintext. The file is versioned so future changes stay
// tolerant. All pure and unit-tested; the component just saves/loads the text.

import {
  driverSchema,
  stripSecrets,
  validateConnection,
  nextConnectionId,
  coerceConnection,
  type Connection,
} from "./connections";

/** Current on-disk format version. */
export const CONNECTIONS_FILE_VERSION = 1;

export interface ConnectionsFile {
  version: number;
  connections: Connection[];
}

/** A connection with its secret (password) fields removed for export. */
function withoutSecrets(c: Connection): Connection {
  const schema = driverSchema(c.driver);
  if (schema) return stripSecrets(c, schema);
  // Unknown driver (no schema to identify secrets) — effectively unreachable
  // since connections can only be created for a known driver, but fail toward
  // safety anyway: drop any field whose name looks remotely like a credential.
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.params)) {
    if (!/pass|pwd|secret|passphrase|token|credential|apikey|api_key/i.test(k)) params[k] = v;
  }
  return { ...c, params };
}

/**
 * Serialize connections to the versioned export format. When `includePasswords`
 * is false (the default the caller should offer), every secret field is stripped
 * first, so the file is safe to share.
 */
export function exportConnections(list: Connection[], includePasswords: boolean): string {
  const connections = includePasswords ? list : list.map(withoutSecrets);
  const file: ConnectionsFile = { version: CONNECTIONS_FILE_VERSION, connections };
  return JSON.stringify(file, null, 2);
}

export interface ImportSummary {
  /** New connections appended. */
  added: number;
  /** Existing connections replaced (matched by id+name or by name). */
  updated: number;
  /** Malformed/invalid entries dropped. */
  skipped: number;
}

export interface ImportOutcome {
  list: Connection[];
  summary: ImportSummary;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Merge the connections from an export file into `existing`. Returns the new list
 * and a summary, or an `{ error }` for a malformed/unsupported file.
 *
 * Merge rules (no duplicates):
 *  - An imported connection whose id matches an existing one with the SAME name
 *    replaces it in place (updated).
 *  - Otherwise, if its (case-insensitive) name matches an existing connection, it
 *    replaces that one, keeping the existing id (updated).
 *  - Otherwise it is added as new; if its id collides with an existing id it gets
 *    a freshly generated one, so imported ids never clobber unrelated entries.
 *  - Entries that are malformed or fail validation (unknown driver, missing
 *    required field, blank name) are skipped.
 */
export function importConnections(
  existing: Connection[],
  raw: string,
): ImportOutcome | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: "El archivo no es JSON válido." };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { error: "Formato de archivo no reconocido." };
  }
  const version = (data as { version?: unknown }).version;
  if (version !== CONNECTIONS_FILE_VERSION) {
    return { error: `Versión de archivo no soportada (${String(version ?? "desconocida")}).` };
  }
  const incoming = (data as { connections?: unknown }).connections;
  if (!Array.isArray(incoming)) {
    return { error: "El archivo no contiene una lista de conexiones." };
  }

  let list = existing.slice();
  const summary: ImportSummary = { added: 0, updated: 0, skipped: 0 };

  for (const item of incoming) {
    const c = coerceConnection(item);
    if (!c || validateConnection(c).length > 0) {
      summary.skipped += 1;
      continue;
    }
    const byId = c.id.trim() ? list.find((e) => e.id === c.id) : undefined;
    if (byId && norm(byId.name) === norm(c.name)) {
      list = list.map((e) => (e.id === byId.id ? { ...c, id: byId.id } : e));
      summary.updated += 1;
      continue;
    }
    // Match by name (the user's label). If duplicate names already exist in the
    // list, the first is updated — name uniqueness isn't enforced elsewhere.
    const byName = list.find((e) => norm(e.name) === norm(c.name));
    if (byName) {
      list = list.map((e) => (e.id === byName.id ? { ...c, id: byName.id } : e));
      summary.updated += 1;
      continue;
    }
    // Add as new. A blank or colliding incoming id is regenerated so a stored
    // connection never ends up with a blank/duplicate id.
    const id = !c.id.trim() || list.some((e) => e.id === c.id) ? nextConnectionId(list) : c.id;
    list = [...list, { ...c, id }];
    summary.added += 1;
  }

  return { list, summary };
}

/** A short human summary line for the import result. */
export function summaryText(s: ImportSummary): string {
  return `Añadidas ${s.added} · actualizadas ${s.updated} · omitidas ${s.skipped}`;
}
