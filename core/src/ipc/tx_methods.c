#include "tx_methods.h"

#include "conn_methods.h"   /* ipc_conn_id_parse */
#include "rpc.h"

#include "dbcore/runtime.h"
#include "dbcore/tx.h"

/* Holds the most recent transaction error text across the dispatcher's response
   build (the core is single-threaded). */
static char g_tx_error[256];

typedef dbc_status (*tx_fn)(const dbcore_conn_ref *, char *, size_t);

/* Shared body for the three tx.* methods: resolve the connection and delegate to
   `op`, returning {ok: true} or mapping the driver status to an error. */
static cJSON *tx_dispatch(const cJSON *params, int *code, const char **message,
                          tx_fn op)
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

    dbc_status st = op(&ref, g_tx_error, sizeof g_tx_error);
    if (st != DBC_OK) {
        *code = ipc_status_to_code(st);
        *message = g_tx_error[0] != '\0' ? g_tx_error : "transaction failed";
        return NULL;
    }

    cJSON *result = cJSON_CreateObject();
    if (result == NULL) {
        *code = IPC_ERR_INTERNAL;
        *message = "out of memory";
        return NULL;
    }
    cJSON_AddBoolToObject(result, "ok", 1);
    *code = 0;
    return result;
}

cJSON *ipc_method_tx_begin(const cJSON *params, int *code, const char **message)
{
    return tx_dispatch(params, code, message, dbcore_tx_begin);
}

cJSON *ipc_method_tx_commit(const cJSON *params, int *code, const char **message)
{
    return tx_dispatch(params, code, message, dbcore_tx_commit);
}

cJSON *ipc_method_tx_rollback(const cJSON *params, int *code, const char **message)
{
    return tx_dispatch(params, code, message, dbcore_tx_rollback);
}
