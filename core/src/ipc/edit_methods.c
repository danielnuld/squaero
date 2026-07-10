#include "edit_methods.h"

#include "conn_methods.h"   /* ipc_conn_id_parse */
#include "result_json.h"    /* ipc_type_from_name */
#include "rpc.h"

#include "dbcore/edit.h"
#include "dbcore/runtime.h"

#include <stdlib.h>

/* Holds the most recent edit error text across the dispatcher's response build
   (the core is single-threaded). */
static char g_edit_error[256];

/*
 * Extract a {column: value} object into parallel column/value arrays. The
 * pointers alias the cJSON tree (valid while `params` lives), so only the arrays
 * themselves are allocated (free with free()). A JSON null value maps to a NULL
 * entry (SQL NULL); any non-string, non-null value is rejected. An absent or
 * empty object yields n == 0 with NULL arrays. Returns 0, or -1 with *message.
 */
static int extract_kv(const cJSON *obj, const char ***out_cols,
                      const char ***out_vals, int *out_n, const char **message)
{
    *out_cols = NULL;
    *out_vals = NULL;
    *out_n = 0;
    if (obj == NULL) {
        return 0;
    }
    if (!cJSON_IsObject(obj)) {
        *message = "column/value maps must be JSON objects";
        return -1;
    }
    int n = cJSON_GetArraySize(obj);
    if (n == 0) {
        return 0;
    }
    const char **cols = malloc((size_t)n * sizeof *cols);
    const char **vals = malloc((size_t)n * sizeof *vals);
    if (cols == NULL || vals == NULL) {
        free(cols);
        free(vals);
        *message = "out of memory";
        return -1;
    }
    int i = 0;
    for (const cJSON *child = obj->child; child != NULL; child = child->next) {
        if (cJSON_IsNull(child)) {
            vals[i] = NULL;
        } else if (cJSON_IsString(child)) {
            vals[i] = child->valuestring;
        } else {
            free(cols);
            free(vals);
            *message = "cell values must be strings or null";
            return -1;
        }
        cols[i] = child->string;
        i++;
    }
    *out_cols = cols;
    *out_vals = vals;
    *out_n = n;
    return 0;
}

/* Shared body: parse common params, assemble the dbc_dml_row, run it. `set_key`
   and `where_key` name the JSON objects to read (either may be NULL). */
/* Build a dbc_type array parallel to `cols` from a {col: "typename"} object,
   looked up by name (order-independent). Returns NULL when the object is absent
   (drivers then quote every value); a missing/unknown entry maps to DBC_TYPE_NULL.
   On allocation failure returns NULL — degrading to "no types" is safe. */
static dbc_type *build_types(const cJSON *params, const char *types_key,
                            const char **cols, int n)
{
    if (types_key == NULL || n <= 0) {
        return NULL;
    }
    const cJSON *obj = cJSON_GetObjectItemCaseSensitive(params, types_key);
    if (!cJSON_IsObject(obj)) {
        return NULL;
    }
    dbc_type *types = malloc((size_t)n * sizeof *types);
    if (types == NULL) {
        return NULL;
    }
    for (int i = 0; i < n; i++) {
        const cJSON *t = cJSON_GetObjectItemCaseSensitive(obj, cols[i]);
        types[i] = ipc_type_from_name(cJSON_IsString(t) ? t->valuestring : NULL);
    }
    return types;
}

