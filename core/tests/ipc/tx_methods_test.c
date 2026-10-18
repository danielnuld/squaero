#include "dbcore/ipc.h"
#include "dbcore/runtime.h"
#include "cJSON.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* tx.begin / tx.commit / tx.rollback through the public dispatcher, with the
   per-connection "transaction open" bookkeeping of issue #667: a second begin is
   refused before it reaches the engine, a successful commit or any rollback ends
   the transaction, and a failed commit leaves it open to be rolled back. */
struct dbc_conn { int tag; };

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

static int g_begins = 0;
static int g_commit_fails = 0;

static dbc_status ok_connect(const char *dsn, dbc_conn **out)
{
    (void)dsn;
    dbc_conn *c = malloc(sizeof *c);
    if (c == NULL) { return DBC_ERR_CONN; }
    *out = c;
    return DBC_OK;
}
static void        s_disconnect(dbc_conn *c) { free(c); }
static const char *s_last_error(dbc_conn *c) { (void)c; return "engine says no"; }
static dbc_status  s_query(dbc_conn *c, const char *s, dbc_result **o) { (void)c; (void)s; (void)o; return DBC_OK; }
static void        s_free_result(dbc_result *r) { (void)r; }
static int         s_col_count(dbc_result *r) { (void)r; return 0; }
static const char *s_col_name(dbc_result *r, int c) { (void)r; (void)c; return ""; }
static dbc_type    s_col_type(dbc_result *r, int c) { (void)r; (void)c; return DBC_TYPE_NULL; }
static int         s_next_row(dbc_result *r) { (void)r; return 0; }
static const char *s_cell_text(dbc_result *r, int c) { (void)r; (void)c; return NULL; }
static long long   s_rows_affected(dbc_result *r) { (void)r; return 0; }

static dbc_status s_begin(dbc_conn *c) { (void)c; g_begins++; return DBC_OK; }
static dbc_status s_commit(dbc_conn *c) { (void)c; return g_commit_fails ? DBC_ERR_QUERY : DBC_OK; }
static dbc_status s_rollback(dbc_conn *c) { (void)c; return DBC_OK; }

static dbc_driver_t tx_driver(void)
{
    dbc_driver_t d = {0};
    d.abi_version   = DBC_ABI_VERSION;
    d.name          = "txstub";
    d.display_name  = "txstub";
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
    d.begin         = s_begin;
    d.commit        = s_commit;
    d.rollback      = s_rollback;
    d.features      = DBC_FEAT_TRANSACTIONS;
    return d;
}

/* Calls `method` on `connId` and returns the error code (0 = success). */
static int tx(const char *method, const char *conn_id)
{
    char req[192];
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"%s\",\"params\":{\"connId\":\"%s\"}}",
             method, conn_id);
    char *resp = dbcore_ipc_handle(req);
    cJSON *root = cJSON_Parse(resp);
    dbcore_ipc_free(resp);
    cJSON *err = cJSON_GetObjectItemCaseSensitive(root, "error");
    cJSON *code = cJSON_GetObjectItemCaseSensitive(err, "code");
    int rc = cJSON_IsNumber(code) ? code->valueint : 0;
    cJSON_Delete(root);
    return rc;
}

static void open_conn(void)
{
    char *resp = dbcore_ipc_handle(
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"conn.open\","
        "\"params\":{\"driver\":\"txstub\",\"dsn\":{}}}");
    dbcore_ipc_free(resp);
}

int main(void)
{
    dbcore_runtime_reset();
    dbc_driver_t d = tx_driver();
    dbcore_runtime_register_driver(dbcore_runtime_get(), &d);
    open_conn(); /* c1 */
    open_conn(); /* c2 */

    /* A second begin is refused without reaching the engine. */
    EXPECT(tx("tx.begin", "c1") == 0, "begin ok");
    EXPECT(tx("tx.begin", "c1") == -32003, "nested begin -> -32003");
    EXPECT(g_begins == 1, "the nested begin never reached the driver");

    /* The flag is per connection. */
    EXPECT(tx("tx.begin", "c2") == 0, "begin on another connection ok");
    EXPECT(tx("tx.rollback", "c2") == 0, "rollback c2");

    /* A commit ends it: begin works again. */
    EXPECT(tx("tx.commit", "c1") == 0, "commit ok");
    EXPECT(tx("tx.begin", "c1") == 0, "begin after commit ok");

    /* A failed commit leaves it open; a rollback ends it. */
    g_commit_fails = 1;
    EXPECT(tx("tx.commit", "c1") == -32003, "failed commit -> -32003");
    EXPECT(tx("tx.begin", "c1") == -32003, "still open after a failed commit");
    EXPECT(tx("tx.rollback", "c1") == 0, "rollback ok");
    EXPECT(tx("tx.begin", "c1") == 0, "begin after rollback ok");
    g_commit_fails = 0;

    /* Closing the connection takes the flag with it (ids are never reused, so
       a fresh connection starts clean). */
    {
        char *resp = dbcore_ipc_handle("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"conn.close\","
                                       "\"params\":{\"connId\":\"c1\"}}");
        dbcore_ipc_free(resp);
        open_conn(); /* c3 */
        EXPECT(tx("tx.begin", "c3") == 0, "a new connection starts without a transaction");
    }

    dbcore_runtime_reset();

    if (failures == 0) {
        printf("OK: tx IPC methods (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
