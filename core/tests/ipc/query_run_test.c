#include "dbcore/ipc.h"
#include "dbcore/runtime.h"
#include "cJSON.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct dbc_conn { int tag; };
struct dbc_result { int cursor; };

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

/* Canned 2-column, 3-row result; configurable failure. */
static const char *k_names[] = { "id", "name" };
static const dbc_type k_types[] = { DBC_TYPE_INT, DBC_TYPE_TEXT };
static const char *k_cells[] = {
    "1", "alice",
    "2", NULL,
    "3", "carol",
};
static dbc_status  g_status = DBC_OK;
static const char *g_conn_err = "";

static struct dbc_result g_rs;

static dbc_status d_connect(const char *dsn, dbc_conn **out)
{
    (void)dsn;
    dbc_conn *c = malloc(sizeof *c);
    if (c == NULL) { return DBC_ERR_CONN; }
    *out = c;
    return DBC_OK;
}
static void        d_disconnect(dbc_conn *c) { free(c); }
static const char *d_last_error(dbc_conn *c) { (void)c; return g_conn_err; }
static dbc_status  d_query(dbc_conn *c, const char *sql, dbc_result **out)
{
    (void)c; (void)sql;
    if (g_status != DBC_OK) { *out = NULL; return g_status; }
    g_rs.cursor = -1;
    *out = &g_rs;
    return DBC_OK;
}
static void        d_free_result(dbc_result *r) { (void)r; }
static int         d_col_count(dbc_result *r) { (void)r; return 2; }
static const char *d_col_name(dbc_result *r, int c) { (void)r; return k_names[c]; }
static dbc_type    d_col_type(dbc_result *r, int c) { (void)r; return k_types[c]; }
static int d_next_row(dbc_result *r)
{
    if (r->cursor + 1 >= 3) { r->cursor = 3; return 0; }
    r->cursor++;
    return 1;
}
static const char *d_cell_text(dbc_result *r, int c) { return k_cells[r->cursor * 2 + c]; }
static long long   d_rows_affected(dbc_result *r) { (void)r; return 0; }

static dbc_driver_t make_driver(void)
{
    dbc_driver_t d = {0};
    d.abi_version   = DBC_ABI_VERSION;
    d.name          = "stub";
    d.display_name  = "Stub";
    d.connect       = d_connect;
    d.disconnect    = d_disconnect;
    d.last_error    = d_last_error;
    d.query         = d_query;
    d.free_result   = d_free_result;
    d.col_count     = d_col_count;
    d.col_name      = d_col_name;
    d.col_type      = d_col_type;
    d.next_row      = d_next_row;
    d.cell_text     = d_cell_text;
    d.rows_affected = d_rows_affected;
    return d;
}

static cJSON *call(const char *request)
{
    char *resp = dbcore_ipc_handle(request);
    cJSON *root = cJSON_Parse(resp);
    dbcore_ipc_free(resp);
    return root;
}

static int error_code(cJSON *root)
{
    cJSON *err = cJSON_GetObjectItemCaseSensitive(root, "error");
    cJSON *code = cJSON_GetObjectItemCaseSensitive(err, "code");
    return cJSON_IsNumber(code) ? code->valueint : 0;
}

