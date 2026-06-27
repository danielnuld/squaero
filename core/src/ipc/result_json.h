#ifndef DBCORE_IPC_RESULT_JSON_H
#define DBCORE_IPC_RESULT_JSON_H

#include "cJSON.h"

#include "dbcore/driver.h"
#include "dbcore/result.h"

/*
 * Serialization of a neutral dbcore_result into the IPC JSON shape (see
 * docs/IPC.md). The result of query.run:
 *
 *   { "columns":      [ { "name": "id", "type": "int" }, ... ],
 *     "rows":         [ [ "1", "alice" ], [ "2", null ], ... ],
 *     "truncated":    false,
 *     "rowsAffected": 0 }
 *
 * Cell values cross as JSON strings (the column's neutral `type` tells the
 * frontend how to format them) or JSON null for a SQL NULL. String escaping and
 * UTF-8 encoding are handled by cJSON.
 */

/* Stable wire name for a neutral column type ("int", "text", ...). Never NULL;
   an unknown value maps to "null". Pure. */
const char *ipc_type_name(dbc_type type);

/* Build the query.run result object from `r`. Returns a new cJSON object (caller
   owns it), or NULL on allocation failure. */
cJSON *ipc_result_to_json(const dbcore_result *r);

#endif /* DBCORE_IPC_RESULT_JSON_H */
