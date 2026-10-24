import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, untrack, type JSX } from "solid-js";
import { EmptyNote } from "./EmptyNote";
import { visibleRange } from "../utils/virtualize";
import {
  flattenTree,
  flattenFiltered,
  filterMatchCount,
  toggleExpanded,
  childKey,
  databaseKey,
  groupObjectsByType,
  lazyObjectFolders,
  objectLeafNodes,
  tableDetailNodes,
  type TableDetail,
  type TreeNode,
  type FlatNode,
} from "../utils/tree";
import { schemaTree, schemaDescribe, schemaDdl, parseTreeRows, type NodeKind, type TreeRow } from "../utils/schema";
import { indexListFor } from "../utils/indexes";
import { foreignKeysFor, groupForeignKeys, parseForeignKeys } from "../utils/foreignKeys";
import { rowCountSql, parseRowCounts } from "../utils/rowCounts";
import {
  deleteSql,
  hasTableSql,
  insertSql,
  selectSql,
  truncateSql,
  updateSql,
  type TableRef,
} from "../utils/tableSql";
import { formatKeys } from "../utils/shortcuts";
import { currentOs } from "../utils/dialog";
import { treeKey, type ConnMetaCache } from "../utils/metaCache";
import { timeAgo } from "../utils/history";
import { runQuery } from "../utils/query";
import { folderSpec, objectLeaves, readDefinitionText } from "../utils/treeObjects";
import { definitionFor as routineDefinitionFor, type RoutineType } from "../utils/routines";
import { definitionFor as objectDefinitionFor } from "../utils/triggers";
import { runnableRoutineDdl } from "../utils/routineDdl";
import { dropObjectSql, type DropKind } from "../utils/dropObject";
import { mongoEmptySql, mongoRenameSql } from "../utils/mongoStatements";
import { engineFamily } from "../utils/engineFamily";
import { ConfirmDialog } from "./ConfirmDialog";
import { openContextMenu, type MenuItem } from "../utils/contextMenu";
import { copyText } from "../utils/rowCopy";
import { routineKind } from "../utils/objectIcons";
import { Icon, IconTools, ObjectIcon } from "./icons";
import { SafeBadge } from "./ConnectionBar";
import { engineMonogram } from "../utils/connections";
import type { SafeMode } from "../utils/safeMode";

/** One open connection, as its row at the top of its tree draws it (#689). */
export interface ConnRowState {
  driver: string;
  /** Engine label plus where it points. */
  sub: string;
  focused: boolean;
  /** The core said the session is gone (issue #407). */
  lost?: boolean;
  /** A fresh session is being opened in its place by itself (issue #676)… */
  reconnecting?: boolean;
  /** …and just was (shown for a few seconds). */
  reconnected?: boolean;
  /** Statements in its open transaction (issue #667); absent = none open. */
  txStatements?: number;
  /** The connection is protected (issue #666). */
  safeMode?: SafeMode;
  /** A connection is being opened: reconnect and disconnect wait. */
  busy?: boolean;
}
import { t, locale } from "../utils/i18n";
import { countText, dropConfirm, dropConsequences, dropDependants, type DropFacts } from "../utils/confirmText";
import { objectCountQuery } from "../utils/pagination";
import { withConfirmedWrites } from "../utils/transport";

// A group folder's label is an i18n key ("tree.tables"); real object nodes carry
// their true name. Translate only the former so object names pass through as-is.
const nodeLabel = (node: TreeNode): string =>
  node.kind === "group" ? t(node.label) : node.label;

/** `--h-sm` at 100% zoom; App passes the zoomed value (typography.ts, #681). */
const ROW_HEIGHT = 24;

/** True for a routine/trigger/event leaf (listed on demand, opens its DDL). */
function isObjectLeaf(kind: TreeNode["kind"]): boolean {
  return kind === "routine" || kind === "trigger" || kind === "event";
}

// Object kind whose icon a tree node shows (#185, #683). A routine leaf refines
// it to procedure/function from the type it was listed with; a type folder
// (Tablas/Vistas/…) shows the icon of what it holds, plus a right-aligned count.
function nodeKind(node: TreeNode): string {
  if (node.kind === "routine") return routineKind(node.objType);
  if (node.kind === "group") {
    const g = node.groupKind as string | undefined;
    return g === "idx" ? "index" : (g ?? "table");
  }
  if (node.kind === "column") return node.pk ? "key" : node.fk ? "fk" : "column";
  return node.kind;
}

/** A table or a view: what opens data, and what expands into its columns. */
const isRelation = (kind: TreeNode["kind"]) => kind === "table" || kind === "view";

/** A key as this OS spells it, for a menu hint. */
const keyHint = (keys: string) => formatKeys(keys, currentOs());

