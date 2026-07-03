#ifndef DBCORE_IPC_EDIT_METHODS_H
#define DBCORE_IPC_EDIT_METHODS_H

#include "cJSON.h"

/*
 * IPC handlers for single-row data modification (issues #26/#27/#29). Each takes
 * a connId, a table (optionally a db/schema), and the change as {column: value}
 * objects (a value of JSON null means SQL NULL), plus an optional preview flag.
 *
 *   row.insert — params {connId, table, schema?, values:{...}, preview?}
 *   row.update — params {connId, table, schema?, set:{...}, where:{...}, preview?}
 *   row.delete — params {connId, table, schema?, where:{...}, preview?}
 *
 * result {sql: string, rowsAffected?: number}. With preview:true the statement
 * is only generated (rowsAffected omitted); otherwise it is executed too. An
 * engine without DBC_FEAT_DML yields an UNSUPPORTED error. See docs/IPC.md.
 */

cJSON *ipc_method_row_insert(const cJSON *params, int *code, const char **message);
cJSON *ipc_method_row_update(const cJSON *params, int *code, const char **message);
cJSON *ipc_method_row_delete(const cJSON *params, int *code, const char **message);

#endif /* DBCORE_IPC_EDIT_METHODS_H */
