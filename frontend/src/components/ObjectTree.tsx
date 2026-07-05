import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { visibleRange } from "../utils/virtualize";
import {
  flattenTree,
  toggleExpanded,
  childKey,
  databaseKey,
  groupObjectsByType,
  lazyObjectFolders,
  objectLeafNodes,
  type TreeNode,
  type FlatNode,
} from "../utils/tree";
import { schemaTree, parseTreeRows, type NodeKind } from "../utils/schema";
import { runQuery } from "../utils/query";
import { folderSpec, objectLeaves, readDefinitionText } from "../utils/treeObjects";
import { definitionFor as routineDefinitionFor, type RoutineType } from "../utils/routines";
import { definitionFor as objectDefinitionFor } from "../utils/triggers";
import { openContextMenu, type MenuItem } from "../utils/contextMenu";
import { copyText } from "../utils/rowCopy";

const ROW_HEIGHT = 24;

/** True for a routine/trigger/event leaf (listed on demand, opens its DDL). */
function isObjectLeaf(kind: TreeNode["kind"]): boolean {
  return kind === "routine" || kind === "trigger" || kind === "event";
}

const KIND_BADGE: Record<string, string> = {
  database: "db",
  schema: "sch",
  table: "tbl",
  view: "vw",
  routine: "ƒ",
  trigger: "⚡",
  event: "⏱",
};