// Lazy, virtualized object tree. Children of a container are fetched from the
// core only when it is expanded (schema.tree), and the visible (expanded) nodes
// are flattened and windowed so nodes outside the viewport are never rendered
// (.rules/frontend.md §2). Tree shape/flatten logic is pure (src/utils/tree.ts).
export function ObjectTree(props: {
  connId: string | null;
  /** Row height in px, equal to what the CSS paints (`--h-sm` under the zoom),
      so the virtualization math and the rows on screen agree (#681). */
  rowHeight?: number;
  /** Active engine/driver name, for listing routines/triggers (issue #135 ph.2). */
  engine?: string;
  /** Double-click a table/view -> open its structure. */
  onOpenStructure: (node: TreeNode) => void;
  /** Single-click a table/view -> open its data (a SELECT). */
  onOpenData: (node: TreeNode) => void;
  /** Open SQL (a routine/trigger DDL) in a query tab. `object` identifies the
      database object it belongs to, so the workspace reuses the tab already open
      for it instead of stacking another (#414); absent when the SQL is not an
      object's definition. */
  onOpenSql?: (
    sql: string,
    name?: string,
    object?: { db?: string; schema?: string; name: string; kind: string },
  ) => void;
  /** Bumping this re-fetches the tree from the current connection (issue #107).
      An explicit refresh: it reloads from the root and collapses the tree. */
  reloadKey?: number;
  /** Bumping this re-lists the levels the user already has open, KEEPING the
      expansion, filter and scroll — for a refresh the app decided on its own
      (DDL executed from the editor, issue #317), where collapsing would throw
      away the navigation the user is in the middle of. */
  softReloadKey?: number;
  /** Refresh button in the header (re-runs the active query + reloads the tree). */
  onRefresh?: () => void;
  /** Opens the connection tools menu (the wrench in the header). */
  onOpenTools?: (e: MouseEvent) => void;
  /** Right-click "Importar datos…" on a table/view. */
  onImport?: (node: TreeNode) => void;
  /** Right-click "Nueva tabla…" on a database/schema. */
  onCreateTable?: (node: TreeNode) => void;
  /** Right-click "Modificar tabla…" on a table. */
  onAlterTable?: (node: TreeNode) => void;
  /** Right-click "Índices y constraints…" on a table. */
  onManageIndexes?: (node: TreeNode) => void;
  /** Emits the currently-loaded table/view leaves so the command palette can
      search them (issue #174). Fires whenever the loaded set changes. */
  onObjectsLoaded?: (nodes: TreeNode[]) => void;
  /** Bumping `tick` shows the loaded node `key`: its ancestors open, the tree
      scrolled to it and it made the active row («Mostrar en el explorador»). */
  reveal?: { key: string; tick: number };
  /** Clicking a database/schema node makes it the working database. */
  onSelectDatabase?: (name: string) => void;
  /** Name of the current working database; its tree node is highlighted. */
  activeDb?: string;
  /** MongoDB: the database the connection is bound to. Its statements run there
      and nowhere else, so dropping, emptying or renaming a collection is only
      offered for that database's own (#719). */
  connDatabase?: string;
  /** Section title. With several connections open the sidebar stacks one tree
      per connection (issue #444) and the header becomes the connection's name;
      alone, it stays the generic "Objetos". */
  title?: string;
  /** The connection's accent colour, shown as a dot beside the title. */
  accent?: string;
  /** Collapsed: only the header shows. The tree stays MOUNTED (hidden with CSS)
      so its expansion, filter and scroll survive being folded away. */
  collapsed?: boolean;
  /** Makes the header a collapse toggle. Absent = not collapsible. */
  onToggleCollapse?: () => void;
  /** Closes this connection from its own section header — with several open,
      the bar's single "Desconectar" could only ever close the focused one. */
  onDisconnect?: () => void;
  /** This connection's introspection cache (issue #675). Levels found there are
      shown at once, marked "from cache", and re-read from the server. */
  cache?: ConnMetaCache;
  /** Rendered right under the header — the working-database selector of the
      focused connection. */
  children?: JSX.Element;
  /**
   * The connection this tree belongs to (issue #689). Given, the header is the
   * connection's own row: colour bar, engine, name, protection, state, its
   * open transaction and Reconectar when the session is gone.
   */
  conn?: ConnRowState;
  /** Bring this connection into focus (never opens or closes anything). */
  onFocusConn?: () => void;
  /** Reconnect a lost session from its row. */
  onReconnect?: () => void;
  /** A table's column names, as its expansion read them — for the autocomplete. */
  onColumns?: (table: string, names: string[]) => void;
  /** Row counts of the tables of a level, by name (from the catalog). */
  onRowCounts?: (counts: Record<string, number>) => void;
  /** Table menu: «Exportar…» and «Generar datos de prueba…». */
  onExport?: (node: TreeNode) => void;
  onGenerate?: (node: TreeNode) => void;
  /** The connection's own actions (Nueva consulta, Lista de objetos, ER, …,
      Editar conexión, Desconectar), for its header and its database nodes. `db`
      is the database right-clicked, when it was one. */
  connMenu?: (db?: string) => MenuItem[];
}) {
  const [roots, setRoots] = createSignal<TreeNode[]>([]);
  const [children, setChildren] = createSignal<Record<string, TreeNode[]>>({});
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [loading, setLoading] = createSignal<Set<string>>(new Set());
  const [rootLoading, setRootLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [filter, setFilter] = createSignal("");
  // Catalog row counts of the tables on screen, by node key (R-35).
  const [rowCounts, setRowCounts] = createSignal<Record<string, number>>({});
  // Levels on screen that came from the cache and have not been re-read yet,
  // by level key ("" = the root) -> when they were fetched (issue #675).
  const [cachedAt, setCachedAt] = createSignal<Record<string, number>>({});
  const markCached = (key: string, at: number) => setCachedAt((m) => ({ ...m, [key]: at }));
  const markFresh = (key: string) =>
    setCachedAt((m) => {
      if (!(key in m)) return m;
      const next = { ...m };
      delete next[key];
      return next;
    });
  const oldestCached = () => {
    const ats = Object.values(cachedAt());
    return ats.length > 0 ? Math.min(...ats) : null;
  };
  // A cached level's rows, shape-checked: storage is outside our control.
  const KINDS = new Set(["database", "schema", "table", "view"]);
  const cachedRows = (key: string) => {
    const hit = props.cache?.get<TreeRow[]>(treeKey(key));
    const ok =
      hit &&
      Array.isArray(hit.value) &&
      hit.value.every((r) => typeof r?.name === "string" && KINDS.has(r?.kind));
    return ok ? hit : undefined;
  };

  // Bumped on every connection change; async loads from a stale connection
  // check it before writing state, so switching connections mid-fetch cannot
  // stomp the new connection's tree.
  let generation = 0;

  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportH, setViewportH] = createSignal(0);

  // Lift the loaded table/view leaves to the workspace for the command palette
  // (issue #174). Containers, group folders and routine/trigger leaves are
  // excluded. Only re-emits when the actual table/view set changes, so expanding
  // an unrelated folder (routines, etc.) does not churn the palette command list.
  let lastObjectKeys = "";
  createEffect(() => {
    if (!props.onObjectsLoaded) return;
    const objs = Object.values(children())
      .flat()
      .filter((n) => n.kind === "table" || n.kind === "view");
    const keys = objs.map((n) => n.key).join("\n");
    if (keys === lastObjectKeys) return;
    lastObjectKeys = keys;
    props.onObjectsLoaded(objs);
  });

  // The scroller only exists once a connection has roots (it lives inside a
  // <Show>), so measuring it in onMount runs before it exists and leaves the
  // viewport height at 0 — which collapses the virtual window to just the
  // overscan rows, so the tree never filled the sidebar. Measure from a callback
  // ref instead: it fires (and re-attaches the ResizeObserver) whenever the
  // scroller element appears or is replaced. Same fix as ResultGrid.
  let ro: ResizeObserver | undefined;
  let scrollerEl: HTMLDivElement | undefined;
  const attachScroller = (el: HTMLDivElement) => {
    scrollerEl = el;
    setViewportH(el.clientHeight);
    ro?.disconnect();
    ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
  };
  onCleanup(() => ro?.disconnect());

  // Typing in the filter jumps back to the top so the first matches are visible.
  const onFilterInput = (value: string) => {
    setFilter(value);
    if (scrollerEl) scrollerEl.scrollTop = 0;
    setScrollTop(0);
  };

  // Build child nodes from a schema.tree result for `parent`.
  const buildChildren = (parent: TreeNode | null, rows: { name: string; kind: NodeKind }[]): TreeNode[] => {
    const parentKey = parent ? parent.key : "";
    return rows.map((r) => {
      if (r.kind === "schema") {
        return { key: childKey(parentKey, "schema", r.name), label: r.name, kind: r.kind, db: parent?.db, schema: r.name };
      }
      // table / view: inherits the parent's db/schema context.
      return {
        key: childKey(parentKey, r.kind, r.name),
        label: r.name,
        kind: r.kind,
        db: parent?.db,
        schema: parent?.schema,
      };
    });
  };

  const setBusy = (key: string, on: boolean) =>
    setLoading((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  // Load the root database list whenever the active connection changes, or when
  // a refresh is requested (reloadKey). A refresh re-fetches from the root and
  // collapses the tree, so freshly created/dropped objects show up.
  createEffect(() => {
    const connId = props.connId;
    void props.reloadKey; // track: bumping reloadKey re-runs this load
    generation += 1;
    const myGen = generation;
    setRoots([]);
    setChildren({});
    setExpanded(new Set<string>());
    setError(null);
    setFilter(""); // a stale filter must not hide the freshly-loaded tree (#175)
    setRowCounts({});
    setCachedAt({});
    if (!connId) {
      setRootLoading(false);
      return;
    }
    const rootNodes = (rows: TreeRow[]): TreeNode[] =>
      rows.map((r) => ({ key: databaseKey(r.name), label: r.name, kind: r.kind, db: r.name }));
    // Stale-while-revalidate (issue #675): the cached roots show at once, marked,
    // and are replaced by the server's answer.
    const hit = untrack(() => cachedRows(""));
    if (hit) {
      setRoots(rootNodes(hit.value));
      markCached("", hit.fetchedAt);
    }
    setRootLoading(true);
    void (async () => {
      try {
        const res = await schemaTree(connId);
        if (myGen !== generation) return; // connection changed mid-flight
        const rows = parseTreeRows(res, "database");
        setRoots(rootNodes(rows));
        props.cache?.put(treeKey(""), rows);
        markFresh("");
      } catch (err) {
        if (myGen !== generation) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (myGen === generation) setRootLoading(false);
      }
    })();
  });

  // Lazily list a Procedimientos/Funciones/Triggers/Eventos folder's members via
  // query.run over catalogs (issue #135 phase 2), building leaf nodes.
  const loadLazyFolder = async (node: TreeNode) => {
    const connId = props.connId;
    const spec =
      node.groupKind && folderSpec(props.engine ?? "", node.db, node.groupKind as never);
    if (!connId || !spec) {
      setChildren((c) => ({ ...c, [node.key]: [] }));
      return;
    }
    const myGen = generation;
    setBusy(node.key, true);
    try {
      const res = await runQuery(connId, spec.listSql);
      if (myGen !== generation) return;
      const cols = res.columns.map((c) => c.name);
      const leaves = objectLeaves(spec, cols, res.rows);
      setChildren((c) => ({
        ...c,
        [node.key]: objectLeafNodes(node.key, node.db, node.schema, leaves),
      }));
    } catch (err) {
      if (myGen === generation) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (myGen === generation) setBusy(node.key, false);
    }
  };

  // `force` re-fetches a level whose children are already cached (the soft
  // reload); expanding a node keeps using the cache.
  const loadChildren = async (node: TreeNode, force = false) => {
    const connId = props.connId;
    if (!connId || (children()[node.key] && !force)) {
      return;
    }
    if (node.kind === "group") {
      // Tablas/Vistas folders are pre-loaded; only the lazy object-type folders
      // (Procedimientos/…) fetch their members on expand.
      if (node.lazy) await loadLazyFolder(node);
      return;
    }
    if (isRelation(node.kind)) {
      await loadTableDetail(node);
      return;
    }
    const myGen = generation;
    // Not loaded yet this session: show the cached level now, marked, while the
    // server is asked (issue #675). A forced re-list skips the cache.
    if (!force) {
      const hit = cachedRows(node.key);
      if (hit) {
        applyRows(node, hit.value);
        markCached(node.key, hit.fetchedAt);
      }
    }
    setBusy(node.key, true);
    try {
      const res =
        node.kind === "database"
          ? await schemaTree(connId, node.db)
          : await schemaTree(connId, node.db, node.schema);
      if (myGen !== generation) return; // connection changed mid-flight
      // A database's children may be schemas (containers) or tables; a schema's
      // children are tables. parseTreeRows auto-detects tables from the `type`
      // column, so the only ambiguous (type-less) case is containers -> schema.
      const rows = parseTreeRows(res, "schema");
      applyRows(node, rows);
      props.cache?.put(treeKey(node.key), rows);
      markFresh(node.key);
    } catch (err) {
      if (myGen === generation) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (myGen === generation) setBusy(node.key, false);
    }
  };

  // A table's columns, indexes and foreign keys (audit A-16). The columns come
  // from schema.describe; indexes and keys from the catalog queries the index
  // manager and the FK picker already use — each only where the engine has one,
  // and a failing catalog read costs its folder, never the columns.
  const loadTableDetail = async (node: TreeNode) => {
    const connId = props.connId;
    if (!connId) return;
    const myGen = generation;
    const engine = props.engine ?? "";
    setBusy(node.key, true);
    const rowsOf = async (sql: string | null) => {
      if (!sql) return null;
      try {
        return await runQuery(connId, sql);
      } catch {
        return null;
      }
    };
    try {
      const desc = await schemaDescribe(connId, node.label, node.db, node.schema);
      if (myGen !== generation) return;
      const col = (name: string) => desc.columns.findIndex((c) => c.name.toLowerCase() === name);
      const [ni, ti, pi] = [col("name"), col("type"), col("pk")];
      const columns = desc.rows.map((r) => ({
        name: r[ni] ?? "",
        type: ti >= 0 ? (r[ti] ?? "") : "",
        pk: pi >= 0 && !!r[pi] && r[pi] !== "0",
      }));
      props.onColumns?.(node.label, columns.map((c) => c.name));
      const detail: TableDetail = { columns, indexes: [], fks: [] };
      if (node.kind === "table") {
        const idx = indexListFor(engine, node.label, node.db, node.schema);
        const idxRes = idx.supported ? await rowsOf(idx.sql) : null;
        if (idxRes && idx.nameCol) {
          const n = idxRes.columns.findIndex((c) => c.name === idx.nameCol);
          const first = idx.detailCols[0];
          const d = first ? idxRes.columns.findIndex((c) => c.name === first.col) : -1;
          if (n >= 0)
            detail.indexes = idxRes.rows.map((r) => ({ name: r[n] ?? "", columns: d >= 0 ? (r[d] ?? "") : "" }));
        }
        const fkq = foreignKeysFor(engine, node.schema ?? node.db, { table: node.label, direction: "from" });
        const fkRes = fkq.supported ? await rowsOf(fkq.bulkSql) : null;
        if (fkRes) {
          detail.fks = groupForeignKeys(parseForeignKeys(fkRes.columns, fkRes.rows))
            .filter((f) => f.fromTable === node.label)
            .map((f) => ({
              name: f.constraint,
              columns: f.columns.map((c) => c.from),
              toTable: f.toTable,
              toColumns: f.columns.map((c) => c.to),
            }));
        }
      }
      if (myGen !== generation) return;
      const { children: kids, members } = tableDetailNodes(node, detail);
      setChildren((c) => ({ ...c, [node.key]: kids, ...members }));
    } catch (err) {
      if (myGen === generation) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (myGen === generation) setBusy(node.key, false);
    }
  };

  // The catalog's row counts for the tables of one level (R-35): one statement,
  // never a COUNT(*) per table; none where the engine keeps no numbers.
  const loadRowCounts = async (node: TreeNode, tables: TreeNode[]) => {
    const connId = props.connId;
    const sql = rowCountSql(props.engine ?? "", node.db, node.schema);
    if (!connId || !sql || tables.length === 0) return;
    const myGen = generation;
    try {
      const res = await runQuery(connId, sql);
      if (myGen !== generation) return;
      const byName = parseRowCounts(res.columns, res.rows);
      const byKey: Record<string, number> = {};
      for (const tb of tables) if (byName[tb.label] !== undefined) byKey[tb.key] = byName[tb.label];
      setRowCounts((m) => ({ ...m, ...byKey }));
      props.onRowCounts?.(byName);
    } catch {
      // A count is decoration: without it the tree is still whole.
    }
  };

  // Puts one schema.tree level's rows under `node`.
  const applyRows = (node: TreeNode, rows: TreeRow[]) => {
    const built = buildChildren(node, rows);
    // Leaf objects (tables/views) are grouped under Tablas/Vistas folders
    // (#135); containers (schemas) stay flat. Both the folder nodes and their
    // pre-loaded members go into the children map in one update.
    const isLeafLevel = built.some((n) => n.kind === "table" || n.kind === "view");
    // A database also gets lazy folders for routines/triggers/events (phase 2),
    // listed on demand — appended after Tablas/Vistas.
    const folders =
      node.kind === "database"
        ? lazyObjectFolders(node.key, node.db, node.schema, props.engine ?? "")
        : [];
    if (isLeafLevel) {
      const { groups, members } = groupObjectsByType(node.key, node.db, node.schema, built);
      setChildren((c) => ({ ...c, [node.key]: [...groups, ...folders], ...members }));
      void loadRowCounts(node, built.filter((n) => n.kind === "table"));
    } else {
      setChildren((c) => ({ ...c, [node.key]: [...built, ...folders] }));
    }
  };

  // Soft reload (issue #317): re-list every level the user has open, in place.
  // The roots, the expansion, the filter and the scroll are left alone — this
  // fires on its own after DDL, and collapsing the tree under the user would
  // trade one annoyance for another. Re-listing a database rebuilds its
  // Tablas/Vistas folders and members; a lazy folder (Procedimientos/…) is
  // re-listed when it is itself expanded.
  createEffect(
    on(
      () => props.softReloadKey ?? 0,
      () => {
        if (!props.connId) return;
        const myGen = generation;
        void (async () => {
          for (const key of [...expanded()]) {
            if (myGen !== generation) return; // connection changed mid-flight
            const node = nodeByKey(key);
            if (node) await loadChildren(node, true);
          }
        })();
      },
      { defer: true },
    ),
  );

  /** A loaded node by key: the roots, or any level already fetched. */
  const nodeByKey = (key: string): TreeNode | undefined =>
    roots().find((n) => n.key === key) ??
    Object.values(children())
      .flat()
      .find((n) => n.key === key);

  // Fetch a routine/trigger/event leaf's definition (DDL) and open it in a new
  // query tab. Reuses the per-engine definition SQL from routines.ts/triggers.ts.
  /** What identifies a definition tab: the object, plus that it is its
      DEFINITION and not its rows (#414). */
  const defIdentity = (node: TreeNode) => ({
    db: node.db,
    schema: node.schema,
    name: node.label,
    kind: `def:${node.kind}`,
  });

  const openObjectDef = async (node: TreeNode) => {
    const connId = props.connId;
    if (!connId || !props.onOpenSql) return;
    const engine = props.engine ?? "";
    // Opened to be READ and re-run, so it opens in the form that runs (issue
    // #456): a plain CREATE is what every catalog returns, and the engine
    // refuses it for an object that already exists.
    const runnable = (ddl: string) => runnableRoutineDdl(engine, ddl, node.label);
    // SQLite triggers carry their DDL in the listing row — open it directly.
    if (node.objDef) {
      props.onOpenSql(runnable(node.objDef), node.label, defIdentity(node));
      return;
    }
    const query =
      node.kind === "routine"
        ? routineDefinitionFor(engine, {
            name: node.label,
            type: routineKind(node.objType).toUpperCase() as RoutineType,
            id: node.objId,
          })
        : objectDefinitionFor(engine, node.kind === "event" ? "event" : "trigger", {
            name: node.label,
            table: node.objTable,
            id: node.objId,
          });
    if (!query) return;
    const myGen = generation;
    setBusy(node.key, true);
    try {
      const res = await runQuery(connId, query.sql);
      if (myGen !== generation) return;
      const cols = res.columns.map((c) => c.name);
      const text = readDefinitionText(cols, res.rows, query.column, query.concatRows);
      if (text) props.onOpenSql(runnable(text), node.label, defIdentity(node));
    } catch (err) {
      if (myGen === generation) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (myGen === generation) setBusy(node.key, false);
    }
  };

  const onToggle = (node: FlatNode) => {
    // Clicking a database/schema node also selects it as the working database,
    // so the "Base de datos activa" selector and the scoped tools follow the
    // tree (App guards against names not in the selector).
    if (node.kind === "database" || node.kind === "schema") {
      props.onSelectDatabase?.(node.db ?? node.label);
    }
    if (!node.expandable) {
      return;
    }
    // While a filter is active the view is derived from matches (flattenFiltered
    // ignores the real `expanded` set), so toggling must NOT mutate `expanded` —
    // that would corrupt the expansion state restored when the filter is cleared
    // (#175). Still allow loading an unloaded folder so its members can be found.
    if (filter().trim()) {
      if (!children()[node.key]) void loadChildren(node);
      return;
    }
    const willExpand = !expanded().has(node.key);
    setExpanded((s) => toggleExpanded(s, node.key));
    if (willExpand) {
      void loadChildren(node);
    }
  };

  // Build the right-click menu for a node, adapted to its kind: tables/views get
  // data/structure/import actions; containers (database/schema) just refresh and
  // copy. All actions reuse the same handlers as clicks.
  // "Eliminar…" (issue #463): the pending drop, the exact SQL it will run, and
  // whether it is in flight. The dialog stays open on failure so the engine's
  // own complaint — a foreign key still pointing at the table, most often — is
  // read where the action was taken.
  const [pendingDrop, setPendingDrop] = createSignal<{
    key: string;
    name: string;
    sql: string;
    kind: DropKind;
    where: string;
  } | null>(null);
  const [dropping, setDropping] = createSignal(false);
  // What a dropped table takes with it (audit P1): rows, indexes and who
  // references it, read when the dialog opens. A catalog that cannot answer
  // leaves its fact out — never a guess.
  const [dropFacts, setDropFacts] = createSignal<DropFacts>({});
  const loadDropFacts = (node: TreeNode) => {
    setDropFacts({});
    const connId = props.connId;
    const engine = props.engine ?? "";
    if (!connId || node.kind !== "table") return;
    const db = node.db ?? props.connDatabase;
    const asked = node.key;
    const still = () => pendingDrop()?.key === asked;
    const merge = (f: DropFacts) => still() && setDropFacts((prev) => ({ ...prev, ...f }));
    const count = objectCountQuery({ db: node.db, schema: node.schema, name: node.label }, engine);
    if (count) {
      void runQuery(connId, count)
        .then((r) => merge({ rows: Number(r.rows[0]?.[0] ?? NaN) }))
        .catch(() => {});
    }
    const idx = indexListFor(engine, node.label, db, node.schema);
    if (idx.supported && idx.sql) {
      void runQuery(connId, idx.sql)
        .then((r) => merge({ indexes: r.rows.length }))
        .catch(() => {});
    }
    const fk = foreignKeysFor(engine, db, { table: node.label, direction: "to" });
    if (fk.supported && fk.bulkSql) {
      void runQuery(connId, fk.bulkSql)
        .then((r) =>
          merge({
            dependants: groupForeignKeys(parseForeignKeys(r.columns, r.rows)).map((rel) => `${rel.fromTable}.${rel.columns.map((c) => c.from).join(", ")}`),
          }),
        )
        .catch(() => {});
    }
  };
  const [dropError, setDropError] = createSignal<string | null>(null);
  // MongoDB collection management besides the drop: emptying (deleteMany({})) and
  // renaming, each confirmed with the exact statement shown. A rename also asks
  // for the new name.
  const [pendingColl, setPendingColl] = createSignal<{ kind: "empty" | "rename"; name: string } | null>(null);
  const [renameTo, setRenameTo] = createSignal("");
  const collSql = (): string | null => {
    const p = pendingColl();
    if (!p) return null;
    return p.kind === "empty" ? mongoEmptySql(p.name) : mongoRenameSql(p.name, renameTo());
  };
  const closeColl = () => setPendingColl(null);

  /** On a protected connection the DROP dialog asks for the typed name itself
      (audit A-25), so the guard is not asked a second time. */
  const typedDrop = () => props.conn?.safeMode === "confirm";
  const runDrop = async (sql: string, confirmed = false) => {
    const connId = props.connId;
    if (!connId) return;
    setDropping(true);
    setDropError(null);
    try {
      if (confirmed) await withConfirmedWrites(connId, () => runQuery(connId, sql));
      else await runQuery(connId, sql);
      setPendingDrop(null);
      setPendingColl(null);
      setPendingTruncate(null);
      props.onRefresh?.();
    } catch (err) {
      setDropError(err instanceof Error ? err.message : String(err));
    } finally {
      setDropping(false);
    }
  };

  // «Vaciar tabla…» (audit A-17): the exact TRUNCATE, confirmed — typed on a
  // protected connection.
  const [pendingTruncate, setPendingTruncate] = createSignal<{ name: string; sql: string; where: string } | null>(null);

  const tableRef = (node: TreeNode): TableRef => ({ db: node.db, schema: node.schema, name: node.label });
  const where = (node: TreeNode) => [props.title, node.db, node.schema].filter(Boolean).join(" › ");

  // «Generar SQL ▸»: written into a new editor tab, never run. INSERT/UPDATE/
  // DELETE need the columns, read when chosen.
  const generate = async (node: TreeNode, kind: "select" | "insert" | "update" | "delete" | "ddl") => {
    const connId = props.connId;
    if (!connId || !props.onOpenSql) return;
    const engine = props.engine ?? "";
    try {
      if (kind === "ddl") {
        const ddl = await schemaDdl(connId, node.label, node.db, node.schema);
        if (ddl) props.onOpenSql(ddl, node.label);
        return;
      }
      if (kind === "select") {
        props.onOpenSql(selectSql(tableRef(node), engine), node.label);
        return;
      }
      const desc = await schemaDescribe(connId, node.label, node.db, node.schema);
      const ni = desc.columns.findIndex((c) => c.name.toLowerCase() === "name");
      const pi = desc.columns.findIndex((c) => c.name.toLowerCase() === "pk");
      const cols = desc.rows.map((r) => r[ni] ?? "").filter(Boolean);
      const pk = pi >= 0 ? desc.rows.filter((r) => r[pi] && r[pi] !== "0").map((r) => r[ni] ?? "") : [];
      const sql =
        kind === "insert"
          ? insertSql(tableRef(node), engine, cols)
          : kind === "update"
            ? updateSql(tableRef(node), engine, cols, pk)
            : deleteSql(tableRef(node), engine, cols, pk);
      if (sql) props.onOpenSql(sql, node.label);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const copyDdl = async (node: TreeNode) => {
    if (!props.connId) return;
    try {
      const ddl = await schemaDdl(props.connId, node.label, node.db, node.schema);
      if (ddl) copyText(ddl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const askTruncate = (node: TreeNode) => {
    const sql = truncateSql(tableRef(node), props.engine ?? "");
    if (!sql) return;
    setDropError(null);
    setPendingTruncate({ name: node.label, sql, where: where(node) });
  };

  // The table menu (audit A-17, TreeContextMenu): a header naming it, the
  // frequent actions first with their keys, «Generar SQL ▸», then the data
  // actions, and the «Zona de peligro» last.
  const tableMenu = (node: TreeNode): MenuItem[] => {
    const isTable = node.kind === "table";
    const engine = props.engine ?? "";
    const items: MenuItem[] = [
      {
        heading: true,
        label: t(isTable ? "tree.menuHeadTable" : "tree.menuHeadView", { name: node.label, conn: props.title ?? "" }),
      },
      { label: t("tree.openData"), hint: keyHint("Enter"), action: () => props.onOpenData(node) },
    ];
    if (props.onOpenSql)
      items.push({
        label: t("tree.newQueryOn", { name: node.label }),
        action: () => props.onOpenSql!(selectSql(tableRef(node), engine), node.label),
      });
    items.push({ label: t("tree.viewStructure"), action: () => props.onOpenStructure(node) });
    if (!isTable) items.push({ label: t("tree.editDef"), action: () => props.onOpenStructure(node) });
    if (isTable && props.onAlterTable)
      items.push({ label: t("tree.alterTable"), hint: "F4", action: () => props.onAlterTable!(node) });
    if (isTable && props.onManageIndexes)
      items.push({ label: t("tree.indexes"), action: () => props.onManageIndexes!(node) });
    items.push({ separator: true });
    if (props.onOpenSql && hasTableSql(engine)) {
      items.push({
        label: t("tree.generateSql"),
        submenu: [
          { label: t("tree.gen.select"), action: () => void generate(node, "select") },
          ...(isTable
            ? [
                { label: "INSERT", action: () => void generate(node, "insert") },
                { label: "UPDATE", action: () => void generate(node, "update") },
                { label: "DELETE", action: () => void generate(node, "delete") },
              ]
            : []),
          { separator: true },
          { label: t(isTable ? "tree.gen.ddl" : "tree.gen.viewDdl"), action: () => void generate(node, "ddl") },
        ],
      });
    }
    items.push({ label: t("tree.copyName"), hint: keyHint("Mod+C"), action: () => copyText(node.label) });
    items.push({ label: t("tree.copyDdl"), action: () => void copyDdl(node) });
    items.push({ separator: true });
    if (props.onImport && isTable) items.push({ label: t("tree.importData"), action: () => props.onImport!(node) });
    if (props.onExport) items.push({ label: t("tree.export"), action: () => props.onExport!(node) });
    if (props.onGenerate && isTable)
      items.push({ label: t("tree.generateData"), action: () => props.onGenerate!(node) });
    if (isTable && ownMongoCollection(node)) {
      items.push({
        label: t("tree.renameCollection"),
        action: () => {
          setDropError(null);
          setRenameTo(node.label);
          setPendingColl({ kind: "rename", name: node.label });
        },
      });
    }
    if (props.onRefresh) items.push({ label: t("tree.refresh"), action: () => props.onRefresh!() });
    // The danger zone: emptying and deleting, apart and last.
    const danger: MenuItem[] = [];
    if (isTable && props.connId && truncateSql(tableRef(node), engine))
      danger.push({ label: t("tree.truncate"), hint: "TRUNCATE", danger: true, action: () => askTruncate(node) });
    if (isTable && ownMongoCollection(node))
      danger.push({
        label: t("tree.emptyCollection"),
        danger: true,
        action: () => {
          setDropError(null);
          setPendingColl({ kind: "empty", name: node.label });
        },
      });
    const drop = dropItem(node);
    if (drop) danger.push(drop);
    if (danger.length > 0) items.push({ separator: true }, { heading: true, label: t("tree.dangerZone") }, ...danger);
    return items;
  };

  const nodeMenu = (node: TreeNode): MenuItem[] => {
    const items: MenuItem[] = [];
    // A group folder (Tablas/Vistas/Procedimientos/…) only offers refresh.
    if (node.kind === "group") {
      if (props.onRefresh) items.push({ label: t("tree.refresh"), action: () => props.onRefresh!() });
      return items;
    }
    // A column, an index, a foreign key: its name.
    if (node.kind === "column" || node.kind === "index" || node.kind === "fk") {
      return [{ label: t("tree.copyName"), hint: keyHint("Mod+C"), action: () => copyText(node.label) }];
    }
    // Routine/trigger/event leaves: view their definition + copy name.
    if (isObjectLeaf(node.kind)) {
      if (props.onOpenSql) {
        items.push({ label: t("tree.viewDef"), action: () => void openObjectDef(node) });
        items.push({ separator: true });
      }
      items.push({ label: t("tree.copyName"), action: () => copyText(node.label) });
      pushDrop(items, node);
      return items;
    }
    if (isRelation(node.kind)) return tableMenu(node);
    // A database or schema: the connection's actions, scoped to it (TreeDbContextMenu).
    if (node.kind === "database" && props.connMenu) {
      const conn = props.connMenu(node.db ?? node.label);
      if (conn.length > 0) return conn;
    }
    if ((node.kind === "database" || node.kind === "schema") && props.onCreateTable) {
      items.push({ label: t("tree.newTable"), action: () => props.onCreateTable!(node) });
      items.push({ separator: true });
    }
    items.push({ label: t("tree.copyName"), action: () => copyText(node.label) });
    if (props.onRefresh) {
      items.push({ label: t("tree.refresh"), action: () => props.onRefresh!() });
    }
    pushDrop(items, node);
    return items;
  };

  /** A collection of the database a MongoDB connection is bound to — the only
      ones its statements can reach. */
  const ownMongoCollection = (node: TreeNode) =>
    engineFamily(props.engine ?? "") === "mongodb" &&
    !!props.connId &&
    !!props.connDatabase &&
    node.db === props.connDatabase;

  /** Which DROP a node is, if any: a routine leaf refines to procedure/function. */
  const dropKind = (node: TreeNode): DropKind | null => {
    if (node.kind === "table" || node.kind === "view") return node.kind;
    if (node.kind === "trigger" || node.kind === "event") return node.kind;
    if (node.kind === "routine") return routineKind(node.objType) as DropKind;
    return null;
  };

  /** "Eliminar…", last and apart — offered only where the engine can do it. */
  const pushDrop = (items: MenuItem[], node: TreeNode) => {
    const item = dropItem(node);
    if (!item) return;
    items.push({ separator: true });
    items.push(item);
  };
  const askDrop = (node: TreeNode) => {
    const item = dropItem(node);
    item?.action?.();
  };
  const dropItem = (node: TreeNode): MenuItem | null => {
    const kind = dropKind(node);
    if (!kind || !props.connId) return null;
    const sql = dropObjectSql(props.engine ?? "", {
      kind,
      name: node.label,
      db: node.db,
      schema: node.schema,
      table: node.objTable,
      connDb: props.connDatabase,
    });
    if (!sql) return null;
    return {
      label: t("tree.dropObject"),
      hint: isRelation(node.kind) ? keyHint("Delete") : undefined,
      danger: true,
      action: () => {
        setDropError(null);
        // Where it goes from, as the tree shows it: «Ventas › main».
        setPendingDrop({ key: node.key, name: node.label, sql, kind, where: where(node) });
        loadDropFacts(node);
      },
    };
  };

  // Text filter (issue #175): when non-blank, show matches + their ancestors
  // over the already-loaded tree; blank restores the real expansion state.
  const flat = createMemo(() =>
    filter().trim()
      ? flattenFiltered(roots(), children(), filter(), nodeLabel)
      : flattenTree(roots(), children(), expanded()),
  );
  // Keyboard navigation (issue #326). The rows were plain divs with an onClick: no
  // role, no tabIndex, so the object tree could not be reached at all without a
  // mouse and assistive tech saw a pile of generic boxes.
  //
  // Focus stays on the SCROLLER and the active row is published with
  // aria-activedescendant, rather than moving DOM focus onto the row itself. That is
  // the composite-widget half of the ARIA tree pattern, and it is the half that
  // survives virtualization: rows are recycled as the window slides, so a focused
  // row element can be destroyed under the user's feet.
  const [activeIndex, setActiveIndex] = createSignal(-1);

  const rowId = (index: number) => `objtree-row-${index}`;
  const rowH = () => props.rowHeight ?? ROW_HEIGHT;

  // «Mostrar en el explorador» (M14 TabContextMenu): open the levels above the
  // node, then make it the active row and hand the tree the focus.
  createEffect(
    on(
      () => props.reveal?.tick,
      () => {
        const key = props.reveal?.key;
        if (!key || !nodeByKey(key)) return;
        const kids = children();
        const parentOf = (k: string) =>
          Object.keys(kids).find((p) => kids[p].some((n) => n.key === k));
        const open: string[] = [];
        for (let p = parentOf(key); p; p = parentOf(p)) open.push(p);
        setFilter("");
        setExpanded((s) => new Set([...s, ...open]));
        const index = flat().findIndex((n) => n.key === key);
        if (index < 0) return;
        moveActive(index);
        scrollerEl?.focus();
      },
      { defer: true },
    ),
  );

  /** Moves the active row, keeping it inside the rendered window. */
  const moveActive = (next: number) => {
    const items = flat();
    if (items.length === 0) return;
    const clamped = Math.max(0, Math.min(items.length - 1, next));
    setActiveIndex(clamped);
    // Scroll it into view ourselves: the element may not exist yet.
    if (scrollerEl) {
      const top = clamped * rowH();
      const bottom = top + rowH();
      if (top < scrollerEl.scrollTop) {
        scrollerEl.scrollTop = top;
      } else if (bottom > scrollerEl.scrollTop + scrollerEl.clientHeight) {
        scrollerEl.scrollTop = bottom - scrollerEl.clientHeight;
      }
    }
  };

  /** Enter/Space do what a click does: a table or view opens its data (its
      caret, or the right arrow, expands it); a container opens. */
  const activate = (node: FlatNode) => {
    if (isRelation(node.kind)) props.onOpenData(node);
    else if (node.expandable) onToggle(node);
    else if (isObjectLeaf(node.kind)) void openObjectDef(node);
  };

  const onTreeKeyDown = (e: KeyboardEvent) => {
    const items = flat();
    if (items.length === 0) return;
    const i = activeIndex();
    const node = i >= 0 ? items[i] : undefined;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveActive(i < 0 ? 0 : i + 1);
        return;
      case "ArrowUp":
        e.preventDefault();
        moveActive(i < 0 ? 0 : i - 1);
        return;
      case "Home":
        e.preventDefault();
        moveActive(0);
        return;
      case "End":
        e.preventDefault();
        moveActive(items.length - 1);
        return;
      case "ArrowRight":
        // Open a closed node; on an open one, step into its first child.
        if (node?.expandable) {
          e.preventDefault();
          if (node.expanded) moveActive(i + 1);
          else onToggle(node);
        }
        return;
      case "ArrowLeft":
        // Close an open node; otherwise go out to the parent.
        if (node !== undefined) {
          e.preventDefault();
          if (node.expandable && node.expanded) {
            onToggle(node);
          } else {
            for (let j = i - 1; j >= 0; j--) {
              const candidate = items[j];
              if (candidate !== undefined && candidate.depth < node.depth) {
                moveActive(j);
                break;
              }
            }
          }
        }
        return;
      case "Enter":
      case " ":
        if (node !== undefined) {
          e.preventDefault();
          activate(node);
        }
        return;
      // The keys the table menu shows (audit A-17).
      case "F4":
        if (node?.kind === "table" && props.onAlterTable) {
          e.preventDefault();
          props.onAlterTable(node);
        }
        return;
      case "Delete":
        if (node && isRelation(node.kind)) {
          e.preventDefault();
          askDrop(node);
        }
        return;
      case "c":
      case "C":
        if (node && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          copyText(node.label);
        }
        return;
      default:
        return;
    }
  };

  const range = () =>
    visibleRange({
      scrollTop: scrollTop(),
      viewportHeight: viewportH(),
      rowHeight: rowH(),
      rowCount: flat().length,
    });

  // The header without a connection row: the generic title and its actions.
  const plainHeader = () => (
      <div class="objtree-header">
        <Show
          when={props.onToggleCollapse}
          fallback={<span>{props.title ?? t("toolbar.objects.label")}</span>}
        >
          <button
            class="objtree-title"
            aria-expanded={!props.collapsed}
            onClick={() => props.onToggleCollapse!()}
          >
            <span class="objtree-caret" aria-hidden="true">
              <Icon name={props.collapsed ? "chevron-right" : "chevron-down"} size={12} />
            </span>
            <Show when={props.accent}>
              <span class="conn-color" style={{ background: props.accent }} />
            </Show>
            <span class="objtree-title-text">
              {props.title ?? t("toolbar.objects.label")}
            </span>
          </button>
        </Show>
        <div class="objtree-actions">
          <Show when={props.connId && props.onOpenTools}>
            <button
              class="objtree-refresh"
              title={t("tree.tools")}
              aria-label={t("tree.tools")}
              onClick={(e) => props.onOpenTools!(e)}
            >
              <IconTools />
            </button>
          </Show>
          <Show when={props.connId && props.onRefresh}>
            <button
              class="objtree-refresh"
              title={t("tree.refreshTitle")}
              aria-label={t("tree.refresh")}
              onClick={() => props.onRefresh!()}
            >
              <Icon name="refresh" />
            </button>
          </Show>
          <Show when={props.connId && props.onDisconnect}>
            {/* Named after its connection: several sections carry this button,
                and "Desconectar" three times over says nothing about which one
                closes what — to a screen reader or to a test. */}
            <button
              class="objtree-refresh objtree-disconnect"
              title={t("conn.disconnectOf", { name: props.title ?? "" })}
              aria-label={t("conn.disconnectOf", { name: props.title ?? "" })}
              onClick={() => props.onDisconnect!()}
            >
              <Icon name="disconnect" />
            </button>
          </Show>
        </div>
      </div>
  );

  return (
    <div class="objtree">
      <Show when={props.conn} fallback={plainHeader()}>
        {(c) => (
          <div
            class="objtree-header connbar-item"
            classList={{ "is-focused": c().focused, "is-lost": !!c().lost }}
            onContextMenu={(e) => props.connMenu && openContextMenu(e, props.connMenu())}
            style={props.accent ? { "--conn-accent": props.accent } : undefined}
          >
            <span class="connbar-accent" aria-hidden="true" />
            <button
              class="objtree-caret-btn"
              aria-expanded={!props.collapsed}
              aria-label={t(props.collapsed ? "tree.expandConn" : "tree.collapseConn", {
                name: props.title ?? "",
              })}
              onClick={() => props.onToggleCollapse?.()}
            >
              <Icon name={props.collapsed ? "chevron-right" : "chevron-down"} size={12} />
            </button>
            <button
              class="connbar-pick"
              aria-current={c().focused ? "true" : undefined}
              title={t("connbar.focusTitle", { name: props.title ?? "" })}
              onClick={() => props.onFocusConn?.()}
            >
              <span class="connbar-mono" aria-hidden="true">
                {engineMonogram(c().driver)}
              </span>
              <span class="connbar-text">
                <span class="connbar-name">
                  {props.title}
                  <SafeBadge mode={c().safeMode} />
                </span>
                <span class="connbar-sub">
                  <span class="conn-dot" aria-hidden="true" />
                  <Show
                    when={c().lost || c().reconnecting || c().reconnected}
                    fallback={c().sub}
                  >
                    <Show
                      when={c().reconnecting || c().reconnected}
                      fallback={<span class="connbar-lost">{t("conn.statusLost")}</span>}
                    >
                      <span
                        class="connbar-reconnecting"
                        role="status"
                        title={c().reconnected ? t("conn.reconnected", { name: props.title ?? "" }) : undefined}
                      >
                        {t(c().reconnecting ? "conn.reconnecting" : "conn.statusReconnected")}
                      </span>
                    </Show>
                  </Show>
                </span>
              </span>
            </button>
            <div class="objtree-actions">
              <Show when={c().txStatements !== undefined}>
                <span class="conn-tx" title={countText("tx.openTitle", c().txStatements!)}>
                  {t("tx.connMark")}
                </span>
              </Show>
              <Show
                when={!(c().lost && !c().reconnecting)}
                fallback={
                  <button
                    class="objtree-reconnect"
                    disabled={c().busy}
                    onClick={() => props.onReconnect?.()}
                  >
                    {t("conn.reconnect")}
                  </button>
                }
              >
                <Show when={props.connId && props.onOpenTools}>
                  <button
                    class="objtree-refresh"
                    title={t("tree.tools")}
                    aria-label={t("tree.tools")}
                    onClick={(e) => props.onOpenTools!(e)}
                  >
                    <IconTools />
                  </button>
                </Show>
                <Show when={props.connId && props.onRefresh}>
                  <button
                    class="objtree-refresh"
                    title={t("tree.refreshTitle")}
                    aria-label={t("tree.refresh")}
                    onClick={() => props.onRefresh!()}
                  >
                    <Icon name="refresh" />
                  </button>
                </Show>
              </Show>
              <Show when={props.onDisconnect}>
                <button
                  class="objtree-refresh objtree-disconnect connbar-eject"
                  title={t("conn.disconnectOf", { name: props.title ?? "" })}
                  aria-label={t("conn.disconnectOf", { name: props.title ?? "" })}
                  disabled={c().busy}
                  onClick={() => props.onDisconnect!()}
                >
                  <Icon name="disconnect" />
                </button>
              </Show>
            </div>
          </div>
        )}
      </Show>
      {/* Outside the collapsible body on purpose: this is the working-database
          selector of the focused connection, and folding its section away used
          to take the control off the screen while it still governed the ER
          diagram, the query builder and the object list. */}
      {props.children}
      {/* Folded away with CSS rather than unmounted: a collapsed section keeps
          its expansion, filter and scroll for when it is opened again (#444). */}
      <div
        class="objtree-body"
        style={props.collapsed ? { display: "none" } : undefined}
      >
      <Show when={oldestCached()}>
        {(at) => (
          <div class="objtree-cached" role="status" title={t("tree.fromCacheTitle")}>
            {t("tree.fromCache", { age: timeAgo(at(), Date.now(), locale()) })}
          </div>
        )}
      </Show>
      <Show when={roots().length > 0}>
        <div class="objtree-filter">
          <Icon name="search" size={13} class="objtree-filter-ic" />
          <input
            type="text"
            class="objtree-filter-input"
            placeholder={t("tree.filterPlaceholder")}
            aria-label={t("tree.filterAria")}
            value={filter()}
            onInput={(e) => onFilterInput(e.currentTarget.value)}
          />
          <Show when={filter()}>
            <button class="objtree-filter-clear" title={t("tree.clearFilter")} aria-label={t("tree.clearFilter")} onClick={() => onFilterInput("")}>
              <Icon name="close" size={12} />
            </button>
          </Show>
        </div>
      </Show>
      <Show when={filter().trim()}>
        <div class="objtree-matches" role="status">
          {(() => {
            const n = filterMatchCount(flat(), filter(), nodeLabel);
            return t(n === 0 ? "tree.matchNone" : n === 1 ? "tree.matchOne" : "tree.matchN", { n });
          })()}
        </div>
      </Show>
      <Show when={error()}>
        <div class="objtree-error">{error()}</div>
      </Show>
      <Show
        when={roots().length > 0}
        fallback={
          <Show
            when={!rootLoading() && props.connId && !error()}
            fallback={
              <Show
                when={rootLoading()}
                fallback={
                  <Show when={!props.connId}>
                    <p class="sidebar-hint">{t("tree.connectHint")}</p>
                  </Show>
                }
              >
                <TreeSkeleton label={t("tree.loading")} />
              </Show>
            }
          >
            <EmptyNote
              title={t("tree.noObjects")}
              text={t("tree.noObjectsText")}
              action={props.onRefresh ? { label: t("tree.refresh"), onClick: () => props.onRefresh!() } : undefined}
            />
          </Show>
        }
      >
        <div
          class="objtree-scroll"
          ref={attachScroller}
          role="tree"
          aria-label={
            props.title
              ? t("tree.ariaLabelOf", { name: props.title })
              : t("tree.ariaLabel")
          }
          tabindex={0}
          aria-activedescendant={
            activeIndex() >= 0 ? rowId(activeIndex()) : undefined
          }
          onKeyDown={onTreeKeyDown}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <div class="objtree-spacer" style={{ height: `${range().totalHeight}px` }}>
            <div class="objtree-rows" style={{ transform: `translateY(${range().offsetY}px)` }}>
              <For each={flat().slice(range().start, range().end)}>
                {(node, i) => {
                  // Absolute position in the flattened tree, so ids and the active
                  // marker keep meaning as the virtual window slides.
                  const index = () => range().start + i();
                  return (
                  <div
                    id={rowId(index())}
                    class={`objtree-row ${
                      node.kind === "database" && node.db === props.activeDb
                        ? "is-active"
                        : ""
                    } ${activeIndex() === index() ? "is-focused" : ""}`}
                    role="treeitem"
                    aria-label={nodeLabel(node)}
                    aria-level={node.depth + 1}
                    aria-expanded={node.expandable ? node.expanded : undefined}
                    aria-selected={activeIndex() === index()}
                    style={{ "padding-left": `${node.depth * 14 + 4}px` }}
                    onClick={() => {
                      setActiveIndex(index());
                      activate(node);
                    }}
                    onDblClick={() => isRelation(node.kind) && props.onOpenStructure(node)}
                    onContextMenu={(e) => openContextMenu(e, nodeMenu(node))}
                    title={nodeLabel(node)}
                  >
                    <span
                      class="objtree-caret"
                      aria-hidden="true"
                      onClick={(e) => {
                        // A table's caret expands it; the row itself opens its data.
                        if (!node.expandable || !isRelation(node.kind)) return;
                        e.stopPropagation();
                        setActiveIndex(index());
                        onToggle(node);
                      }}
                    >
                      <Show when={node.expandable}>
                        <Icon name={node.expanded ? "chevron-down" : "chevron-right"} size={12} />
                      </Show>
                    </span>
                    <ObjectIcon kind={nodeKind(node)} size={15} />
                    <span class="objtree-label">{nodeLabel(node)}</span>
                    <Show when={node.kind === "database" && node.db === props.activeDb}>
                      <span class="objtree-active">{t("tree.activeMark")}</span>
                    </Show>
                    <Show when={node.kind === "group"}>
                      <span class="objtree-count">
                        {node.count ?? children()[node.key]?.length ?? ""}
                      </span>
                    </Show>
                    <Show when={node.meta ?? (rowCounts()[node.key] !== undefined ? countText("tree.rows", rowCounts()[node.key]) : undefined)}>
                      {(meta) => (
                        <span class="objtree-meta" title={node.kind === "table" ? t("tree.rowsEstimate") : undefined}>
                          {meta()}
                        </span>
                      )}
                    </Show>
                    <Show when={loading().has(node.key)}>
                      <span class="objtree-loading">…</span>
                    </Show>
                  </div>
                  );
                }}
              </For>
            </div>
          </div>
        </div>
      </Show>
      </div>

      {/* The exact DROP is shown before it runs, as every destructive action in
          the app does (issue #177). */}
      <Show when={pendingDrop()}>
        {(p) => (
          <ConfirmDialog
            title={dropConfirm(p().kind, p().name).title}
            message={dropConfirm(p().kind, p().name, p().where).message}
            sql={p().sql}
            copySql
            typeToConfirm={typedDrop() ? p().name : undefined}
            confirmLabel={dropConfirm(p().kind, p().name).confirm}
            busy={dropping()}
            error={dropError()}
            onConfirm={() => void runDrop(p().sql, typedDrop())}
            onCancel={() => setPendingDrop(null)}
          >
            <For each={dropConsequences(dropFacts())}>
              {(line) => (
                <Show when={line === dropDependants(dropFacts())} fallback={<p class="confirm-message">{line}</p>}>
                  {/* What breaks elsewhere is a warning, not one more fact (#807). */}
                  <p class="confirm-warn" role="note">
                    <Icon name="warning" size={14} />
                    <span>{line}</span>
                  </p>
                </Show>
              )}
            </For>
          </ConfirmDialog>
        )}
      </Show>

      <Show when={pendingTruncate()}>
        {(p) => (
          <ConfirmDialog
            title={t("tree.truncateTitle", { name: p().name })}
            message={t("tree.truncateMessage", { where: p().where })}
            sql={p().sql}
            confirmLabel={t("tree.truncateConfirm")}
            typeToConfirm={props.conn?.safeMode ? p().name : undefined}
            busy={dropping()}
            error={dropError()}
            onConfirm={() => void runDrop(p().sql)}
            onCancel={() => setPendingTruncate(null)}
          />
        )}
      </Show>

      <Show when={pendingColl()}>
        {(p) => (
          <ConfirmDialog
            title={t(p().kind === "empty" ? "tree.emptyTitle" : "tree.renameTitle", { name: p().name })}
            message={t(p().kind === "empty" ? "tree.emptyMessage" : "tree.renameMessage", {
              name: p().name,
            })}
            sql={collSql() ?? undefined}
            confirmLabel={t(p().kind === "empty" ? "tree.emptyConfirm" : "tree.renameConfirm")}
            busy={dropping()}
            error={
              dropError() ??
              (p().kind === "rename" && !collSql() ? t("tree.renameInvalid") : null)
            }
            onConfirm={() => {
              const sql = collSql();
              if (sql) void runDrop(sql);
            }}
            onCancel={closeColl}
          >
            <Show when={p().kind === "rename"}>
              <label class="confirm-field">
                {t("tree.renameLabel")}
                <input
                  class="td-in"
                  value={renameTo()}
                  onInput={(e) => setRenameTo(e.currentTarget.value)}
                />
              </label>
            </Show>
          </ConfirmDialog>
        )}
      </Show>
    </div>
  );
}

/** The tree while its first level loads (TreeLoading): rows to come, not a
    spinner — the layout does not jump when they arrive. */
export function TreeSkeleton(props: { label: string }) {
  return (
    <div class="objtree-skeleton" role="status" aria-busy="true" aria-label={props.label}>
      <For each={[0, 1, 1, 2, 2, 2]}>
        {(depth, i) => (
          <span class="objtree-skeleton-row" style={{ "padding-left": `${depth * 14 + 8}px` }}>
            <span class="objtree-skeleton-bar" style={{ width: `${[90, 70, 110, 80, 120, 95][i()]}px` }} />
          </span>
        )}
      </For>
    </div>
  );
}
