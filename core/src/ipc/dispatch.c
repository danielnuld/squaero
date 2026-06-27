#include "dbcore/ipc.h"

#include "methods.h"
#include "rpc.h"

#include "cJSON.h"

#include <stdlib.h>

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

    int code = 0;
    const char *message = NULL;
    cJSON *result = handler(params, &code, &message);

    char *response;
    if (code != 0) {
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
