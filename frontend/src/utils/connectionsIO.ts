// Import/export of saved connections (issue #188). Backing up, sharing and
// migrating connections between machines. Security is the point: by default the
// export OMITS passwords (the JSON carries host/port/user/db/driver; passwords
// are entered at connect time). Including passwords is an explicit, warned opt-in
// that writes them in plaintext. The file is versioned so future changes stay
// tolerant. All pure and unit-tested; the component just saves/loads the text.

import {
  applyCredentials,
  detectForeign,
  parseForeign,
  type ForeignSource,
  type SkippedConnection,
} from "./foreignConnections";
import { dbeaverCredentials } from "./foreignSecrets";
import {
  CONNECTIONS_FILE_VERSION,
  driverSchema,
  mergeConnections,
  parseConnectionsFile,
  stripSecrets,
  type Connection,
  type MergeSummary,
} from "./connections";

export { CONNECTIONS_FILE_VERSION };

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

export interface ImportSummary extends MergeSummary {
  /** Set when the file came from another tool (DBeaver, Navicat). */
  source?: ForeignSource;
  /** Entries from another tool whose engine Squaero does not ship. */
  unsupported?: SkippedConnection[];
  /** Passwords brought across from the other tool. */
  passwords?: number;
  /** Passwords the other tool had but this could not read. */
  locked?: number;
}

export interface ImportOutcome {
  list: Connection[];
  summary: ImportSummary;
}

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
export async function importConnections(
  existing: Connection[],
  raw: string,
  /** DBeaver's `credentials-config.json`, when the user picked it too. */
  credentials?: ArrayBuffer,
): Promise<ImportOutcome | { error: string }> {
  // Another tool's file is recognised by its content, not its extension:
  // DBeaver writes `.json` like we do, and people rename things.
  const foreign = detectForeign(raw);
  let incoming: unknown[];
  const summary: ImportSummary = { added: 0, updated: 0, skipped: 0 };

  if (foreign) {
    let parsed = await parseForeign(raw, foreign);
    if ("error" in parsed) return parsed;
    if (credentials && foreign === "dbeaver") {
      parsed = applyCredentials(parsed, await dbeaverCredentials(credentials));
    }
    incoming = parsed.connections;
    summary.source = foreign;
    summary.unsupported = parsed.skipped;
    summary.passwords = parsed.connections.filter((c) => !!c.params.password).length;
    // What the other tool had locked away and we could not open: an old Navicat
    // file, or a DBeaver export whose credentials file was not picked.
    summary.locked =
      parsed.locked +
      (foreign === "dbeaver" && !credentials
        ? parsed.connections.filter((c) => !c.params.password).length
        : 0);
  } else {
    const native = parseConnectionsFile(raw);
    if ("error" in native) return native;
    incoming = native;
  }

  const merged = mergeConnections(existing, incoming, !!foreign);
  Object.assign(summary, merged.summary);
  return { list: merged.list, summary };
}

/** A short human summary line for the import result. */
export function summaryText(s: ImportSummary): string {
  const line = `Añadidas ${s.added} · actualizadas ${s.updated} · omitidas ${s.skipped}`;
  if (!s.source) return line;
  const tool = s.source === "dbeaver" ? "DBeaver" : "Navicat";
  const parts = [`${tool}: ${line}`];
  // Which passwords came and which did not, because finding that out at the
  // first failed connect is the expensive way to learn it.
  if (s.passwords) parts.push(`${s.passwords} con contraseña`);
  if (s.locked) parts.push(`${s.locked} sin contraseña`);
  const unsupported = s.unsupported ?? [];
  if (unsupported.length > 0) {
    const engines = [...new Set(unsupported.map((u) => u.reason))].join(", ");
    parts.push(`${unsupported.length} con motor no soportado (${engines})`);
  }
  return parts.join(" · ");
}