int main(void)
{
    dbcore_runtime_reset();
    dbc_driver_t drv = make_driver();
    dbcore_runtime_register_driver(dbcore_runtime_get(), &drv);

    /* Open a connection to query against. */
    {
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"conn.open\","
                           "\"params\":{\"driver\":\"stub\",\"dsn\":{}}}");
        cJSON *connId = cJSON_GetObjectItem(cJSON_GetObjectItem(root, "result"), "connId");
        EXPECT(connId && strcmp(connId->valuestring, "c1") == 0, "opened c1");
        cJSON_Delete(root);
    }

    /* query.run returns columns + rows; small set is not truncated. */
    {
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"query.run\","
                           "\"params\":{\"connId\":\"c1\",\"sql\":\"SELECT\",\"limit\":10}}");
        cJSON *res = cJSON_GetObjectItem(root, "result");
        EXPECT(res != NULL, "query.run returns a result");
        EXPECT(cJSON_GetArraySize(cJSON_GetObjectItem(res, "columns")) == 2, "2 columns");
        EXPECT(cJSON_GetArraySize(cJSON_GetObjectItem(res, "rows")) == 3, "3 rows");
        EXPECT(cJSON_IsFalse(cJSON_GetObjectItem(res, "truncated")), "not truncated");
        cJSON *r1 = cJSON_GetArrayItem(cJSON_GetObjectItem(res, "rows"), 1);
        EXPECT(cJSON_IsNull(cJSON_GetArrayItem(r1, 1)), "NULL cell over the wire");
        cJSON_Delete(root);
    }

    /* limit honored: 2 of 3 rows, truncated flagged. */
    {
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"query.run\","
                           "\"params\":{\"connId\":\"c1\",\"sql\":\"SELECT\",\"limit\":2}}");
        cJSON *res = cJSON_GetObjectItem(root, "result");
        EXPECT(cJSON_GetArraySize(cJSON_GetObjectItem(res, "rows")) == 2, "limited to 2 rows");
        EXPECT(cJSON_IsTrue(cJSON_GetObjectItem(res, "truncated")), "truncated flagged");
        cJSON_Delete(root);
    }

    /* limit omitted: default cap applies, all 3 rows fit. */
    {
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"query.run\","
                           "\"params\":{\"connId\":\"c1\",\"sql\":\"SELECT\"}}");
        cJSON *res = cJSON_GetObjectItem(root, "result");
        EXPECT(cJSON_GetArraySize(cJSON_GetObjectItem(res, "rows")) == 3, "default limit returns all");
        cJSON_Delete(root);
    }

    /* Error cases. */
    {
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"query.run\","
                           "\"params\":{\"connId\":\"c999\",\"sql\":\"SELECT\"}}");
        EXPECT(error_code(root) == -32002, "unknown connId -> -32002");
        cJSON_Delete(root);

        root = call("{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"query.run\","
                    "\"params\":{\"connId\":\"bad\",\"sql\":\"SELECT\"}}");
        EXPECT(error_code(root) == -32602, "malformed connId -> -32602");
        cJSON_Delete(root);

        root = call("{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"query.run\","
                    "\"params\":{\"connId\":\"c1\"}}");
        EXPECT(error_code(root) == -32602, "missing sql -> -32602");
        cJSON_Delete(root);

        root = call("{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"query.run\","
                    "\"params\":{\"connId\":\"c1\",\"sql\":\"SELECT\",\"limit\":0}}");
        EXPECT(error_code(root) == -32602, "limit 0 -> -32602");
        cJSON_Delete(root);
    }

    /* Query execution failure -> -32003 with the driver's message. */
    {
        g_status = DBC_ERR_QUERY;
        g_conn_err = "no such table: ghost";
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"query.run\","
                           "\"params\":{\"connId\":\"c1\",\"sql\":\"SELECT\"}}");
        cJSON *msg = cJSON_GetObjectItem(cJSON_GetObjectItem(root, "error"), "message");
        EXPECT(error_code(root) == -32003, "query failure -> -32003");
        EXPECT(msg && strcmp(msg->valuestring, "no such table: ghost") == 0,
               "driver message propagated");
        cJSON_Delete(root);
    }

    /* Query failure with an empty driver message -> generic fallback. */
    {
        g_status = DBC_ERR_QUERY;
        g_conn_err = "";
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":11,\"method\":\"query.run\","
                           "\"params\":{\"connId\":\"c1\",\"sql\":\"SELECT\"}}");
        cJSON *msg = cJSON_GetObjectItem(cJSON_GetObjectItem(root, "error"), "message");
        EXPECT(error_code(root) == -32003, "empty-message failure still -32003");
        EXPECT(msg && strcmp(msg->valuestring, "query failed") == 0,
               "generic fallback message");
        cJSON_Delete(root);
        g_status = DBC_OK;
        g_conn_err = "";
    }

    /* Non-integer limit is rejected. */
    {
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":12,\"method\":\"query.run\","
                           "\"params\":{\"connId\":\"c1\",\"sql\":\"SELECT\",\"limit\":1.5}}");
        EXPECT(error_code(root) == -32602, "fractional limit -> -32602");
        cJSON_Delete(root);
    }

    /* Close the connection. */
    {
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"conn.close\","
                           "\"params\":{\"connId\":\"c1\"}}");
        EXPECT(cJSON_IsTrue(cJSON_GetObjectItem(cJSON_GetObjectItem(root, "result"), "closed")),
               "closed");
        cJSON_Delete(root);
    }

    dbcore_runtime_reset();

    if (failures == 0) {
        printf("OK: query.run IPC method (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
