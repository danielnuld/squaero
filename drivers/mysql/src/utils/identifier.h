#ifndef QUAERO_MYSQL_IDENTIFIER_H
#define QUAERO_MYSQL_IDENTIFIER_H

#include <stddef.h>

/*
 * Quote a SQL identifier for safe inlining into MySQL/MariaDB SQL: wraps it in
 * backticks and doubles any embedded backtick (MySQL's identifier-escaping
 * rule). Used for object names that cannot be passed as a bound/escaped value
 * (e.g. the target of SHOW CREATE TABLE).
 *
 * Writes the quoted form (NUL-terminated) into `buf`. Returns 1 on success, or 0
 * when `id` or `buf` is NULL or `buf` is too small. Pure.
 */
int mysql_quote_identifier(const char *id, char *buf, size_t cap);

#endif /* QUAERO_MYSQL_IDENTIFIER_H */
