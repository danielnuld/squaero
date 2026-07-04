// Pure object-tree model. Databases and schemas are expandable containers
// (children lazy-loaded from the core); tables and views are leaves whose
// double-click opens the structure view. The tree is flattened to the list of
// currently-visible nodes so it can be windowed by the same virtualization math
// as the grid (.rules/frontend.md §2: no tree nodes outside the viewport).

import type { NodeKind } from "./schema";

/** Tree node kinds, including the UI-only "group" (a Tablas/Vistas folder that
    groups leaf objects by type — it is never returned by the core). */
export type TreeNodeKind = NodeKind | "group";

export interface TreeNode {
  /** Unique, stable path key (e.g. "db:main" or "db:main/tbl:users"). */
  key: string;
  label: string;
  kind: TreeNodeKind;
  /** Database context for lazy-loading this node's children. */
  db?: string;
  /** Schema context (engines with schemas). */
  schema?: string;
  /** For a "group" node: the leaf kind it groups, and how many it holds. */
  groupKind?: "table" | "view";
  count?: number;
}

export interface FlatNode extends TreeNode {
  depth: number;
  expandable: boolean;
  expanded: boolean;
}

/** Containers can be expanded; tables/views are leaves. Group folders (Tablas/
    Vistas) are expandable too — their children are pre-loaded, not fetched. */
export function isExpandable(kind: TreeNodeKind): boolean {
  return kind === "database" || kind === "schema" || kind === "group";
}

/**
 * Groups leaf objects (tables/views) under synthetic "Tablas"/"Vistas" folder
 * nodes (issue #135, phase 1). Returns the folder nodes (only for non-empty
 * types) plus the members map to merge into childrenByKey. A single type still
 * gets its folder, for consistency. Non-table/view kinds are ignored (leaf
 * levels only ever hold tables and views). Pure.
 */
export function groupObjectsByType(
  parentKey: string,
  db: string | undefined,
  schema: string | undefined,
  nodes: TreeNode[],
): { groups: TreeNode[]; members: Record<string, TreeNode[]> } {
  const groups: TreeNode[] = [];
  const members: Record<string, TreeNode[]> = {};
  const add = (tag: string, label: string, gkind: "table" | "view") => {
    const list = nodes.filter((n) => n.kind === gkind);
    if (list.length === 0) return;
    const key = `${parentKey}/grp:${tag}`;
    groups.push({ key, label, kind: "group", db, schema, groupKind: gkind, count: list.length });
    members[key] = list;
  };
  add("tbl", "Tablas", "table");
  add("vw", "Vistas", "view");
  return { groups, members };
}

/** Builds a child node's stable key under a parent key. Each kind gets a
   distinct tag so a table and a view of the same name never collide. */
export function childKey(parentKey: string, kind: NodeKind, name: string): string {
  const tag =
    kind === "database" ? "db" : kind === "schema" ? "sch" : kind === "view" ? "vw" : "tbl";
  return `${parentKey}/${tag}:${name}`;
}

/** Root node key for a database. */
export function databaseKey(name: string): string {
  return `db:${name}`;
}

/** Toggles a key's presence in the expanded set, returning a new set. */
export function toggleExpanded(expanded: Set<string>, key: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

/**
 * Depth-first flattening of the visible tree: a node's children (from
 * `childrenByKey`) are included only when its key is in `expanded`. Pure — given
 * the same inputs it yields the same ordered list. Nodes whose children are not
 * yet loaded simply contribute themselves (the caller fetches on expand).
 */
export function flattenTree(
  roots: TreeNode[],
  childrenByKey: Record<string, TreeNode[]>,
  expanded: Set<string>,
): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      const isExp = expanded.has(node.key);
      out.push({
        ...node,
        depth,
        expandable: isExpandable(node.kind),
        expanded: isExp,
      });
      if (isExp) {
        const children = childrenByKey[node.key];
        if (children && children.length > 0) {
          walk(children, depth + 1);
        }
      }
    }
  };
  walk(roots, 0);
  return out;
}
