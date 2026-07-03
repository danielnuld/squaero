#include "methods.h"
#include "conn_methods.h"
#include "query_methods.h"
#include "schema_methods.h"
#include "tx_methods.h"
#include "edit_methods.h"
#include "rpc.h"

#include "dbcore/dbcore.h"
#include "dbcore/ipc.h"

#include <string.h>

cJSON *ipc_method_hello(const cJSON *params, int *code, const char **message)
{
    (void)params; /* clientVersion is accepted but not required in v1 */

    cJSON *result = cJSON_CreateObject();
    if (result == NULL) {
        *code = IPC_ERR_INTERNAL;
        *message = "out of memory";
        return NULL;
    }

    cJSON_AddStringToObject(result, "name", "quaero");
    cJSON_AddStringToObject(result, "coreVersion", dbcore_version());
    cJSON_AddNumberToObject(result, "protocolVersion",
                            DBCORE_IPC_PROTOCOL_VERSION);

    *code = 0;
    return result;
}

cJSON *ipc_method_ping(const cJSON *params, int *code, const char **message)
{
    cJSON *result = cJSON_CreateObject();
    if (result == NULL) {
        *code = IPC_ERR_INTERNAL;
        *message = "out of memory";
        return NULL;
    }

    cJSON_AddBoolToObject(result, "pong", 1);

    /* Echo params.message back when the caller provides a string. */
    const cJSON *msg = cJSON_GetObjectItemCaseSensitive(params, "message");
    if (cJSON_IsString(msg) && msg->valuestring != NULL) {
        cJSON_AddStringToObject(result, "echo", msg->valuestring);
    }

    *code = 0;
    return result;
}

ipc_method_fn ipc_method_lookup(const char *method)
{
    if (method == NULL) {
        return NULL;
    }
    if (strcmp(method, "app.hello") == 0) {
        return ipc_method_hello;
    }
    if (strcmp(method, "ping") == 0) {
        return ipc_method_ping;
    }
    if (strcmp(method, "conn.open") == 0) {
        return ipc_method_conn_open;
    }
    if (strcmp(method, "conn.close") == 0) {
        return ipc_method_conn_close;
    }
    if (strcmp(method, "query.run") == 0) {
        return ipc_method_query_run;
    }
    if (strcmp(method, "schema.tree") == 0) {
        return ipc_method_schema_tree;
    }
    if (strcmp(method, "schema.describe") == 0) {
        return ipc_method_schema_describe;
    }
    if (strcmp(method, "schema.ddl") == 0) {
        return ipc_method_schema_ddl;
    }
    if (strcmp(method, "tx.begin") == 0) {
        return ipc_method_tx_begin;
    }
    if (strcmp(method, "tx.commit") == 0) {
        return ipc_method_tx_commit;
    }
    if (strcmp(method, "tx.rollback") == 0) {
        return ipc_method_tx_rollback;
    }
    if (strcmp(method, "row.insert") == 0) {
        return ipc_method_row_insert;
    }
    if (strcmp(method, "row.update") == 0) {
        return ipc_method_row_update;
    }
    if (strcmp(method, "row.delete") == 0) {
        return ipc_method_row_delete;
    }
    return NULL;
}
