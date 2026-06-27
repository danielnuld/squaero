#include "conn_methods.h"   /* internal: id helpers under test */

#include "dbcore/ipc.h"
#include "dbcore/runtime.h"
#include "cJSON.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct dbc_conn { int tag; };

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

/* --- trivial required members --- */
static void        s_disconnect(dbc_conn *c) { free(c); }
static const char *s_last_error(dbc_conn *c) { (void)c; return ""; }
static dbc_status  s_query(dbc_conn *c, const char *s, dbc_result **o) { (void)c; (void)s; (void)o; return DBC_OK; }
static void        s_free_result(dbc_result *r) { (void)r; }
static int         s_col_count(dbc_result *r) { (void)r; return 0; }
static const char *s_col_name(dbc_result *r, int c) { (void)r; (void)c; return ""; }
static dbc_type    s_col_type(dbc_result *r, int c) { (void)r; (void)c; return DBC_TYPE_NULL; }
static int         s_next_row(dbc_result *r) { (void)r; return 0; }
static const char *s_cell_text(dbc_result *r, int c) { (void)r; (void)c; return NULL; }
static long long   s_rows_affected(dbc_result *r) { (void)r; return 0; }

static dbc_status ok_connect(const char *dsn, dbc_conn **out)
{
    (void)dsn;
    dbc_conn *c = malloc(sizeof *c);
    if (c == NULL) { return DBC_ERR_CONN; }
    *out = c;
    return DBC_OK;
}

static dbc_conn g_err = {0};
static dbc_status boom_connect(const char *dsn, dbc_conn **out)
{
    (void)dsn;
    *out = &g_err;
    return DBC_ERR_CONN;
}
static void boom_disconnect(dbc_conn *c) { (void)c; }
static const char *boom_last_error(dbc_conn *c) { (void)c; return "nope"; }

/* A driver that refuses the operation as unsupported (no handle). */
static dbc_status unsup_connect(const char *dsn, dbc_conn **out)
{
    (void)dsn;
    *out = NULL;
    return DBC_ERR_UNSUPPORTED;
}

static dbc_driver_t base(const char *name)
{
    dbc_driver_t d = {0};
    d.abi_version   = DBC_ABI_VERSION;
    d.name          = name;
    d.display_name  = name;
    d.connect       = ok_connect;
    d.disconnect    = s_disconnect;
    d.last_error    = s_last_error;
    d.query         = s_query;
    d.free_result   = s_free_result;
    d.col_count     = s_col_count;
    d.col_name      = s_col_name;
    d.col_type      = s_col_type;
    d.next_row      = s_next_row;
    d.cell_text     = s_cell_text;
    d.rows_affected = s_rows_affected;
    return d;
}

/* Send a request and return the parsed response root (caller frees). */
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

static void test_id_helpers(void)
{
    char buf[24];
    EXPECT(strcmp(ipc_conn_id_format(1, buf, sizeof buf), "c1") == 0, "format c1");
    EXPECT(strcmp(ipc_conn_id_format(42, buf, sizeof buf), "c42") == 0, "format c42");

    int v = 0;
    EXPECT(ipc_conn_id_parse("c1", &v) == 1 && v == 1, "parse c1");
    EXPECT(ipc_conn_id_parse("c42", &v) == 1 && v == 42, "parse c42");
    EXPECT(ipc_conn_id_parse("c0", &v) == 0, "reject c0");
    EXPECT(ipc_conn_id_parse("c", &v) == 0, "reject bare c");
    EXPECT(ipc_conn_id_parse("x1", &v) == 0, "reject wrong prefix");
    EXPECT(ipc_conn_id_parse("c1a", &v) == 0, "reject trailing junk");
    EXPECT(ipc_conn_id_parse(NULL, &v) == 0, "reject NULL");
    EXPECT(ipc_conn_id_parse("c99999999999", &v) == 0, "reject overflowing id");
}

