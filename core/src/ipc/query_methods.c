#include "query_methods.h"

#include "conn_methods.h"   /* ipc_conn_id_parse */
#include "result_json.h"
#include "rpc.h"

#include "dbcore/op_registry.h"
#include "dbcore/query.h"
#include "dbcore/result.h"
#include "dbcore/runtime.h"

/* Holds the most recent query error text across the dispatcher's response
   build (the core is single-threaded). */
static char g_query_error[256];

/* params.connId -> a connection id. Shared by every query method. */
static int ipc_query_conn_id(const cJSON *params, int *id, int *code,
                             const char **message)
{
    const cJSON *conn_id = cJSON_GetObjectItemCaseSensitive(params, "connId");
    if (!cJSON_IsString(conn_id) || conn_id->valuestring == NULL) {
        *code = IPC_ERR_PARAMS;
        *message = "params.connId (string) is required";
        return 0;
    }
    if (!ipc_conn_id_parse(conn_id->valuestring, id)) {
        *code = IPC_ERR_PARAMS;
        *message = "malformed connId";
        return 0;
    }
    return 1;
}

/* Optional params.limit: a whole number >= 1, left untouched when absent. The
   valuedouble vs valueint comparison rejects fractional values (1.5) and
   out-of-int-range values (cJSON clamps valueint but not valuedouble). */
static int ipc_query_limit(const cJSON *params, int *limit, int *code,
                           const char **message)
{
    const cJSON *limit_item = cJSON_GetObjectItemCaseSensitive(params, "limit");
    if (limit_item == NULL) {
        return 1;
    }
    if (!cJSON_IsNumber(limit_item) ||
        limit_item->valuedouble != (double)limit_item->valueint ||
        limit_item->valueint < 1) {
        *code = IPC_ERR_PARAMS;
        *message = "params.limit must be a positive integer";
        return 0;
    }
    *limit = limit_item->valueint;
    return 1;
}

