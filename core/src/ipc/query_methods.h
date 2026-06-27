#ifndef DBCORE_IPC_QUERY_METHODS_H
#define DBCORE_IPC_QUERY_METHODS_H

#include "cJSON.h"

/* Default row cap when the caller omits `limit`, so query.run never dumps a
   full dataset in one response (see .rules/ipc.md "Paginación siempre"). */
#define IPC_QUERY_DEFAULT_LIMIT 1000

/*
 * IPC handler for query.run. Executes SQL on an open connection (resolved from
 * the runtime by connId) and returns the paginated result in the IPC JSON shape
 * (see docs/IPC.md and result_json.h).
 *
 * params: { connId: "c<N>", sql: string, limit?: number }
 * Pagination is mandatory: at most `limit` rows are returned and `truncated`
 * signals whether more existed. When `limit` is omitted a default cap applies —
 * a full dataset is never dumped in one response.
 */
cJSON *ipc_method_query_run(const cJSON *params, int *code, const char **message);

#endif /* DBCORE_IPC_QUERY_METHODS_H */
