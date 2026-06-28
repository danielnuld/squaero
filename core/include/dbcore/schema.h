#ifndef DBCORE_SCHEMA_H
#define DBCORE_SCHEMA_H

/*
 * Schema introspection: drive the driver's optional introspection vtable
 * (list_databases / list_schemas / list_tables / describe_table / get_ddl) and
 * materialize each into a neutral dbcore_result, exactly like query execution.
 *
 * The core owns the tree-level decision: callers describe *what* they want
 * (the contents of the root, of a database, or of a schema) and the core picks
 * the right vtable method based on the driver's advertised capabilities. The
 * IPC layer never inspects vtable flags.
 *
 * A driver that does not advertise the matching capability (DBC_FEAT_*) — or
 * leaves the method NULL — yields DBC_ERR_UNSUPPORTED. Honest capabilities: the
 * core never fakes an empty success for an operation the engine cannot do.
 */

#include "dbcore/conn.h"
#include "dbcore/result.h"

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * List one lazy level of the object tree, chosen from the container the caller
 * names:
 *   - db == NULL && schema == NULL -> databases (root).
 *   - db != NULL && schema == NULL -> the schemas of `db` on engines that have
 *     schemas (DBC_FEAT_SCHEMAS), otherwise the tables of `db`.
 *   - schema != NULL              -> the tables/views of that schema.
 * `max_rows` bounds the fetch (<= 0 = all). On success *out owns a result.
 *
 * Returns DBC_ERR_UNSUPPORTED when the driver lacks introspection (or the
 * needed method), DBC_ERR_PARAM on NULL conn/out, or the driver's DBC_ERR_*.
 */
dbc_status dbcore_schema_tree(const dbcore_conn_ref *conn, const char *db,
                              const char *schema, int max_rows,
                              dbcore_result **out, char *errbuf, size_t errcap);

/* Describe one table's structure (columns/types/nullability/default/key).
   `schema` is the containing database/schema, or NULL for the engine default. */
dbc_status dbcore_schema_describe(const dbcore_conn_ref *conn, const char *schema,
                                  const char *table, int max_rows,
                                  dbcore_result **out, char *errbuf, size_t errcap);

/* The CREATE statement of `object` as a one-column ("sql") result set.
   `schema` is the containing database/schema, or NULL for the engine default. */
dbc_status dbcore_schema_ddl(const dbcore_conn_ref *conn, const char *schema,
                             const char *object, int max_rows,
                             dbcore_result **out, char *errbuf, size_t errcap);

#ifdef __cplusplus
}
#endif

#endif /* DBCORE_SCHEMA_H */
