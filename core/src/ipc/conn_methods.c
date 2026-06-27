#include "conn_methods.h"
#include "rpc.h"

#include "dbcore/runtime.h"

#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Holds the most recent driver-supplied error text so it stays valid while the
   dispatcher serializes the response (the core is single-threaded). */
static char g_last_error[256];

char *ipc_conn_id_format(int id, char *buf, size_t cap)
{
    snprintf(buf, cap, "c%d", id);
    return buf;
}

int ipc_conn_id_parse(const char *s, int *out)
{
    if (s == NULL || s[0] != 'c' || s[1] == '\0') {
        return 0;
    }
    int value = 0;
    for (const char *p = s + 1; *p != '\0'; p++) {
        if (*p < '0' || *p > '9') {
            return 0;
        }
        int digit = *p - '0';
        if (value > (INT_MAX - digit) / 10) {  /* would overflow */
            return 0;
        }
        value = value * 10 + digit;
    }
    if (value < 1) {
        return 0;
    }
    if (out != NULL) {
        *out = value;
    }
    return 1;
}

/* Map a driver status onto a JSON-RPC server error code. */
static int status_to_code(dbc_status st)
{
    switch (st) {
    case DBC_ERR_CONN:        return IPC_ERR_CONN;
    case DBC_ERR_UNSUPPORTED: return IPC_ERR_UNSUPPORTED;
    case DBC_ERR_PARAM:       return IPC_ERR_PARAMS;
    /* DBC_ERR_NOMEM, DBC_ERR_ABI, DBC_ERR_QUERY and any future status map to
       the JSON-RPC internal-error bucket; the message carries the detail. */
    default:                  return IPC_ERR_INTERNAL;
    }
}

cJSON *ipc_method_conn_open(const cJSON *params, int *code, const char **message)
{
    const cJSON *driver_name =
        cJSON_GetObjectItemCaseSensitive(params, "driver");
    if (!cJSON_IsString(driver_name) || driver_name->valuestring == NULL) {
        *code = IPC_ERR_PARAMS;
        *message = "params.driver (string) is required";
        return NULL;
    }

    const cJSON *dsn = cJSON_GetObjectItemCaseSensitive(params, "dsn");
    if (dsn == NULL) {
        *code = IPC_ERR_PARAMS;
        *message = "params.dsn is required";
        return NULL;
    }

    dbcore_runtime *rt = dbcore_runtime_get();
    if (rt == NULL) {
        *code = IPC_ERR_INTERNAL;
        *message = "out of memory";
        return NULL;
    }

    const dbc_driver_t *driver =
        dbcore_runtime_find_driver(rt, driver_name->valuestring);
    if (driver == NULL) {
        *code = IPC_ERR_NOT_FOUND;
        *message = "unknown driver";
        return NULL;
    }

    /* The DSN crosses the boundary as JSON. Accept either an object (serialize
       it) or an already-encoded string. */
    char *dsn_json = NULL;
    int dsn_owned = 0;
    if (cJSON_IsString(dsn) && dsn->valuestring != NULL) {
        dsn_json = dsn->valuestring;
    } else {
        dsn_json = cJSON_PrintUnformatted(dsn);
        dsn_owned = 1;
        if (dsn_json == NULL) {
            *code = IPC_ERR_INTERNAL;
            *message = "out of memory";
            return NULL;
        }
    }

    int id = 0;
    dbc_status st = dbcore_conn_manager_open(dbcore_runtime_conns(rt), driver,
                                             dsn_json, &id, g_last_error,
                                             sizeof g_last_error);
    if (dsn_owned) {
        free(dsn_json);
    }

    if (st != DBC_OK) {
        *code = status_to_code(st);
        *message = g_last_error[0] != '\0' ? g_last_error : "could not connect";
        return NULL;
    }

    cJSON *result = cJSON_CreateObject();
    if (result == NULL) {
        /* The connection is open but we cannot return its id to the caller, so
           it could never be closed — tear it down now rather than leak it. */
        dbcore_conn_manager_close(dbcore_runtime_conns(rt), id);
        *code = IPC_ERR_INTERNAL;
        *message = "out of memory";
        return NULL;
    }
    char idbuf[24];
    cJSON_AddStringToObject(result, "connId",
                            ipc_conn_id_format(id, idbuf, sizeof idbuf));
    *code = 0;
    return result;
}

cJSON *ipc_method_conn_close(const cJSON *params, int *code,
                             const char **message)
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

    dbc_status st = dbcore_conn_manager_close(dbcore_runtime_conns(rt), id);
    if (st != DBC_OK) {
        *code = IPC_ERR_NOT_FOUND;
        *message = "unknown connection id";
        return NULL;
    }

    cJSON *result = cJSON_CreateObject();
    if (result == NULL) {
        *code = IPC_ERR_INTERNAL;
        *message = "out of memory";
        return NULL;
    }
    cJSON_AddBoolToObject(result, "closed", 1);
    *code = 0;
    return result;
}
