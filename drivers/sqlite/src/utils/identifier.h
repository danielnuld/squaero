#ifndef QUAERO_SQLITE_IDENTIFIER_H
#define QUAERO_SQLITE_IDENTIFIER_H

#include <stddef.h>

/*
 * Quote a SQL identifier (e.g. a database or table name) for safe inlining into
 * SQLite SQL: wraps it in double quotes and doubles any embedded double quote,
 * which is SQLite's identifier-escaping rule. This blocks identifier injection
 * where a value cannot be passed as a bound parameter (PRAGMA targets, schema
 * qualifiers).
 *
 * Writes the quoted form (NUL-terminated) into `buf`. Returns 1 on success, or 0
 * when `id` or `buf` is NULL or `buf` is too small to hold the result. Pure.
 */
int sqlite_quote_identifier(const char *id, char *buf, size_t cap);

#endif /* QUAERO_SQLITE_IDENTIFIER_H */
