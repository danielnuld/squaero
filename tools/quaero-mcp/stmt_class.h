#ifndef QUAERO_MCP_STMT_CLASS_H
#define QUAERO_MCP_STMT_CLASS_H

/*
 * Pure SQL statement classifier for the MCP read-only gate (issue #184).
 *
 * The MCP server refuses to run anything that is not provably read-only when a
 * connection is not writable. This classifier is the security boundary, so it
 * is deliberately FAIL-CLOSED: anything it cannot prove to be read-only is
 * reported as a write. It is engine-agnostic and defends against the usual
 * evasion tricks — line/block comments, quoted strings that embed keywords or
 * semicolons, both quote-escape conventions (`''` doubling and `\'`
 * backslash-escaping), data-modifying CTEs (`WITH ... AS (DELETE ...) ...`),
 * and multi-statement payloads (`SELECT 1; DROP TABLE t`).
 *
 * It classifies text only; it never executes anything.
 */

typedef enum {
    STMT_EMPTY = 0, /* no statement (blank / only comments) */
    STMT_READ = 1,  /* provably read-only (SELECT/WITH..SELECT/EXPLAIN/SHOW/...) */
    STMT_WRITE = 2  /* a write, or anything not provably read-only */
} stmt_class_t;

/*
 * Classify a (possibly multi-statement) SQL string. If any contained statement
 * is a write — or cannot be proven read-only — the whole input is STMT_WRITE.
 * STMT_READ is returned only when every statement is provably read-only.
 * A NULL or effectively empty input is STMT_EMPTY.
 */
stmt_class_t stmt_classify(const char *sql);

#endif /* QUAERO_MCP_STMT_CLASS_H */
