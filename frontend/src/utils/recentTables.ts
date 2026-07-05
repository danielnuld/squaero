// Recently-opened tables/views (issue #178), for the editor empty state. App
// records a node each time the user opens its data or structure; the empty state
// offers them as quick shortcuts. Pure list management (prepend, dedupe by the
// tree's stable node key, cap) so it is unit-testable without a DOM.

import type { TreeNode } from "./tree";

export const DEFAULT_RECENT_MAX = 6;

/**
 * Prepend `node` to `list` as most-recent, removing any earlier entry for the
 * same node (dedupe by the stable tree key) and capping the length. Returns a
 * new array; `list` is not mutated. Non-table/view nodes are ignored (returns
 * `list` unchanged) so containers never pollute the shortcuts.
 */
export function pushRecent(
  list: TreeNode[],
  node: TreeNode,
  max: number = DEFAULT_RECENT_MAX,
): TreeNode[] {
  if (node.kind !== "table" && node.kind !== "view") return list;
  const rest = list.filter((n) => n.key !== node.key);
  return [node, ...rest].slice(0, Math.max(0, max));
}
