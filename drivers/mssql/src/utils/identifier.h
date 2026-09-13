#ifndef QUAERO_MSSQL_IDENTIFIER_H
#define QUAERO_MSSQL_IDENTIFIER_H

#include <stddef.h>

/*
 * Pure T-SQL quoting for the SQL Server driver, free of FreeTDS so it is
 * unit-tested without the client library.
 */

/*
 * Write `id` as a bracket-delimited identifier into buf: `[id]`, with every `]`
 * doubled (`a]b` -> `[a]]b]`). A `[` needs no escaping inside brackets. Returns
 * 1 on success, 0 when id/buf is NULL or the result (with its NUL) does not fit.
 */
int mssql_quote_identifier(const char *id, char *buf, size_t cap);

/*
 * Write `value` as a Unicode string literal into buf: `N'value'`, with every `'`
 * doubled. The N prefix keeps characters outside the database's code page intact.
 * Returns 1 on success, 0 when value/buf is NULL or the result does not fit.
 */
int mssql_quote_literal(const char *value, char *buf, size_t cap);

#endif /* QUAERO_MSSQL_IDENTIFIER_H */