cJSON *ipc_method_query_run(const cJSON *params, int *code, const char **message)
{
    int id = 0;
    if (!ipc_query_conn_id(params, &id, code, message)) {
        return NULL;
    }

    const cJSON *sql = cJSON_GetObjectItemCaseSensitive(params, "sql");
    if (!cJSON_IsString(sql) || sql->valuestring == NULL) {
        *code = IPC_ERR_PARAMS;
        *message = "params.sql (string) is required";
        return NULL;
    }

    int limit = IPC_QUERY_DEFAULT_LIMIT;
    if (!ipc_query_limit(params, &limit, code, message)) {
        return NULL;
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

    /* cursor is optional: with it the driver's result is kept OPEN so the next
       page continues this execution instead of re-running the query (issue
       #478). It pages forward from the first row, so it cannot be combined with
       a starting offset. */
    int keep_cursor = 0;
    const cJSON *cursor_item = cJSON_GetObjectItemCaseSensitive(params, "cursor");
    if (cursor_item != NULL) {
        if (!cJSON_IsBool(cursor_item)) {
            *code = IPC_ERR_PARAMS;
            *message = "params.cursor must be a boolean";
            return NULL;
        }
        keep_cursor = cJSON_IsTrue(cursor_item);
    }
    if (keep_cursor && offset > 0) {
        *code = IPC_ERR_PARAMS;
        *message = "params.cursor cannot be combined with params.offset";
        return NULL;
    }

    dbcore_runtime *rt = dbcore_runtime_get();
    if (rt == NULL) {
        *code = IPC_ERR_INTERNAL;
        *message = "out of memory";
        return NULL;
    }

    dbcore_conn_manager *conns = dbcore_runtime_conns(rt);
    dbcore_conn_ref ref;
    if (!dbcore_conn_manager_get(conns, id, &ref)) {
        *code = IPC_ERR_NOT_FOUND;
        *message = "unknown connection id";
        return NULL;
    }

    /* Only a cursor run replaces the connection's cursor. A plain query.run
       must NOT drop it: the frontend fires catalog queries of its own (foreign
       keys, completions) on the same connection right after a query, and
       dropping the cursor there sent every page turn straight back to
       re-running the query — the bug this was supposed to fix. */
    if (keep_cursor) {
        dbcore_conn_manager_set_cursor(conns, id, NULL);
    }

    /* Publish the running query so op.cancel (arriving on another thread) can
       reach the driver's cancel hook while this call blocks. Cleared on return. */
    dbcore_op_begin(id, ref.driver, ref.handle);
    dbcore_result *res = NULL;
    dbc_result *cursor = NULL;
    dbc_status st =
        keep_cursor
            ? dbcore_query_open(&ref, sql->valuestring, limit, &res, &cursor,
                                g_query_error, sizeof g_query_error)
            : dbcore_query_run(&ref, sql->valuestring, limit, offset, &res,
                               g_query_error, sizeof g_query_error);
    dbcore_op_end(id);
    if (st != DBC_OK) {
        *code = ipc_status_to_code(st);
        *message = g_query_error[0] != '\0' ? g_query_error : "query failed";
        return NULL;
    }
    if (cursor != NULL && !dbcore_conn_manager_set_cursor(conns, id, cursor)) {
        /* The connection went away under us; nobody else owns the cursor. */
        ref.driver->free_result(cursor);
        cursor = NULL;
    }

    cJSON *result = ipc_page_to_json(res, cursor != NULL);
    dbcore_result_free(res);
    if (result == NULL) {
        *code = IPC_ERR_INTERNAL;
        *message = "out of memory";
        return NULL;
    }
    *code = 0;
    return result;
}

/*
 * query.next — the next page off the cursor query.run left open on this
 * connection (issue #478). The query is NOT executed again: the driver's result
 * is still positioned where the last page stopped.
 */
cJSON *ipc_method_query_next(const cJSON *params, int *code, const char **message)
{
    int id = 0;
    if (!ipc_query_conn_id(params, &id, code, message)) {
        return NULL;
    }
    int limit = IPC_QUERY_DEFAULT_LIMIT;
    if (!ipc_query_limit(params, &limit, code, message)) {
        return NULL;
    }

    dbcore_runtime *rt = dbcore_runtime_get();
    if (rt == NULL) {
        *code = IPC_ERR_INTERNAL;
        *message = "out of memory";
        return NULL;
    }
    dbcore_conn_manager *conns = dbcore_runtime_conns(rt);
    dbcore_conn_ref ref;
    if (!dbcore_conn_manager_get(conns, id, &ref)) {
        *code = IPC_ERR_NOT_FOUND;
        *message = "unknown connection id";
        return NULL;
    }

    /* Taken, not borrowed: dbcore_query_next frees the cursor when the rows run
       out or the driver fails, so the manager must not keep a pointer it no
       longer owns. It goes back only while it is still alive. */
    dbc_result *cursor = dbcore_conn_manager_take_cursor(conns, id);
    if (cursor == NULL) {
        *code = IPC_ERR_NOT_FOUND;
        *message = "no open cursor for this connection";
        return NULL;
    }

    dbcore_op_begin(id, ref.driver, ref.handle);
    dbcore_result *res = NULL;
    int open = 0;
    dbc_status st = dbcore_query_next(&ref, cursor, limit, &res, &open,
                                      g_query_error, sizeof g_query_error);
    dbcore_op_end(id);
    if (open && !dbcore_conn_manager_set_cursor(conns, id, cursor)) {
        ref.driver->free_result(cursor);
        open = 0;
    }
    if (st != DBC_OK) {
        *code = ipc_status_to_code(st);
        *message = g_query_error[0] != '\0' ? g_query_error : "query failed";
        return NULL;
    }

    cJSON *result = ipc_page_to_json(res, open != 0);
    dbcore_result_free(res);
    if (result == NULL) {
        *code = IPC_ERR_INTERNAL;
        *message = "out of memory";
        return NULL;
    }
    *code = 0;
    return result;
}

/*
 * query.cursorClose — release the connection's open cursor (issue #478). Closing
 * one that is already gone is not an error: the frontend drops a cursor another
 * tab's query may have replaced, and `closed` says which case it was.
 */
cJSON *ipc_method_query_cursor_close(const cJSON *params, int *code,
                                     const char **message)
{
    int id = 0;
    if (!ipc_query_conn_id(params, &id, code, message)) {
        return NULL;
    }
    dbcore_runtime *rt = dbcore_runtime_get();
    if (rt == NULL) {
        *code = IPC_ERR_INTERNAL;
        *message = "out of memory";
        return NULL;
    }
    dbcore_conn_manager *conns = dbcore_runtime_conns(rt);
    dbcore_conn_ref ref;
    if (!dbcore_conn_manager_get(conns, id, &ref)) {
        *code = IPC_ERR_NOT_FOUND;
        *message = "unknown connection id";
        return NULL;
    }
    dbc_result *cursor = dbcore_conn_manager_take_cursor(conns, id);
    if (cursor != NULL) {
        ref.driver->free_result(cursor);
    }
    cJSON *result = cJSON_CreateObject();
    if (result == NULL ||
        cJSON_AddBoolToObject(result, "closed", cursor != NULL) == NULL) {
        cJSON_Delete(result);
        *code = IPC_ERR_INTERNAL;
        *message = "out of memory";
        return NULL;
    }
    *code = 0;
    return result;
}
