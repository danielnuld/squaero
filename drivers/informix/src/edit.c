#include "internal.h"
#include "utils/dml.h"

#include <stdlib.h>

/*
 * Data modification (DBC_FEAT_DML). The pure informix_build_dml_sql (utils/dml.c)
 * turns the neutral dbc_dml_row into Informix SQL; here we hand it back as the
 * one-column ("sql") synthetic result the contract requires. The core previews
 * or executes that SQL through the normal query path, so this driver never
 * executes the change itself.
 */
dbc_status ifx_build_dml(dbc_conn *c, dbc_dml_kind kind,
                         const dbc_dml_row *row, dbc_result **out)
{
    (void)c;
    *out = NULL;

    char *sql = informix_build_dml_sql(kind, row);
    if (sql == NULL) {
        /* Invalid request (missing table / WHERE / SET) or out of memory. */
        return DBC_ERR_PARAM;
    }
    dbc_status st = ifx_make_synthetic_sql(sql, out);
    free(sql);
    return st;
}
