#include "query_methods.h"

#include "conn_methods.h"   /* ipc_conn_id_parse */
#include "result_json.h"
#include "rpc.h"

#include "dbcore/query.h"
#include "dbcore/result.h"
#include "dbcore/runtime.h"

/* Holds the most recent query error text across the dispatcher's response
   build (the core is single-threaded). */
static char g_query_error[256];

cJSON *ipc_method_query_run(const cJSON *params, int *code, const char **message)
{
    const cJSON *conn_id = cJSON_GetObjectItemCaseSensitive(params, "connId");
    if (!cJSON_IsString(conn_id) || conn_id->valuestring == NULL) {
        *code = IPC_ERR_PARAMS;
        *message = "params.connId (string) is required";
        return NULL;
    }
    int id = 0;
    if (!ipc_conn_id_parse(conn_id->valuestring, &id)) {
        *code = IPC_ERR_PARAMS;
        *message = "malformed connId";
        return NULL;
    }

    const cJSON *sql = cJSON_GetObjectItemCaseSensitive(params, "sql");
    if (!cJSON_IsString(sql) || sql->valuestring == NULL) {
        *code = IPC_ERR_PARAMS;
        *message = "params.sql (string) is required";
        return NULL;
    }

    /* limit is optional; when present it must be a positive integer. */
    int limit = IPC_QUERY_DEFAULT_LIMIT;
    const cJSON *limit_item = cJSON_GetObjectItemCaseSensitive(params, "limit");
    if (limit_item != NULL) {
        /* Must be a whole number >= 1. The valuedouble vs valueint comparison
           rejects fractional values (1.5) and out-of-int-range values (cJSON
           clamps valueint but not valuedouble). */
        if (!cJSON_IsNumber(limit_item) ||
            limit_item->valuedouble != (double)limit_item->valueint ||
            limit_item->valueint < 1) {
            *code = IPC_ERR_PARAMS;
            *message = "params.limit must be a positive integer";
            return NULL;
        }
        limit = limit_item->valueint;
    }

    /* offset is optional; when present it must be a non-negative integer. It
       skips that many leading rows for offset pagination (issue #134). */
    int offset = 0;
    const cJSON *offset_item = cJSON_GetObjectItemCaseSensitive(params, "offset");
    if (offset_item != NULL) {
        if (!cJSON_IsNumber(offset_item) ||
            offset_item->valuedouble != (double)offset_item->valueint ||
            offset_item->valueint < 0) {
            *code = IPC_ERR_PARAMS;
            *message = "params.offset must be a non-negative integer";
            return NULL;
        }
        offset = offset_item->valueint;
    }

    dbcore_runtime *rt = dbcore_runtime_get();
    if (rt == NULL) {
        *code = IPC_ERR_INTERNAL;
        *message = "out of memory";
        return NULL;
    }

    dbcore_conn_ref ref;
    if (!dbcore_conn_manager_get(dbcore_runtime_conns(rt), id, &ref)) {
        *code = IPC_ERR_NOT_FOUND;
        *message = "unknown connection id";
        return NULL;
    }

    dbcore_result *res = NULL;
    dbc_status st = dbcore_query_run(&ref, sql->valuestring, limit, offset, &res,
                                     g_query_error, sizeof g_query_error);
    if (st != DBC_OK) {
        *code = ipc_status_to_code(st);
        *message = g_query_error[0] != '\0' ? g_query_error : "query failed";
        return NULL;
    }

    cJSON *result = ipc_result_to_json(res);
    dbcore_result_free(res);
    if (result == NULL) {
        *code = IPC_ERR_INTERNAL;
        *message = "out of memory";
        return NULL;
    }
    *code = 0;
    return result;
}
