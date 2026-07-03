#ifndef DBCORE_EDIT_H
#define DBCORE_EDIT_H

/*
 * Single-row data modification (issues #26/#27), with an explicit preview step
 * (#29). The driver renders the neutral change (dbc_dml_row) to engine SQL via
 * its build_dml member; this layer previews or applies it:
 *
 *   preview != 0 : generate the SQL only; execute nothing.
 *   preview == 0 : generate the SQL and also execute it, reporting rows affected.
 *
 * Because build_dml returns the literal statement (not a bound one), the same
 * text is what the preview dialog shows and what is executed — they can never
 * drift. Editing is only offered for engines that advertise DBC_FEAT_DML; the
 * rest get DBC_ERR_UNSUPPORTED here rather than a silent no-op.
 */

#include "dbcore/conn.h"
#include "dbcore/driver.h"

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Generate — and, unless `preview`, execute — the statement for `kind`/`row` on
 * the connection borrowed in `conn`.
 *
 * On success returns DBC_OK, sets *out_sql to the generated statement (owned by
 * the caller; free with free()), and, when not previewing, sets
 * *out_rows_affected. On failure returns the driver/validation status, leaves
 * *out_sql NULL, and copies a reason into errbuf (when errbuf != NULL and
 * errcap > 0; always NUL-terminated):
 *   DBC_ERR_PARAM       - a NULL argument, or an invalid change (no table, no
 *                         WHERE key for update/delete, no columns to set).
 *   DBC_ERR_UNSUPPORTED - the driver does not advertise DBC_FEAT_DML.
 *   DBC_ERR_QUERY       - building or executing the statement failed.
 */
dbc_status dbcore_row_dml(const dbcore_conn_ref *conn, dbc_dml_kind kind,
                          const dbc_dml_row *row, int preview,
                          char **out_sql, long long *out_rows_affected,
                          char *errbuf, size_t errcap);

#ifdef __cplusplus
}
#endif

#endif /* DBCORE_EDIT_H */
