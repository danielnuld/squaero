#include "schema_methods.h"

#include "conn_methods.h"   /* ipc_conn_id_parse */
#include "result_json.h"
#include "rpc.h"

#include "dbcore/result.h"
#include "dbcore/runtime.h"
#include "dbcore/schema.h"

/* Holds the most recent schema error text across the dispatcher's response
   build (the core is single-threaded). */
static char g_schema_error[256];

/* Resolve params.connId to a borrowed connection ref. Returns 1 on success;
   on failure sets the code and message out-params and returns 0. */
static int resolve_ref(const cJSON *params, dbcore_conn_ref *ref, int *code,
                       const char **message)
{
    const cJSON *conn_id = cJSON_GetObjectItemCaseSensitive(params, "connId");
    if (!cJSON_IsString(conn_id) || conn_id->valuestring == NULL) {
        *code = IPC_ERR_PARAMS;
        *message = "params.connId (string) is required";
        return 0;
    }
    int id = 0;
    if (!ipc_conn_id_parse(conn_id->valuestring, &id)) {
        *code = IPC_ERR_PARAMS;
        *message = "malformed connId";
        return 0;
    }
    dbcore_runtime *rt = dbcore_runtime_get();
    if (rt == NULL) {
        *code = IPC_ERR_INTERNAL;
        *message = "out of memory";
        return 0;
    }
    if (!dbcore_conn_manager_get(dbcore_runtime_conns(rt), id, ref)) {
        *code = IPC_ERR_NOT_FOUND;
        *message = "unknown connection id";
        return 0;
    }
    return 1;
}

/* Serialize a materialized result into the success envelope payload. Consumes
   `res`. */
static cJSON *to_json(dbcore_result *res, int *code, const char **message)
{
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

/* Optional string param: returns its value, or NULL when absent/blank. */
static const char *opt_string(const cJSON *params, const char *key)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(params, key);
    if (cJSON_IsString(item) && item->valuestring != NULL &&
        item->valuestring[0] != '\0') {
        return item->valuestring;
    }
    return NULL;
}

cJSON *ipc_method_schema_tree(const cJSON *params, int *code, const char **message)
{
    dbcore_conn_ref ref;
    if (!resolve_ref(params, &ref, code, message)) {
        return NULL;
    }

    /* The core decides the tree level (and the schemas-vs-tables choice) from
       the driver's capabilities; the IPC layer only forwards the container. */
    const char *db = opt_string(params, "db");
    const char *schema = opt_string(params, "schema");

    dbcore_result *res = NULL;
    dbc_status st = dbcore_schema_tree(&ref, db, schema, IPC_SCHEMA_LIMIT,
                                       &res, g_schema_error, sizeof g_schema_error);
    if (st != DBC_OK) {
        *code = ipc_status_to_code(st);
        *message = g_schema_error[0] != '\0' ? g_schema_error : "schema.tree failed";
        return NULL;
    }
    return to_json(res, code, message);
}

cJSON *ipc_method_schema_describe(const cJSON *params, int *code,
                                  const char **message)
{
    dbcore_conn_ref ref;
    if (!resolve_ref(params, &ref, code, message)) {
        return NULL;
    }
    const char *table = opt_string(params, "table");
    if (table == NULL) {
        *code = IPC_ERR_PARAMS;
        *message = "params.table (string) is required";
        return NULL;
    }
    /* Optional container: a schema (engines with schemas) or a database. */
    const char *schema = opt_string(params, "schema");
    if (schema == NULL) {
        schema = opt_string(params, "db");
    }
    dbcore_result *res = NULL;
    dbc_status st = dbcore_schema_describe(&ref, schema, table, IPC_SCHEMA_LIMIT, &res,
                                           g_schema_error, sizeof g_schema_error);
    if (st != DBC_OK) {
        *code = ipc_status_to_code(st);
        *message = g_schema_error[0] != '\0' ? g_schema_error : "schema.describe failed";
        return NULL;
    }
    return to_json(res, code, message);
}

cJSON *ipc_method_schema_ddl(const cJSON *params, int *code, const char **message)
{
    dbcore_conn_ref ref;
    if (!resolve_ref(params, &ref, code, message)) {
        return NULL;
    }
    const char *object = opt_string(params, "object");
    if (object == NULL) {
        *code = IPC_ERR_PARAMS;
        *message = "params.object (string) is required";
        return NULL;
    }
    const char *schema = opt_string(params, "schema");
    if (schema == NULL) {
        schema = opt_string(params, "db");
    }
    dbcore_result *res = NULL;
    dbc_status st = dbcore_schema_ddl(&ref, schema, object, IPC_SCHEMA_LIMIT, &res,
                                      g_schema_error, sizeof g_schema_error);
    if (st != DBC_OK) {
        *code = ipc_status_to_code(st);
        *message = g_schema_error[0] != '\0' ? g_schema_error : "schema.ddl failed";
        return NULL;
    }
    return to_json(res, code, message);
}
