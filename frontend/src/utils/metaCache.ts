// Introspection cache (issue #675): schema.tree levels and table columns kept per
// SAVED connection, so a large schema opens with its tree and autocomplete
// already there while the real catalog is re-read in the background.
//
// What is cached is catalog metadata only — object and column names. Never a
// password: the connection is identified by its saved id plus a fingerprint of its
// NON-secret parameters, so pointing a saved connection at another host or
// database drops what was cached for the old one.
//
// Nothing read from here is current. Every entry carries `fetchedAt`; the UI shows
// cached data marked "from cache" and replaces it as fresh data arrives
// (stale-while-revalidate). DDL run from the editor marks the entries it may have
// changed stale; when it cannot tell which, the whole connection.
//
// Storage is the shared kvStore (localStorage, ~5 MB per origin shared with the
// rest of the app), so the cache has a size cap and evicts least-recently-used
// entries. An entry that cannot be kept at all is REPORTED, never dropped quietly.

import { scrub } from "./queryTarget";
import { driverSchema, secretFieldKeys, type Connection } from "./connections";
import type { KeyValueStore } from "./kvStore";

export interface CacheEntry {
  /** The cached value (JSON-safe). */
  v: unknown;
  /** When it was read from the server (ms). */
  at: number;
  /** Last read or write, for LRU eviction (ms). */
  used: number;
  /** Serialized size in chars, so the cap is checked without re-serializing. */
  s: number;
  /** Explicitly invalidated (DDL, manual refresh). */
  stale?: boolean;
}

export interface ConnCache {
  /** Fingerprint of the connection's non-secret params when this was filled. */
  fp: string;
  e: Record<string, CacheEntry>;
}

/** Whole cache, by saved-connection id. */
export type MetaCache = Record<string, ConnCache>;

/** A value read back from the cache. */
export interface Cached<T = unknown> {
  value: T;
  fetchedAt: number;
  stale: boolean;
}

/** Total cap in serialized chars (localStorage counts UTF-16 units). */
export const CACHE_CAP = 1_000_000;
/** Older than this, an entry counts as stale even if nothing invalidated it. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Cache key of one object-tree level ("" is the root). */
export const treeKey = (nodeKey: string): string => `tree:${nodeKey}`;
/** Cache key of one table's column names. */
export const colsKey = (table: string): string => `cols:${table}`;

// Never part of the fingerprint, even on a driver whose schema is unknown.
const SECRET_LIKE = /pass|secret|token|key_?phrase/i;

/**
 * Fingerprint of the connection's NON-secret parameters (driver + params, minus
 * password fields). A changed host/port/database/user yields a different value,
 * which drops the cache for that connection. Hashed (FNV-1a) so the stored value
 * is short and does not spell out the params. Pure.
 */
