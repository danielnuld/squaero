#include "dbcore/ipc.h"

#include "conn_lost.h"
#include "conn_methods.h"   /* ipc_conn_id_parse */
#include "methods.h"
#include "rpc.h"

#include "dbcore/runtime.h"

#include "cJSON.h"

#include <stdlib.h>
#include <string.h>

/* The open connection a call runs on, or 0. conn.open is the one method whose
   -32000 means "could not open" rather than "the session died" (issue #676). */
static int call_conn_id(const char *method, const cJSON *params)
{
    const cJSON *conn_id = cJSON_GetObjectItemCaseSensitive(params, "connId");
    int id = 0;
    if (strcmp(method, "conn.open") == 0 || !cJSON_IsString(conn_id) ||
        !ipc_conn_id_parse(conn_id->valuestring, &id)) {
        return 0;
    }
    return id;
}

char *dbcore_ipc_handle(const char *request_json)
{
    if (request_json == NULL) {
        return ipc_response_error(NULL, IPC_ERR_INVALID_REQ,
                                  "request must not be null");
    }

    cJSON *request = cJSON_Parse(request_json);
    if (request == NULL) {
        return ipc_response_error(NULL, IPC_ERR_PARSE, "parse error");
    }

    if (!cJSON_IsObject(request)) {
        cJSON_Delete(request);
        return ipc_response_error(NULL, IPC_ERR_INVALID_REQ,
                                  "request must be a JSON object");
    }

    /* `id` may be absent; it is echoed back (null when absent). */
    const cJSON *id = cJSON_GetObjectItemCaseSensitive(request, "id");

    const cJSON *method = cJSON_GetObjectItemCaseSensitive(request, "method");
    if (!cJSON_IsString(method) || method->valuestring == NULL) {
        char *err = ipc_response_error(id, IPC_ERR_INVALID_REQ,
                                       "missing or invalid \"method\"");
        cJSON_Delete(request);
        return err;
    }

    ipc_method_fn handler = ipc_method_lookup(method->valuestring);
    if (handler == NULL) {
        char *err = ipc_response_error(id, IPC_ERR_METHOD, "method not found");
        cJSON_Delete(request);
        return err;
    }

    const cJSON *params = cJSON_GetObjectItemCaseSensitive(request, "params");

    /* Read BEFORE the call: a tx.commit that dies with the session must still
       report the transaction it lost, and tx.rollback clears the flag. */
    int conn_id = call_conn_id(method->valuestring, params);
    dbcore_runtime *rt = conn_id != 0 ? dbcore_runtime_get() : NULL;
    int in_tx = rt != NULL && dbcore_conn_manager_in_tx(dbcore_runtime_conns(rt), conn_id);

    int code = 0;
    const char *message = NULL;
    cJSON *result = handler(params, &code, &message);

    char *response;
    if (code == IPC_ERR_CONN && rt != NULL) {
        /* The session died under the call: say so in a structured way, and
           whether re-sending it on a fresh session is safe (issue #676). */
        cJSON_Delete(result);
        response = ipc_response_error_data(
            id, code, message, ipc_conn_lost_data(method->valuestring, params, in_tx));
    } else if (code != 0) {
        /* Contract: handlers return NULL on error. Free defensively in case a
           future handler ever returns a result alongside an error code. */
        cJSON_Delete(result);
        response = ipc_response_error(id, code, message);
    } else {
        response = ipc_response_success(id, result); /* consumes result */
    }

    cJSON_Delete(request);
    return response;
}

void dbcore_ipc_free(char *response_json)
{
    /* cJSON_PrintUnformatted allocates with the standard allocator. */
    free(response_json);
}
