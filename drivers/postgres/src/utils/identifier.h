#ifndef QUAERO_POSTGRES_IDENTIFIER_H
#define QUAERO_POSTGRES_IDENTIFIER_H

#include <stddef.h>

/*
 * Quote a SQL identifier for safe inlining into PostgreSQL SQL: wraps it in
 * double quotes and doubles any embedded double quote (PostgreSQL's identifier-
 * escaping rule). Used for object names that are composed into catalog queries
 * and reconstructed DDL, where a bound parameter cannot be used (e.g. the target
 * of a CREATE TABLE reconstruction).
 *
 * Writes the quoted form (NUL-terminated) into `buf`. Returns 1 on success, or 0
 * when `id` or `buf` is NULL or `buf` is too small. Pure.
 */
int pg_quote_identifier(const char *id, char *buf, size_t cap);

#endif /* QUAERO_POSTGRES_IDENTIFIER_H */
