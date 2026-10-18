// Dump a schema's DDL to a folder, one .sql file per object (issue #673), so the
// schema can be versioned in git.
//
// The output must be deterministic — same schema, same files, byte for byte — so
// everything here is pure and ordered by code unit, never by locale: the names,
// the collision suffixes, the line endings and the zip's timestamps. The
// component gathers the DDL over IPC (schema.ddl for tables and views, the
// catalog queries of routines.ts/triggers.ts for the rest) and hands it in.

import { zipSync, strToU8 } from "fflate";
import { ddlStatement } from "./backup";

/** What the dump can obtain, in folder order. */
export type DdlKind = "table" | "view" | "procedure" | "function" | "trigger" | "event";

/** The folder each kind goes in. */
export const FOLDERS: Record<DdlKind, string> = {
  table: "tables",
  view: "views",
  procedure: "procedures",
  function: "functions",
  trigger: "triggers",
  event: "events",
};
const ORDER = Object.keys(FOLDERS) as DdlKind[];

/** An object and its DDL, or why there is none. */
export interface DdlObject {
  kind: DdlKind;
  name: string;
  /** The CREATE statement; null when it could not be read (see `reason`). */
  ddl: string | null;
  reason?: string;
}

export interface DumpFile {
  path: string;
  content: string;
}

export interface SkippedObject {
  kind: DdlKind;
  name: string;
  /** Why it could not be read; absent when the engine sent an empty DDL. */
  reason?: string;
}

export interface DumpPlan {
  files: DumpFile[];
  skipped: SkippedObject[];
}

/** A name Windows reserves for a device, whatever the extension after it. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** Long names are cut so the full path stays well under Windows' 255 per segment. */
const MAX_NAME = 120;

/**
 * A file name (without extension) that every OS accepts for `name`: characters
 * Windows forbids become `_`, as do trailing dots and spaces (Windows drops them,
 * which would merge `a.` into `a`), device names get a `_` prefix, unicode is
 * NFC (macOS stores NFD; the same name must give the same bytes) and the result
 * is cut at MAX_NAME code points. Never empty.
 */
export function safeFileName(name: string): string {
  let s = name.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_");
  s = Array.from(s).slice(0, MAX_NAME).join("");
  s = s.replace(/[. ]+$/, (m) => "_".repeat(m.length));
  if (RESERVED.test(s)) s = `_${s}`;
  return s || "_";
}

/** Code-unit order: the same on every machine, unlike localeCompare. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The statement as it goes in a file: LF line endings, one `;`, one trailing newline. */
export function normalizeDdl(ddl: string): string {
  return ddlStatement(ddl.replace(/\r\n?/g, "\n")) + "\n";
}

/**
 * The files to write, sorted by path, and the objects left out with the reason.
 * Objects are ordered by kind, then name, then DDL (overloaded routines share a
 * name), so names that clash once made safe — `Users` and `users` on a
 * case-insensitive disk, `a/b` and `a_b` — are told apart the same way every
 * time: the first keeps the name, the next get `~2`, `~3`…
 */
export function planDdlDump(objects: DdlObject[]): DumpPlan {
  const sorted = [...objects].sort(
    (a, b) =>
      ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) ||
      cmp(a.name, b.name) ||
      cmp(a.ddl ?? "", b.ddl ?? ""),
  );
  const taken = new Set<string>();
  const files: DumpFile[] = [];
  const skipped: SkippedObject[] = [];
  for (const o of sorted) {
    if (o.ddl === null || !o.ddl.trim()) {
      skipped.push({ kind: o.kind, name: o.name, reason: o.reason });
      continue;
    }
    const base = `${FOLDERS[o.kind]}/${safeFileName(o.name)}`;
    let path = `${base}.sql`;
    for (let n = 2; taken.has(path.toLowerCase()); n++) path = `${base}~${n}.sql`;
    taken.add(path.toLowerCase());
    files.push({ path, content: normalizeDdl(o.ddl) });
  }
  files.sort((a, b) => cmp(a.path, b.path));
  return { files, skipped };
}

/** One job of the dump: an object and how to read its DDL. */
export interface DdlJob {
  kind: DdlKind;
  name: string;
  read: () => Promise<string>;
}

/**
 * Read every job's DDL, one at a time. A failure does not stop the dump: the
 * object comes back with ddl null and the error's text, so the summary says what
 * is missing and why instead of leaving it out.
 */
export async function readDdl(
  jobs: DdlJob[],
  describeError: (err: unknown) => string,
  onProgress?: (done: number, name: string) => void,
): Promise<DdlObject[]> {
  const out: DdlObject[] = [];
  for (const [i, j] of jobs.entries()) {
    onProgress?.(i, j.name);
    try {
      out.push({ kind: j.kind, name: j.name, ddl: await j.read() });
    } catch (err) {
      out.push({ kind: j.kind, name: j.name, ddl: null, reason: describeError(err) });
    }
  }
  return out;
}

/** Fixed entry time: a zip carries one per file, and now() would change the bytes. */
const ZIP_TIME = new Date(1980, 0, 1);

/** The same folder structure as one .zip, for webviews without a folder picker. */
export function buildDumpZip(files: DumpFile[]): Uint8Array {
  return zipSync(
    Object.fromEntries(files.map((f) => [f.path, strToU8(f.content)])),
    { mtime: ZIP_TIME },
  );
}
