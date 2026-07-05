// Fuzzy subsequence matching for the command palette (issue #174). A query
// matches a text when its characters appear in order (not necessarily
// contiguous), case-insensitively — so "usmon" matches "Usuarios y monitor".
// The score rewards matches at word starts and contiguous runs, so the most
// intuitive hit ranks first. Pure and fully tested.

export interface FuzzyResult {
  /** Whether every query char was found in order. */
  matched: boolean;
  /** Higher is a better match; 0 for an empty query or a non-match. */
  score: number;
}

const isAlnum = (c: string): boolean => /[a-z0-9]/i.test(c);

/**
 * Match `query` against `text` as an ordered subsequence. An empty query
 * matches everything with score 0 (so an empty palette shows all commands).
 */
export function fuzzyMatch(query: string, text: string): FuzzyResult {
  const q = query.trim().toLowerCase();
  if (q === "") return { matched: true, score: 0 };
  const t = text.toLowerCase();

  let qi = 0;
  let score = 0;
  let streak = 0;
  let prev = -2; // index of the previous matched char in `t`
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    let bonus = 1;
    // Word-start (start of string or after a separator) is a strong signal.
    if (ti === 0 || !isAlnum(t[ti - 1])) bonus += 3;
    // Contiguous runs matter: each consecutive char extends the streak bonus.
    if (prev === ti - 1) {
      streak += 1;
      bonus += streak * 2;
    } else {
      streak = 0;
    }
    score += bonus;
    prev = ti;
    qi += 1;
  }

  const matched = qi === q.length;
  return { matched, score: matched ? score : 0 };
}