static cJSON *edit_dispatch(const cJSON *params, int *code, const char **message,
                            dbc_dml_kind kind, const char *set_key,
                            const char *where_key, const char *types_key)
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

    const cJSON *table = cJSON_GetObjectItemCaseSensitive(params, "table");
    if (!cJSON_IsString(table) || table->valuestring == NULL ||
        table->valuestring[0] == '\0') {
        *code = IPC_ERR_PARAMS;
        *message = "params.table (string) is required";
        return NULL;
    }
    const cJSON *schema = cJSON_GetObjectItemCaseSensitive(params, "schema");
    const char *schema_str =
        cJSON_IsString(schema) ? schema->valuestring : NULL;

    const cJSON *preview_item = cJSON_GetObjectItemCaseSensitive(params, "preview");
    int preview = cJSON_IsTrue(preview_item);

    const char **set_cols = NULL, **set_vals = NULL;
    const char **where_cols = NULL, **where_vals = NULL;
    int n_set = 0, n_where = 0;

    if (set_key != NULL &&
        extract_kv(cJSON_GetObjectItemCaseSensitive(params, set_key),
                   &set_cols, &set_vals, &n_set, message) != 0) {
        *code = IPC_ERR_PARAMS;
        return NULL;
    }
    if (where_key != NULL &&
        extract_kv(cJSON_GetObjectItemCaseSensitive(params, where_key),
                   &where_cols, &where_vals, &n_where, message) != 0) {
        free((void *)set_cols);
        free((void *)set_vals);
        *code = IPC_ERR_PARAMS;
        return NULL;
    }

    /* Neutral type per set value so the driver can emit numeric columns unquoted
       (e.g. MySQL rejects a quoted string for a BIT column). NULL => quote all. */
    dbc_type *set_types = build_types(params, types_key, set_cols, n_set);

    dbcore_runtime *rt = dbcore_runtime_get();
    dbcore_conn_ref ref;
    if (rt == NULL) {
        free((void *)set_cols); free((void *)set_vals); free(set_types);
        free((void *)where_cols); free((void *)where_vals);
        *code = IPC_ERR_INTERNAL;
        *message = "out of memory";
        return NULL;
    }
    if (!dbcore_conn_manager_get(dbcore_runtime_conns(rt), id, &ref)) {
        free((void *)set_cols); free((void *)set_vals); free(set_types);
        free((void *)where_cols); free((void *)where_vals);
        *code = IPC_ERR_NOT_FOUND;
        *message = "unknown connection id";
        return NULL;
    }

    dbc_dml_row row = {
        .schema = schema_str,
        .table = table->valuestring,
        .n_set = n_set,
        .set_cols = (const char *const *)set_cols,
        .set_vals = (const char *const *)set_vals,
        .n_where = n_where,
        .where_cols = (const char *const *)where_cols,
        .where_vals = (const char *const *)where_vals,
        .set_types = set_types,
    };

    char *sql = NULL;
    long long rows_affected = 0;
    dbc_status st = dbcore_row_dml(&ref, kind, &row, preview, &sql,
                                   &rows_affected, g_edit_error,
                                   sizeof g_edit_error);
    free((void *)set_cols); free((void *)set_vals); free(set_types);
    free((void *)where_cols); free((void *)where_vals);

    if (st != DBC_OK) {
        *code = ipc_status_to_code(st);
        *message = g_edit_error[0] != '\0' ? g_edit_error : "edit failed";
        return NULL;
    }

    cJSON *result = cJSON_CreateObject();
    if (result == NULL || cJSON_AddStringToObject(result, "sql", sql) == NULL) {
        cJSON_Delete(result);
        free(sql);
        *code = IPC_ERR_INTERNAL;
        *message = "out of memory";
        return NULL;
    }
    free(sql);
    if (!preview) {
        cJSON_AddNumberToObject(result, "rowsAffected", (double)rows_affected);
    }
    *code = 0;
    return result;
}

cJSON *ipc_method_row_insert(const cJSON *params, int *code, const char **message)
{
    return edit_dispatch(params, code, message, DBC_DML_INSERT, "values", NULL, "setTypes");
}

cJSON *ipc_method_row_update(const cJSON *params, int *code, const char **message)
{
    return edit_dispatch(params, code, message, DBC_DML_UPDATE, "set", "where", "setTypes");
}

cJSON *ipc_method_row_delete(const cJSON *params, int *code, const char **message)
{
    return edit_dispatch(params, code, message, DBC_DML_DELETE, NULL, "where", NULL);
}
