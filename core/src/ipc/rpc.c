#include "rpc.h"

#include <stddef.h>

int ipc_status_to_code(dbc_status status)
{
    switch (status) {
    case DBC_OK:              return 0;
    case DBC_ERR_CONN:        return IPC_ERR_CONN;
    case DBC_ERR_QUERY:       return IPC_ERR_QUERY;
    case DBC_ERR_UNSUPPORTED: return IPC_ERR_UNSUPPORTED;
    case DBC_ERR_PARAM:       return IPC_ERR_PARAMS;
    /* DBC_ERR_NOMEM, DBC_ERR_ABI and any future status map to the internal
       bucket; the accompanying message carries the detail. */
    default:                  return IPC_ERR_INTERNAL;
    }
}

/* Adds "jsonrpc":"2.0" and a duplicated id to an envelope object.
   Returns 0 on success, -1 on allocation failure (envelope left for caller). */
static int add_envelope_head(cJSON *envelope, const cJSON *id)
{
    if (cJSON_AddStringToObject(envelope, "jsonrpc", "2.0") == NULL) {
        return -1;
    }

    cJSON *id_copy = (id != NULL) ? cJSON_Duplicate(id, 1) : cJSON_CreateNull();
    if (id_copy == NULL) {
        return -1;
    }
    if (!cJSON_AddItemToObject(envelope, "id", id_copy)) {
        cJSON_Delete(id_copy);
        return -1;
    }
    return 0;
}

char *ipc_response_success(const cJSON *id, cJSON *result)
{
    cJSON *envelope = cJSON_CreateObject();
    if (envelope == NULL) {
        cJSON_Delete(result);
        return NULL;
    }

    if (add_envelope_head(envelope, id) != 0) {
        cJSON_Delete(result);
        cJSON_Delete(envelope);
        return NULL;
    }

    /* A NULL result is a valid JSON-RPC result of null. Ownership of the value
       transfers to the envelope only if the insert succeeds. */
    cJSON *value = (result != NULL) ? result : cJSON_CreateNull();
    if (value == NULL || !cJSON_AddItemToObject(envelope, "result", value)) {
        cJSON_Delete(value);
        cJSON_Delete(envelope);
        return NULL;
    }

    char *out = cJSON_PrintUnformatted(envelope);
    cJSON_Delete(envelope);
    return out;
}

char *ipc_response_error(const cJSON *id, int code, const char *message)
{
    cJSON *envelope = cJSON_CreateObject();
    if (envelope == NULL) {
        return NULL;
    }

    if (add_envelope_head(envelope, id) != 0) {
        cJSON_Delete(envelope);
        return NULL;
    }

    cJSON *error = cJSON_CreateObject();
    if (error == NULL) {
        cJSON_Delete(envelope);
        return NULL;
    }
    cJSON_AddNumberToObject(error, "code", code);
    cJSON_AddStringToObject(error, "message", message != NULL ? message : "");

    if (!cJSON_AddItemToObject(envelope, "error", error)) {
        cJSON_Delete(error);
        cJSON_Delete(envelope);
        return NULL;
    }

    char *out = cJSON_PrintUnformatted(envelope);
    cJSON_Delete(envelope);
    return out;
}