// Lazy, virtualized object tree. Children of a container are fetched from the
// core only when it is expanded (schema.tree), and the visible (expanded) nodes
// are flattened and windowed so nodes outside the viewport are never rendered
// (.rules/frontend.md §2). Tree shape/flatten logic is pure (src/utils/tree.ts).
export function ObjectTree(props: {
  connId: string | null;
  /** Active engine/driver name, for listing routines/triggers (issue #135 ph.2). */
  engine?: string;
  /** Double-click a table/view -> open its structure. */
  onOpenStructure: (node: TreeNode) => void;
  /** Single-click a table/view -> open its data (a SELECT). */
  onOpenData: (node: TreeNode) => void;
  /** Open SQL (a routine/trigger DDL) in a new query tab. */
  onOpenSql?: (sql: string) => void;
  /** Bumping this re-fetches the tree from the current connection (issue #107). */
  reloadKey?: number;
  /** Refresh button in the header (re-runs the active query + reloads the tree). */
  onRefresh?: () => void;
  /** Right-click "Importar datos…" on a table/view. */
  onImport?: (node: TreeNode) => void;
  /** Right-click "Nueva tabla…" on a database/schema. */
  onCreateTable?: (node: TreeNode) => void;
  /** Right-click "Modificar tabla…" on a table. */
  onAlterTable?: (node: TreeNode) => void;
}) {
  const [roots, setRoots] = createSignal<TreeNode[]>([]);
  const [children, setChildren] = createSignal<Record<string, TreeNode[]>>({});
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [loading, setLoading] = createSignal<Set<string>>(new Set());
  const [rootLoading, setRootLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Bumped on every connection change; async loads from a stale connection
  // check it before writing state, so switching connections mid-fetch cannot
  // stomp the new connection's tree.
  let generation = 0;

  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportH, setViewportH] = createSignal(0);

  // The scroller only exists once a connection has roots (it lives inside a
  // <Show>), so measuring it in onMount runs before it exists and leaves the
  // viewport height at 0 — which collapses the virtual window to just the
  // overscan rows, so the tree never filled the sidebar. Measure from a callback
  // ref instead: it fires (and re-attaches the ResizeObserver) whenever the
  // scroller element appears or is replaced. Same fix as ResultGrid.
  let ro: ResizeObserver | undefined;
  const attachScroller = (el: HTMLDivElement) => {
    setViewportH(el.clientHeight);
    ro?.disconnect();
    ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
  };
  onCleanup(() => ro?.disconnect());

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
    if (!connId) {
      setRootLoading(false);
      return;
    }
    setRootLoading(true);
    void (async () => {
      try {
        const res = await schemaTree(connId);
        if (myGen !== generation) return; // connection changed mid-flight
        setRoots(
          parseTreeRows(res, "database").map((r) => ({
            key: databaseKey(r.name),
            label: r.name,
            kind: r.kind,
            db: r.name,
          })),
        );
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

  const loadChildren = async (node: TreeNode) => {
    const connId = props.connId;
    if (!connId || children()[node.key]) {
      return;
    }
    if (node.kind === "group") {
      // Tablas/Vistas folders are pre-loaded; only the lazy object-type folders
      // (Procedimientos/…) fetch their members on expand.
      if (node.lazy) await loadLazyFolder(node);
      return;
    }
    const myGen = generation;
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
      const built = buildChildren(node, parseTreeRows(res, "schema"));
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
      } else {
        setChildren((c) => ({ ...c, [node.key]: [...built, ...folders] }));
      }
    } catch (err) {
      if (myGen === generation) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (myGen === generation) setBusy(node.key, false);
    }
  };

  // Fetch a routine/trigger/event leaf's definition (DDL) and open it in a new
  // query tab. Reuses the per-engine definition SQL from routines.ts/triggers.ts.
  const openObjectDef = async (node: TreeNode) => {
    const connId = props.connId;
    if (!connId || !props.onOpenSql) return;
    // SQLite triggers carry their DDL in the listing row — open it directly.
    if (node.objDef) {
      props.onOpenSql(node.objDef);
      return;
    }
    const engine = props.engine ?? "";
    const query =
      node.kind === "routine"
        ? routineDefinitionFor(engine, {
            name: node.label,
            type: (node.objType?.toUpperCase().includes("FUNCTION") ? "FUNCTION" : "PROCEDURE") as RoutineType,
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
      if (text) props.onOpenSql(text);
    } catch (err) {
      if (myGen === generation) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (myGen === generation) setBusy(node.key, false);
    }
  };

  const onToggle = (node: FlatNode) => {
    if (!node.expandable) {
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
  const nodeMenu = (node: TreeNode): MenuItem[] => {
    const items: MenuItem[] = [];
    // A group folder (Tablas/Vistas/Procedimientos/…) only offers refresh.
    if (node.kind === "group") {
      if (props.onRefresh) items.push({ label: "Refrescar", action: () => props.onRefresh!() });
      return items;
    }
    // Routine/trigger/event leaves: view their definition + copy name.
    if (isObjectLeaf(node.kind)) {
      if (props.onOpenSql) {
        items.push({ label: "Ver definición…", action: () => void openObjectDef(node) });
        items.push({ separator: true });
      }
      items.push({ label: "Copiar nombre", action: () => copyText(node.label) });
      return items;
    }
    if (node.kind === "table" || node.kind === "view") {
      items.push({ label: "Abrir datos", action: () => props.onOpenData(node) });
      items.push({ label: "Ver estructura", action: () => props.onOpenStructure(node) });
      if (node.kind === "view") {
        items.push({ label: "Editar definición…", action: () => props.onOpenStructure(node) });
      }
      if (node.kind === "table" && props.onAlterTable) {
        items.push({ label: "Modificar tabla…", action: () => props.onAlterTable!(node) });
      }
      if (props.onImport) {
        items.push({ label: "Importar datos…", action: () => props.onImport!(node) });
      }
      items.push({ separator: true });
    }
    if ((node.kind === "database" || node.kind === "schema") && props.onCreateTable) {
      items.push({ label: "Nueva tabla…", action: () => props.onCreateTable!(node) });
      items.push({ separator: true });
    }
    items.push({ label: "Copiar nombre", action: () => copyText(node.label) });
    if (props.onRefresh) {
      items.push({ label: "Refrescar", action: () => props.onRefresh!() });
    }
    return items;
  };

  const flat = () => flattenTree(roots(), children(), expanded());
  const range = () =>
    visibleRange({
      scrollTop: scrollTop(),
      viewportHeight: viewportH(),
      rowHeight: ROW_HEIGHT,
      rowCount: flat().length,
    });

  return (
    <div class="objtree">
      <div class="objtree-header">
        <span>Objetos</span>
        <Show when={props.connId && props.onRefresh}>
          <button
            class="objtree-refresh"
            title="Refrescar (F5)"
            aria-label="Refrescar"
            onClick={() => props.onRefresh!()}
          >
            ⟳
          </button>
        </Show>
      </div>
      <Show when={error()}>
        <div class="objtree-error">{error()}</div>
      </Show>
      <Show
        when={roots().length > 0}
        fallback={
          <p class="sidebar-hint">
            {rootLoading()
              ? "Cargando…"
              : props.connId
                ? "Sin objetos."
                : "Conecta para explorar el esquema."}
          </p>
        }
      >
        <div
          class="objtree-scroll"
          ref={attachScroller}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <div class="objtree-spacer" style={{ height: `${range().totalHeight}px` }}>
            <div class="objtree-rows" style={{ transform: `translateY(${range().offsetY}px)` }}>
              <For each={flat().slice(range().start, range().end)}>
                {(node) => (
                  <div
                    class="objtree-row"
                    style={{ "padding-left": `${node.depth * 14 + 4}px` }}
                    onClick={() => {
                      if (node.expandable) onToggle(node);
                      else if (isObjectLeaf(node.kind)) void openObjectDef(node);
                      else props.onOpenData(node);
                    }}
                    onDblClick={() =>
                      (node.kind === "table" || node.kind === "view") &&
                      props.onOpenStructure(node)
                    }
                    onContextMenu={(e) => openContextMenu(e, nodeMenu(node))}
                    title={node.label}
                  >
                    <span class="objtree-caret">
                      {node.expandable ? (node.expanded ? "▾" : "▸") : ""}
                    </span>
                    <span class={`objtree-badge kind-${node.kind}`}>
                      {node.kind === "group"
                        ? (node.count ?? children()[node.key]?.length ?? "")
                        : KIND_BADGE[node.kind]}
                    </span>
                    <span class="objtree-label">{node.label}</span>
                    <Show when={loading().has(node.key)}>
                      <span class="objtree-loading">…</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
