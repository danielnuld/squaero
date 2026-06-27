// Pure object-tree model. Databases and schemas are expandable containers
// (children lazy-loaded from the core); tables and views are leaves whose
// double-click opens the structure view. The tree is flattened to the list of
// currently-visible nodes so it can be windowed by the same virtualization math
// as the grid (.rules/frontend.md §2: no tree nodes outside the viewport).

import type { NodeKind } from "./schema";

export interface TreeNode {
  /** Unique, stable path key (e.g. "db:main" or "db:main/tbl:users"). */
  key: string;
  label: string;
  kind: NodeKind;
  /** Database context for lazy-loading this node's children. */
  db?: string;
  /** Schema context (engines with schemas). */
  schema?: string;
}

export interface FlatNode extends TreeNode {
  depth: number;
  expandable: boolean;
  expanded: boolean;
}

/** Containers can be expanded; tables/views are leaves. */
export function isExpandable(kind: NodeKind): boolean {
  return kind === "database" || kind === "schema";
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
