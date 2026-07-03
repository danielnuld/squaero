#include "internal.h"
#include "utils/dml.h"

#include <stdlib.h>

/*
 * Data modification (DBC_FEAT_DML). The heavy lifting — turning a neutral
 * dbc_dml_row into engine SQL — is the pure sqlite_build_dml_sql (utils/dml.c).
 * Here we wrap the resulting statement text into the one-column ("sql") result
 * the contract requires, by selecting it back as a bound parameter. The core
 * then previews or executes that SQL through the normal query path, so this
 * driver never executes the modification itself (keeping build + apply cleanly
 * separated, which the SQL-preview flow of issue #29 relies on).
 */
dbc_status sqlite_build_dml(dbc_conn *c, dbc_dml_kind kind,
                            const dbc_dml_row *row, dbc_result **out)
{
    *out = NULL;
    char *sql = sqlite_build_dml_sql(kind, row);
    if (sql == NULL) {
        /* Invalid request (missing table / WHERE / SET) or out of memory. */
        return DBC_ERR_PARAM;
    }
    dbc_status st = sqlite_prepare_result(c, "SELECT ?1 AS sql", sql, NULL, out);
    free(sql);
    return st;
}
