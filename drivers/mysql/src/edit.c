#include "internal.h"
#include "utils/dml.h"

#include <stdlib.h>

/*
 * Data modification (DBC_FEAT_DML). The pure mysql_build_dml_sql (utils/dml.c)
 * turns the neutral dbc_dml_row into engine SQL; here we hand it back as the
 * one-column ("sql") synthetic result the contract requires, reusing the same
 * synthetic-result mechanism as get_ddl. The core previews or executes that SQL
 * through the normal query path, so this driver never executes the change here.
 */
dbc_status mysql_drv_build_dml(dbc_conn *c, dbc_dml_kind kind,
                               const dbc_dml_row *row, dbc_result **out)
{
    (void)c;
    *out = NULL;

    char *sql = mysql_build_dml_sql(kind, row);
    if (sql == NULL) {
        /* Invalid request (missing table / WHERE / SET) or out of memory. */
        return DBC_ERR_PARAM;
    }

    dbc_result *r = calloc(1, sizeof *r);
    if (r == NULL) {
        free(sql);
        return DBC_ERR_NOMEM;
    }
    r->synthetic = 1;
    r->synth_sql = sql;  /* ownership transferred; freed by free_result */

    *out = r;
    return DBC_OK;
}
