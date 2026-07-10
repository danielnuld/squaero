#include "op_methods.h"

#include "conn_methods.h"  /* ipc_conn_id_parse */
#include "rpc.h"

#include "dbcore/op_registry.h"

cJSON *ipc_method_op_cancel(const cJSON *params, int *code, const char **message)
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

    /* DBC_OK          -> a cancel was delivered to the driver.
       DBC_ERR_PARAM   -> nothing was running (a benign race: the query may have
                          finished between the click and this call).
       DBC_ERR_UNSUPPORTED -> a query is running but the engine cannot cancel it.
       Only the first counts as "canceled"; the other two are honest false, not
       errors — the caller re-enables its UI either way. */
    dbc_status st = dbcore_op_cancel(id);

    cJSON *result = cJSON_CreateObject();
    if (result == NULL) {
        *code = IPC_ERR_INTERNAL;
        *message = "out of memory";
        return NULL;
    }
    cJSON_AddBoolToObject(result, "canceled", st == DBC_OK);
    *code = 0;
    return result;
}
