#include "internal.h"
#include "utils/dml.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Data modification (DBC_FEAT_DML). The pure mongo_build_dml (utils/dml.c) turns
 * the neutral dbc_dml_row into a mongosh statement -- insertOne / updateOne /
 * deleteOne identifying the document by its key (`_id`) -- and it is handed back
 * as the one-column ("sql") result the contract requires. The core previews it or
 * runs it through the normal query path (command.c), so this driver never
 * executes the change here and rows_affected comes from the server's own counts.
 */
dbc_status mongo_build_dml_result(dbc_conn *c, dbc_dml_kind kind, const dbc_dml_row *row,
                                  dbc_result **out)
{
    *out = NULL;
    if (c == NULL || row == NULL) {
        return DBC_ERR_PARAM;
    }
    /* A statement runs against the connected database (the mongosh `db`); another
       database cannot be addressed by this surface. */
    if (row->schema != NULL && row->schema[0] != '\0' && c->db != NULL &&
        strcmp(row->schema, c->db) != 0) {
        char msg[512];
        snprintf(msg, sizeof msg,
                 "documents can only be edited in the connected database \"%s\" "
                 "(not \"%s\"); open a connection to that database",
                 c->db, row->schema);
        mongo_set_err(c, msg);
        return DBC_ERR_UNSUPPORTED;
    }

    char err[256];
    char *stmt = mongo_build_dml(kind, row, err, sizeof err);
    if (stmt == NULL) {
        mongo_set_err(c, err[0] != '\0' ? err : "could not build the statement");
        return DBC_ERR_PARAM;
    }
    dbc_status st = mongo_text_result(c, "sql", stmt, out);
    free(stmt);
    return st;
}