int main(void)
{
    test_id_helpers();

    dbcore_runtime_reset();
    dbc_driver_t stub = base("stub");
    dbc_driver_t boom = base("boom");
    boom.connect = boom_connect;
    boom.disconnect = boom_disconnect;
    boom.last_error = boom_last_error;
    dbc_driver_t unsup = base("unsup");
    unsup.connect = unsup_connect;
    dbcore_runtime_register_driver(dbcore_runtime_get(), &stub);
    dbcore_runtime_register_driver(dbcore_runtime_get(), &boom);
    dbcore_runtime_register_driver(dbcore_runtime_get(), &unsup);

    /* Open a connection through the dispatcher. */
    {
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"conn.open\","
                           "\"params\":{\"driver\":\"stub\",\"dsn\":{\"path\":\":memory:\"}}}");
        cJSON *result = cJSON_GetObjectItemCaseSensitive(root, "result");
        cJSON *connId = cJSON_GetObjectItemCaseSensitive(result, "connId");
        EXPECT(cJSON_IsString(connId) && strcmp(connId->valuestring, "c1") == 0,
               "conn.open returns connId c1");
        cJSON_Delete(root);
    }

    /* Unknown driver -> NOT_FOUND. */
    {
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"conn.open\","
                           "\"params\":{\"driver\":\"ghost\",\"dsn\":{}}}");
        EXPECT(error_code(root) == -32002, "unknown driver -> -32002");
        cJSON_Delete(root);
    }

    /* Missing dsn -> invalid params. */
    {
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"conn.open\","
                           "\"params\":{\"driver\":\"stub\"}}");
        EXPECT(error_code(root) == -32602, "missing dsn -> -32602");
        cJSON_Delete(root);
    }

    /* Driver connect failure -> CONN error with the driver's last_error text. */
    {
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"conn.open\","
                           "\"params\":{\"driver\":\"boom\",\"dsn\":{}}}");
        cJSON *err = cJSON_GetObjectItemCaseSensitive(root, "error");
        cJSON *msg = cJSON_GetObjectItemCaseSensitive(err, "message");
        EXPECT(error_code(root) == -32000, "connect failure -> -32000");
        EXPECT(cJSON_IsString(msg) && strcmp(msg->valuestring, "nope") == 0,
               "last_error propagated to IPC");
        cJSON_Delete(root);
    }

    /* Driver reports the operation unsupported -> -32001. */
    {
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"conn.open\","
                           "\"params\":{\"driver\":\"unsup\",\"dsn\":{}}}");
        EXPECT(error_code(root) == -32001, "unsupported connect -> -32001");
        cJSON_Delete(root);
    }

    /* Request with no params at all -> invalid params, no crash. */
    {
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"conn.open\"}");
        EXPECT(error_code(root) == -32602, "conn.open without params -> -32602");
        cJSON_Delete(root);
        root = call("{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"conn.close\"}");
        EXPECT(error_code(root) == -32602, "conn.close without params -> -32602");
        cJSON_Delete(root);
    }

    /* Close the open connection. */
    {
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"conn.close\","
                           "\"params\":{\"connId\":\"c1\"}}");
        cJSON *result = cJSON_GetObjectItemCaseSensitive(root, "result");
        cJSON *closed = cJSON_GetObjectItemCaseSensitive(result, "closed");
        EXPECT(cJSON_IsBool(closed) && cJSON_IsTrue(closed), "conn.close returns closed:true");
        cJSON_Delete(root);
    }

    /* Close an unknown id -> NOT_FOUND. */
    {
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"conn.close\","
                           "\"params\":{\"connId\":\"c999\"}}");
        EXPECT(error_code(root) == -32002, "close unknown id -> -32002");
        cJSON_Delete(root);
    }

    /* Malformed connId -> invalid params. */
    {
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"conn.close\","
                           "\"params\":{\"connId\":\"bogus\"}}");
        EXPECT(error_code(root) == -32602, "malformed connId -> -32602");
        cJSON_Delete(root);
    }

    dbcore_runtime_reset();

    if (failures == 0) {
        printf("OK: conn IPC methods (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