export function connFingerprint(conn: Pick<Connection, "driver" | "params">): string {
  const schema = driverSchema(conn.driver);
  const secrets = new Set(schema ? secretFieldKeys(schema) : []);
  const parts = Object.keys(conn.params)
    .filter((k) => !secrets.has(k) && !SECRET_LIKE.test(k))
    .sort()
    .map((k) => `${k}=${conn.params[k]}`);
  const text = [conn.driver, ...parts].join("\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Binds `id` to `fp`: keeps its entries when the fingerprint matches, else
    starts it empty (its params changed). Pure. */
export function openConn(cache: MetaCache, id: string, fp: string): MetaCache {
  if (cache[id]?.fp === fp) return cache;
  return { ...cache, [id]: { fp, e: {} } };
}

/** Forgets everything cached for `id`. Pure. */
export function clearConn(cache: MetaCache, id: string): MetaCache {
  if (!cache[id]) return cache;
  const next = { ...cache };
  delete next[id];
  return next;
}

/** True when an entry should not be presented as fresh: invalidated, or older
    than `maxAgeMs`. Pure. */
export function isStale(
  entry: Pick<Cached, "fetchedAt" | "stale">,
  now: number,
  maxAgeMs = STALE_AFTER_MS,
): boolean {
  return entry.stale || now - entry.fetchedAt > maxAgeMs;
}

/** Reads one entry; undefined when absent. `stale` folds in the age. Pure. */
export function getEntry(
  cache: MetaCache,
  id: string,
  key: string,
  now: number,
): Cached | undefined {
  const e = cache[id]?.e[key];
  if (!e) return undefined;
  return { value: e.v, fetchedAt: e.at, stale: isStale({ fetchedAt: e.at, stale: !!e.stale }, now) };
}

/** Every entry of `id` whose key starts with `prefix`. Pure. */
export function listEntries(
  cache: MetaCache,
  id: string,
  prefix: string,
  now: number,
): { key: string; entry: Cached }[] {
  return Object.keys(cache[id]?.e ?? {})
    .filter((k) => k.startsWith(prefix))
    .map((k) => ({ key: k, entry: getEntry(cache, id, k, now)! }));
}

/** Marks an entry as just used (LRU). Pure. */
export function touch(cache: MetaCache, id: string, key: string, now: number): MetaCache {
  const c = cache[id];
  const e = c?.e[key];
  if (!c || !e) return cache;
  return { ...cache, [id]: { ...c, e: { ...c.e, [key]: { ...e, used: now } } } };
}

const totalSize = (cache: MetaCache): number =>
  Object.values(cache).reduce(
    (n, c) => n + Object.values(c.e).reduce((m, e) => m + e.s, 0),
    0,
  );

/**
 * Stores a fresh value (clearing any stale mark), then evicts least-recently-used
 * entries — across all connections — until the total fits `cap`. `ok` is false
 * when the value alone exceeds the cap and was NOT stored; the caller reports it.
 * A connection never opened (no fingerprint) is not stored either. Pure.
 */
export function putEntry(
  cache: MetaCache,
  id: string,
  key: string,
  value: unknown,
  now: number,
  cap = CACHE_CAP,
): { cache: MetaCache; ok: boolean } {
  const c = cache[id];
  const s = key.length + JSON.stringify(value).length;
  if (!c || s > cap) return { cache, ok: false };
  const next: MetaCache = { ...cache, [id]: { ...c, e: { ...c.e, [key]: { v: value, at: now, used: now, s } } } };
  let total = totalSize(next);
  if (total <= cap) return { cache: next, ok: true };
  const victims = Object.entries(next)
    .flatMap(([cid, cc]) => Object.entries(cc.e).map(([k, e]) => ({ cid, k, e })))
    .filter((x) => !(x.cid === id && x.k === key))
    .sort((a, b) => a.e.used - b.e.used);
  for (const v of victims) {
    if (total <= cap) break;
    const cc = next[v.cid]!;
    const e = { ...cc.e };
    delete e[v.k];
    next[v.cid] = { ...cc, e };
    total -= v.e.s;
  }
  return { cache: next, ok: true };
}

/** Marks the entries of `id` matching `pred` stale (all of them by default). Pure. */
export function markStale(
  cache: MetaCache,
  id: string,
  pred: (key: string) => boolean = () => true,
): MetaCache {
  const c = cache[id];
  if (!c) return cache;
  const e: Record<string, CacheEntry> = {};
  for (const [k, v] of Object.entries(c.e)) e[k] = pred(k) ? { ...v, stale: true } : v;
  return { ...cache, [id]: { ...c, e } };
}

/** What a script may have changed in the catalog: nothing (null), every cached
    entry ("all"), or the object tree plus these tables' columns. */
export type DdlTargets = null | "all" | { tables: string[] };

// Bare object name: the last dotted/colon part, quotes stripped.
const bareName = (ref: string): string =>
  (ref.split(/[.:]/).pop() ?? "").replace(/^["`[]|["`\]]$/g, "");

const TABLE_DDL =
  /^(create|drop|alter)\s+(?:or\s+replace\s+)?(?:(?:global|local)\s+)?(?:temp(?:orary)?\s+)?(?:materialized\s+)?(?:table|view)\s+(?:if\s+(?:not\s+)?exists\s+)?(.+)$/i;
// Objects that do not change any table's columns; only the tree listing.
const OTHER_DDL =
  /^(?:create|drop|alter)\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:index|procedure|function|trigger|event|sequence|synonym)\b/i;

/**
 * Which cached metadata running `sql` may have made stale. Conservative: a
 * catalog statement it cannot read (CREATE DATABASE, ALTER … RENAME, an unknown
 * shape) answers "all". TRUNCATE changes rows, not metadata. Comments and string
 * literals are ignored. Pure.
 */
export function ddlTargets(sql: string): DdlTargets {
  const tables: string[] = [];
  let any = false;
  for (const raw of scrub(sql).split(";")) {
    const stmt = raw.trim();
    const verb = /^(create|drop|alter|rename|truncate)\b/i.exec(stmt)?.[1]?.toLowerCase();
    if (!verb || verb === "truncate") continue;
    any = true;
    if (OTHER_DDL.test(stmt)) continue;
    const ren = /^rename\s+table\s+(.+)$/i.exec(stmt);
    if (ren) {
      tables.push(...ren[1]!.split(/\s*,\s*|\s+to\s+/i).map((s) => bareName(s.trim())));
      continue;
    }
    const m = TABLE_DDL.exec(stmt);
    if (!m || /\brename\b/i.test(stmt)) return "all";
    const rest = m[2]!;
    const refs = m[1]!.toLowerCase() === "drop" ? rest.split(",") : [rest];
    tables.push(...refs.map((r) => bareName(r.trim().split(/[\s(]/)[0] ?? "")));
  }
  if (!any) return null;
  return tables.some((t) => t === "") ? "all" : { tables };
}

/** Applies ddlTargets(sql) to `id`'s entries: tree levels and the named tables'
    columns (case-insensitive) become stale, or everything for "all". Pure. */
export function invalidateForSql(cache: MetaCache, id: string, sql: string): MetaCache {
  const targets = ddlTargets(sql);
  if (targets === null) return cache;
  if (targets === "all") return markStale(cache, id);
  const names = new Set(targets.tables.map((t) => colsKey(t).toLowerCase()));
  return markStale(cache, id, (k) => k.startsWith("tree:") || names.has(k.toLowerCase()));
}

/** Serializes for storage. */
export function serializeCache(cache: MetaCache): string {
  return JSON.stringify({ v: 1, c: cache });
}

const isEntry = (e: unknown): e is CacheEntry => {
  const x = e as CacheEntry | null;
  return (
    !!x &&
    typeof x === "object" &&
    "v" in x &&
    Number.isFinite(x.at) &&
    Number.isFinite(x.used) &&
    Number.isFinite(x.s)
  );
};

/** Parses stored data; malformed connections/entries are dropped, garbage or
    another version yields an empty cache. Never throws. */
export function parseCache(raw: string | null): MetaCache {
  if (!raw) return {};
  let doc: { v?: unknown; c?: unknown };
  try {
    doc = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!doc || doc.v !== 1 || !doc.c || typeof doc.c !== "object") return {};
  const out: MetaCache = {};
  for (const [id, c] of Object.entries(doc.c as Record<string, unknown>)) {
    const cc = c as Partial<ConnCache> | null;
    if (!cc || typeof cc.fp !== "string" || !cc.e || typeof cc.e !== "object") continue;
    const e: Record<string, CacheEntry> = {};
    for (const [k, v] of Object.entries(cc.e)) if (isEntry(v)) e[k] = v;
    out[id] = { fp: cc.fp, e };
  }
  return out;
}

export const STORAGE_KEY = "quaero.metaCache";

/** Why something could not be cached: one value larger than the whole cap, or
    the storage refused the write (quota, blocked). */
export type CacheProblem = "tooLarge" | "storage";

/** One connection's view of the cache, handed to the object tree. */
export interface ConnMetaCache {
  get<T = unknown>(key: string): Cached<T> | undefined;
  put(key: string, value: unknown): void;
}

/**
 * Stateful wrapper over the pure helpers: holds the cache in memory, loads it
 * lazily from `kv`, and writes it back debounced (`flush` writes now). `onProblem`
 * hears about every value that could not be cached.
 */
export function createMetaCacheStore(
  kv: KeyValueStore,
  onProblem: (p: CacheProblem) => void = () => {},
  now: () => number = Date.now,
) {
  let cache: MetaCache | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const state = (): MetaCache => {
    if (cache) return cache;
    let raw: string | null = null;
    try {
      raw = kv.getItem(STORAGE_KEY);
    } catch {
      /* unreadable: start empty */
    }
    return (cache = parseCache(raw));
  };
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!cache) return;
    try {
      kv.setItem(STORAGE_KEY, serializeCache(cache));
    } catch {
      onProblem("storage");
    }
  };
  const set = (next: MetaCache) => {
    if (next === cache) return;
    cache = next;
    clearTimeout(timer);
    timer = setTimeout(flush, 500);
  };
  return {
    /** Binds a saved connection to its current fingerprint (see openConn). */
    open: (id: string, fp: string) => set(openConn(state(), id, fp)),
    conn: (id: string): ConnMetaCache => ({
      get: <T,>(key: string) => {
        const hit = getEntry(state(), id, key, now());
        // LRU bookkeeping only: not worth a write of its own.
        if (hit) cache = touch(state(), id, key, now());
        return hit as Cached<T> | undefined;
      },
      put: (key: string, value: unknown) => {
        const r = putEntry(state(), id, key, value, now());
        if (!r.ok && state()[id]) onProblem("tooLarge");
        set(r.cache);
      },
    }),
    list: (id: string, prefix: string) => listEntries(state(), id, prefix, now()),
    /** Marks what `sql` may have changed stale; returns what it decided. */
    invalidateSql: (id: string, sql: string): DdlTargets => {
      set(invalidateForSql(state(), id, sql));
      return ddlTargets(sql);
    },
    /** Marks everything cached for `id` stale (a manual refresh). */
    markStale: (id: string) => set(markStale(state(), id)),
    flush,
  };
}

export type MetaCacheStore = ReturnType<typeof createMetaCacheStore>;
