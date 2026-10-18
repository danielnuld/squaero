// Line diff for the editor's local history (issue #674): what changed between a
// saved version of a tab and the text it holds now. A plain LCS over lines, after
// stripping the common head and tail — an edit to a script usually touches a few
// lines in the middle, so the table that is left is small.

export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

/** Ceiling on the LCS table (lines × lines) after the common head and tail are
    stripped. Past it the diff is refused, not approximated: the caller says the
    texts are too different to compare instead of showing a wrong diff. */
export const MAX_DIFF_CELLS = 4_000_000;

/**
 * The lines of `before` turned into `after`: removed lines as `del`, inserted
 * ones as `add`, the rest `same`, in reading order (a change shows its removals
 * before its additions). Null when the changed middle is too big to compare
 * (see MAX_DIFF_CELLS).
 */
export function diffLines(before: string, after: string): DiffLine[] | null {
  const a = before === "" ? [] : before.split(/\r?\n/);
  const b = after === "" ? [] : after.split(/\r?\n/);

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }

  const am = a.slice(head, a.length - tail);
  const bm = b.slice(head, b.length - tail);
  const n = am.length;
  const m = bm.length;
  if (n * m > MAX_DIFF_CELLS) return null;

  // lcs[i][j] = LCS length of am[i..] and bm[j..], flattened.
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] =
        am[i] === bm[j]
          ? lcs[(i + 1) * w + j + 1] + 1
          : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }

  const out: DiffLine[] = a.slice(0, head).map((text) => ({ kind: "same", text }));
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (am[i] === bm[j]) {
      out.push({ kind: "same", text: am[i] });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
      out.push({ kind: "del", text: am[i++] });
    } else {
      out.push({ kind: "add", text: bm[j++] });
    }
  }
  while (i < n) out.push({ kind: "del", text: am[i++] });
  while (j < m) out.push({ kind: "add", text: bm[j++] });
  for (const text of a.slice(a.length - tail)) out.push({ kind: "same", text });
  return out;
}
