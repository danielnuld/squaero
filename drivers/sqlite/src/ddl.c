#include "internal.h"

/*
 * DDL generation. SQLite stores the authoritative CREATE statement of every
 * object in sqlite_master.sql, so get_ddl returns it verbatim as a one-column
 * ("sql") result set. The object name travels as a bound parameter. An unknown
 * object yields an empty result (no rows), not an error.
 *
 * sqlite_master (unqualified) resolves to the connection's main schema, which
 * is where ordinary objects live; cross-database (ATTACH) DDL is out of scope
 * for the reference driver.
 */
dbc_status sqlite_get_ddl(dbc_conn *c, const char *object, dbc_result **out)
{
    return sqlite_prepare_result(
        c, "SELECT sql FROM sqlite_master WHERE name = ?1", object, out);
}
