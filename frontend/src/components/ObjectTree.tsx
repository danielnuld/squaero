import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from "solid-js";
import { visibleRange } from "../utils/virtualize";
import {
  flattenTree,
  flattenFiltered,
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
import { runnableRoutineDdl } from "../utils/routineDdl";
import { dropObjectSql, type DropKind } from "../utils/dropObject";
import { ConfirmDialog } from "./ConfirmDialog";
import { openContextMenu, type MenuItem } from "../utils/contextMenu";
import { copyText } from "../utils/rowCopy";
import { objectBadge, routineKind } from "../utils/objectIcons";
import { t } from "../utils/i18n";

// A group folder's label is an i18n key ("tree.tables"); real object nodes carry
// their true name. Translate only the former so object names pass through as-is.
const nodeLabel = (node: TreeNode): string =>
  node.kind === "group" ? t(node.label) : node.label;

const ROW_HEIGHT = 24;

/** True for a routine/trigger/event leaf (listed on demand, opens its DDL). */
function isObjectLeaf(kind: TreeNode["kind"]): boolean {
  return kind === "routine" || kind === "trigger" || kind === "event";
}

// Badge for a tree node, resolved from the canonical icon set (#185). Object-type
// folders (group) show a neutral count chip; a routine leaf refines its badge to
// procedure/function from the type it was listed with.
function nodeBadge(node: TreeNode): { text: string; className: string } {
  if (node.kind === "routine") return objectBadge(routineKind(node.objType));
  return objectBadge(node.kind);
}

// Colored glyph for a type folder (Tablas/Vistas/…), matching the per-type
// palette (design proposal, move 2). Folders show this icon + a right-aligned
// count instead of a text badge, so the tree reads like a Navicat navigator.
const FOLDER_ICONS: Record<string, string> = {
  table: "▦",
  view: "◈",
  procedure: "▶",
  function: "ƒ",
  trigger: "⟲",
  event: "◷",
};
const folderKind = (node: TreeNode): string => node.groupKind ?? "table";
const folderGlyph = (node: TreeNode): string => FOLDER_ICONS[folderKind(node)] ?? "▸";

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
  /** Opens the connection tools menu (🧰 in the header). */
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
  /** Clicking a database/schema node makes it the working database. */
  onSelectDatabase?: (name: string) => void;
  /** Name of the current working database; its tree node is highlighted. */
  activeDb?: string;
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
  /** Rendered right under the header — the working-database selector of the
      focused connection. */
  children?: JSX.Element;
}) {
  const [roots, setRoots] = createSignal<TreeNode[]>([]);
  const [children, setChildren] = createSignal<Record<string, TreeNode[]>>({});
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [loading, setLoading] = createSignal<Set<string>>(new Set());
  const [rootLoading, setRootLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [filter, setFilter] = createSignal("");

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
  const [pendingDrop, setPendingDrop] = createSignal<{ name: string; sql: string } | null>(null);
  const [dropping, setDropping] = createSignal(false);
  const [dropError, setDropError] = createSignal<string | null>(null);

  const runDrop = async (sql: string) => {
    const connId = props.connId;
    if (!connId) return;
    setDropping(true);
    setDropError(null);
    try {
      await runQuery(connId, sql);
      setPendingDrop(null);
      props.onRefresh?.();
    } catch (err) {
      setDropError(err instanceof Error ? err.message : String(err));
    } finally {
      setDropping(false);
    }
  };

  const nodeMenu = (node: TreeNode): MenuItem[] => {
    const items: MenuItem[] = [];
    // A group folder (Tablas/Vistas/Procedimientos/…) only offers refresh.
    if (node.kind === "group") {
      if (props.onRefresh) items.push({ label: t("tree.refresh"), action: () => props.onRefresh!() });
      return items;
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
    if (node.kind === "table" || node.kind === "view") {
      items.push({ label: t("tree.openData"), action: () => props.onOpenData(node) });
      items.push({ label: t("tree.viewStructure"), action: () => props.onOpenStructure(node) });
      if (node.kind === "view") {
        items.push({ label: t("tree.editDef"), action: () => props.onOpenStructure(node) });
      }
      if (node.kind === "table" && props.onAlterTable) {
        items.push({ label: t("tree.alterTable"), action: () => props.onAlterTable!(node) });
      }
      if (node.kind === "table" && props.onManageIndexes) {
        items.push({ label: t("tree.indexes"), action: () => props.onManageIndexes!(node) });
      }
      if (props.onImport) {
        items.push({ label: t("tree.importData"), action: () => props.onImport!(node) });
      }
      items.push({ separator: true });
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

  /** Which DROP a node is, if any: a routine leaf refines to procedure/function. */
  const dropKind = (node: TreeNode): DropKind | null => {
    if (node.kind === "table" || node.kind === "view") return node.kind;
    if (node.kind === "trigger" || node.kind === "event") return node.kind;
    if (node.kind === "routine") return routineKind(node.objType) as DropKind;
    return null;
  };

  /** "Eliminar…", last and apart — offered only where the engine can do it. */
  const pushDrop = (items: MenuItem[], node: TreeNode) => {
    const kind = dropKind(node);
    if (!kind || !props.connId) return;
    const sql = dropObjectSql(props.engine ?? "", {
      kind,
      name: node.label,
      db: node.db,
      schema: node.schema,
      table: node.objTable,
    });
    if (!sql) return;
    items.push({ separator: true });
    items.push({
      label: t("tree.dropObject"),
      danger: true,
      action: () => {
        setDropError(null);
        setPendingDrop({ name: node.label, sql });
      },
    });
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

  /** Moves the active row, keeping it inside the rendered window. */
  const moveActive = (next: number) => {
    const items = flat();
    if (items.length === 0) return;
    const clamped = Math.max(0, Math.min(items.length - 1, next));
    setActiveIndex(clamped);
    // Scroll it into view ourselves: the element may not exist yet.
    if (scrollerEl) {
      const top = clamped * ROW_HEIGHT;
      const bottom = top + ROW_HEIGHT;
      if (top < scrollerEl.scrollTop) {
        scrollerEl.scrollTop = top;
      } else if (bottom > scrollerEl.scrollTop + scrollerEl.clientHeight) {
        scrollerEl.scrollTop = bottom - scrollerEl.clientHeight;
      }
    }
  };

  /** Enter/Space do what a click does. */
  const activate = (node: FlatNode) => {
    if (node.expandable) onToggle(node);
    else if (isObjectLeaf(node.kind)) void openObjectDef(node);
    else props.onOpenData(node);
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
      default:
        return;
    }
  };

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
              {props.collapsed ? "▸" : "▾"}
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
              🧰
            </button>
          </Show>
          <Show when={props.connId && props.onRefresh}>
            <button
              class="objtree-refresh"
              title={t("tree.refreshTitle")}
              aria-label={t("tree.refresh")}
              onClick={() => props.onRefresh!()}
            >
              ⟳
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
              ⏏
            </button>
          </Show>
        </div>
      </div>
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
      <Show when={roots().length > 0}>
        <div class="objtree-filter">
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
              ✕
            </button>
          </Show>
        </div>
      </Show>
      <Show when={error()}>
        <div class="objtree-error">{error()}</div>
      </Show>
      <Show
        when={roots().length > 0}
        fallback={
          <p class="sidebar-hint">
            {rootLoading()
              ? t("tree.loading")
              : props.connId
                ? t("tree.noObjects")
                : t("tree.connectHint")}
          </p>
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
                    onDblClick={() =>
                      (node.kind === "table" || node.kind === "view") &&
                      props.onOpenStructure(node)
                    }
                    onContextMenu={(e) => openContextMenu(e, nodeMenu(node))}
                    title={nodeLabel(node)}
                  >
                    <span class="objtree-caret" aria-hidden="true">
                      {node.expandable ? (node.expanded ? "▾" : "▸") : ""}
                    </span>
                    <Show
                      when={node.kind === "group"}
                      fallback={
                        <span class={`objtree-badge ${nodeBadge(node).className}`}>
                          {nodeBadge(node).text}
                        </span>
                      }
                    >
                      <span
                        class="objtree-folder-ic"
                        style={{ color: `var(--obj-${folderKind(node)})` }}
                        aria-hidden="true"
                      >
                        {folderGlyph(node)}
                      </span>
                    </Show>
                    <span class="objtree-label">{nodeLabel(node)}</span>
                    <Show when={node.kind === "group"}>
                      <span class="objtree-count">
                        {node.count ?? children()[node.key]?.length ?? ""}
                      </span>
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
            title={t("tree.dropTitle", { name: p().name })}
            message={t("tree.dropMessage", { name: p().name })}
            sql={p().sql}
            confirmLabel={t("tree.dropConfirm")}
            busy={dropping()}
            error={dropError()}
            onConfirm={() => void runDrop(p().sql)}
            onCancel={() => setPendingDrop(null)}
          />
        )}
      </Show>
    </div>
  );
}
