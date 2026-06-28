#include "internal.h"
#include "utils/identifier.h"

#include <stdio.h>

/*
 * DDL generation. SQLite stores the authoritative CREATE statement of every
 * object in sqlite_master.sql, so get_ddl returns it verbatim as a one-column
 * ("sql") result set. The object name travels as a bound parameter; the schema
 * (attached-db name), when given, qualifies sqlite_master and is quoted as an
 * identifier. With no schema, the unqualified sqlite_master resolves to the
 * connection's main database. An unknown object yields an empty result.
 */
dbc_status sqlite_get_ddl(dbc_conn *c, const char *schema, const char *object,
                          dbc_result **out)
{
    if (schema != NULL && schema[0] != '\0') {
        char qid[256];
        if (!sqlite_quote_identifier(schema, qid, sizeof qid)) {
            return DBC_ERR_PARAM;
        }
        char sql[320];
        int n = snprintf(sql, sizeof sql,
                         "SELECT sql FROM %s.sqlite_master WHERE name = ?1", qid);
        if (n < 0 || (size_t)n >= sizeof sql) {
            return DBC_ERR_PARAM;
        }
        return sqlite_prepare_result(c, sql, object, NULL, out);
    }
    return sqlite_prepare_result(
        c, "SELECT sql FROM sqlite_master WHERE name = ?1", object, NULL, out);
}
