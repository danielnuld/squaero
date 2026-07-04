import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { visibleRange } from "../utils/virtualize";
import {
  flattenTree,
  toggleExpanded,
  childKey,
  databaseKey,
  type TreeNode,
  type FlatNode,
} from "../utils/tree";
import { schemaTree, parseTreeRows, type NodeKind } from "../utils/schema";
import { openContextMenu, type MenuItem } from "../utils/contextMenu";
import { copyText } from "../utils/rowCopy";

const ROW_HEIGHT = 24;

const KIND_BADGE: Record<NodeKind, string> = {
  database: "db",
  schema: "sch",
  table: "tbl",
  view: "vw",
};

// Lazy, virtualized object tree. Children of a container are fetched from the
// core only when it is expanded (schema.tree), and the visible (expanded) nodes
// are flattened and windowed so nodes outside the viewport are never rendered
// (.rules/frontend.md §2). Tree shape/flatten logic is pure (src/utils/tree.ts).
export function ObjectTree(props: {
  connId: string | null;
  /** Double-click a table/view -> open its structure. */
  onOpenStructure: (node: TreeNode) => void;
  /** Single-click a table/view -> open its data (a SELECT). */
  onOpenData: (node: TreeNode) => void;
  /** Bumping this re-fetches the tree from the current connection (issue #107). */
  reloadKey?: number;
  /** Refresh button in the header (re-runs the active query + reloads the tree). */
  onRefresh?: () => void;
  /** Right-click "Importar datos…" on a table/view. */
  onImport?: (node: TreeNode) => void;
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

  const loadChildren = async (node: TreeNode) => {
    const connId = props.connId;
    if (!connId || children()[node.key]) {
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
      setChildren((c) => ({ ...c, [node.key]: built }));
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
    if (node.kind === "table" || node.kind === "view") {
      items.push({ label: "Abrir datos", action: () => props.onOpenData(node) });
      items.push({ label: "Ver estructura", action: () => props.onOpenStructure(node) });
      if (node.kind === "view") {
        items.push({ label: "Editar definición…", action: () => props.onOpenStructure(node) });
      }
      if (props.onImport) {
        items.push({ label: "Importar datos…", action: () => props.onImport!(node) });
      }
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
                    onClick={() => (node.expandable ? onToggle(node) : props.onOpenData(node))}
                    onDblClick={() => !node.expandable && props.onOpenStructure(node)}
                    onContextMenu={(e) => openContextMenu(e, nodeMenu(node))}
                    title={node.label}
                  >
                    <span class="objtree-caret">
                      {node.expandable ? (node.expanded ? "▾" : "▸") : ""}
                    </span>
                    <span class={`objtree-badge kind-${node.kind}`}>{KIND_BADGE[node.kind]}</span>
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
