#include "internal.h"
#include "utils/dml.h"

/*
 * Data modification (DBC_FEAT_DML). The pure pg_build_dml_sql (utils/dml.c) turns
 * the neutral dbc_dml_row into engine SQL; here we hand it back as the one-column
 * ("sql") synthetic result the contract requires, reusing the same synthetic-
 * result mechanism as get_ddl. The core previews or executes that SQL through the
 * normal query path, so this driver never executes the change here.
 */
dbc_status pg_drv_build_dml(dbc_conn *c, dbc_dml_kind kind,
                            const dbc_dml_row *row, dbc_result **out)
{
    (void)c;
    *out = NULL;

    char *sql = pg_build_dml_sql(kind, row);
    if (sql == NULL) {
        /* Invalid request (missing table / WHERE / SET) or out of memory. */
        return DBC_ERR_PARAM;
    }
    return pg_drv_make_synthetic(sql, out);  /* takes ownership of sql */
}
