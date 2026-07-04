// Pure test-data generation for a table (issue #147). Given each column's neutral
// type the UI picks a per-column strategy (sequence, random number, text, date,
// pick-from-list, boolean, fixed, NULL, or skip) and a row count; generateRows
// turns that into the {column: value} maps the row.insert path consumes, inserted
// in one transaction (client-side, reusing M7). Everything here is pure and
// unit-tested; the random source is injected so previews and tests are
// deterministic while a real run uses Math.random. The generator never invents a
// value for a "skip" column, so identity/auto-increment keys keep their defaults.

/** A pseudo-random source in [0, 1). Math.random by default; seeded in tests. */
export type Rng = () => number;

/** Deterministic RNG (mulberry32) for stable previews and tests. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How to fill a column. "skip" omits it entirely; "null" always writes NULL. */
export type GenKind =
  | "sequence"
  | "number"
  | "text"
  | "date"
  | "list"
  | "boolean"
  | "fixed"
  | "null"
  | "skip";

/** Flat per-column config (only the fields relevant to `kind` are read). */
export interface ColumnGen {
  column: string;
  /** Neutral column type, used to pick defaults and format dates. */
  type: string;
  kind: GenKind;
  seqStart: number;
  seqStep: number;
  min: number;
  max: number;
  decimals: number;
  /** Inclusive date range for "date" (ISO YYYY-MM-DD). */
  from: string;
  to: string;
  /** Comma-separated options for "list". */
  list: string;
  /** Constant for "fixed". */
  fixed: string;
}

const WORDS = [
  "lorem", "ipsum", "dolor", "amet", "alpha", "beta", "gamma", "delta",
  "nova", "lyra", "orion", "atlas", "echo", "zephyr", "quartz", "umbra",
];

/** ISO date N days before today (UTC), for default date ranges. */
function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtDate = (d: Date) =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const fmtTime = (secs: number) =>
  `${pad2(Math.floor(secs / 3600))}:${pad2(Math.floor((secs % 3600) / 60))}:${pad2(secs % 60)}`;

/**
 * A sensible default strategy for a column from its neutral type (and a light
 * name heuristic: a primary-key-ish "id" integer defaults to a sequence).
 */
export function defaultGen(column: string, type: string, isPk = false): ColumnGen {
  const t = type.toLowerCase();
  const base: ColumnGen = {
    column,
    type,
    kind: "text",
    seqStart: 1,
    seqStep: 1,
    min: 0,
    max: 1000,
    decimals: 0,
    from: isoDaysAgo(365),
    to: isoDaysAgo(0),
    list: "",
    fixed: "",
  };
  // Match tolerantly: describe reports the engine's own type name (int / integer
  // / bigint / serial, float / double / decimal, datetime / timestamp, …).
  if (/int|serial/.test(t)) return { ...base, kind: isPk ? "sequence" : "number", decimals: 0 };
  if (/float|double|decimal|numeric|real|money/.test(t)) return { ...base, kind: "number", decimals: 2 };
  if (/bool/.test(t)) return { ...base, kind: "boolean" };
  if (/date|time/.test(t)) return { ...base, kind: "date" };
  return { ...base, kind: "text" };
}

/** Generate one value for a column at a given 0-based row index. */
export function generateValue(g: ColumnGen, rowIndex: number, rng: Rng): string | null {
  switch (g.kind) {
    case "null":
      return null;
    case "fixed":
      return g.fixed;
    case "sequence":
      return String(g.seqStart + rowIndex * g.seqStep);
    case "number": {
      const raw = g.min + rng() * (g.max - g.min);
      return g.decimals > 0 ? raw.toFixed(g.decimals) : String(Math.round(raw));
    }
    case "boolean":
      return rng() < 0.5 ? "1" : "0";
    case "list": {
      const opts = g.list.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      if (opts.length === 0) return null;
      return opts[Math.floor(rng() * opts.length)];
    }
    case "text": {
      const w1 = WORDS[Math.floor(rng() * WORDS.length)];
      const w2 = WORDS[Math.floor(rng() * WORDS.length)];
      return `${w1} ${w2}`;
    }
    case "date": {
      const t = g.type.toLowerCase();
      const isDateTime = /timestamp|datetime/.test(t);
      const isTimeOnly = /time/.test(t) && !isDateTime;
      if (isTimeOnly) return fmtTime(Math.floor(rng() * 86400));
      const t0 = Date.parse(`${g.from}T00:00:00Z`);
      const t1 = Date.parse(`${g.to}T00:00:00Z`);
      const from = Number.isNaN(t0) ? Date.now() - 365 * 86400000 : t0;
      const to = Number.isNaN(t1) ? Date.now() : t1;
      const d = new Date(from + rng() * Math.max(0, to - from));
      if (isDateTime) return `${fmtDate(d)} ${fmtTime(Math.floor(rng() * 86400))}`;
      return fmtDate(d);
    }
    case "skip":
      return null; // never used; generateRows omits skipped columns
  }
}

/**
 * Generate `count` rows as {column: value} maps from the per-column strategies.
 * Columns with kind "skip" are omitted so the target's defaults / auto-increment
 * keys apply. Pure: the same rng + config always yields the same rows.
 */
export function generateRows(
  gens: ColumnGen[],
  count: number,
  rng: Rng,
): Record<string, string | null>[] {
  const rows: Record<string, string | null>[] = [];
  for (let i = 0; i < count; i++) {
    const row: Record<string, string | null> = {};
    for (const g of gens) {
      if (g.kind === "skip") continue;
      row[g.column] = generateValue(g, i, rng);
    }
    rows.push(row);
  }
  return rows;
}

/** Clamp a requested row count into a sane range (1..10000). */
export function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(10000, Math.floor(n)));
}

/** The strategies offered in the UI, with Spanish labels. */
export const GEN_KINDS: { kind: GenKind; label: string }[] = [
  { kind: "sequence", label: "Secuencia" },
  { kind: "number", label: "Número aleatorio" },
  { kind: "text", label: "Texto" },
  { kind: "date", label: "Fecha" },
  { kind: "list", label: "Lista de valores" },
  { kind: "boolean", label: "Booleano" },
  { kind: "fixed", label: "Valor fijo" },
  { kind: "null", label: "NULL" },
  { kind: "skip", label: "Omitir columna" },
];
