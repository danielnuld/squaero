#include "conn_lost.h"

#include "dbcore/ipc.h"
#include "dbcore/runtime.h"
#include "cJSON.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* A lost connection (issue #676), through the public dispatcher with a fake
   driver whose session "dies" on demand: a -32000 from a method that ran on an
   open connection carries {connLost, inTx, retrySafe}, and retrySafe is true
   only for a provably read-only query.run outside a transaction. */
struct dbc_conn { int tag; };

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

static int g_dead = 0;         /* tx.* find the session gone too */
static int g_open_fails = 0;   /* connect fails with CONN */
static int g_query_fails = 0;  /* the query fails with an ordinary QUERY error */

static dbc_status f_connect(const char *dsn, dbc_conn **out)
{
    (void)dsn;
    if (g_open_fails) { return DBC_ERR_CONN; }
    dbc_conn *c = malloc(sizeof *c);
    if (c == NULL) { return DBC_ERR_NOMEM; }
    *out = c;
    return DBC_OK;
}
static void        f_disconnect(dbc_conn *c) { free(c); }
static const char *f_last_error(dbc_conn *c) { (void)c; return "server closed the connection"; }
static dbc_status  f_query(dbc_conn *c, const char *s, dbc_result **o)
{
    (void)c; (void)s; (void)o;
    /* Every query finds the session gone unless told to fail ordinarily. */
    return g_query_fails ? DBC_ERR_QUERY : DBC_ERR_CONN;
}
static void        f_free_result(dbc_result *r) { (void)r; }
static int         f_col_count(dbc_result *r) { (void)r; return 0; }
static const char *f_col_name(dbc_result *r, int c) { (void)r; (void)c; return ""; }
static dbc_type    f_col_type(dbc_result *r, int c) { (void)r; (void)c; return DBC_TYPE_NULL; }
static int         f_next_row(dbc_result *r) { (void)r; return 0; }
static const char *f_cell_text(dbc_result *r, int c) { (void)r; (void)c; return NULL; }
static long long   f_rows_affected(dbc_result *r) { (void)r; return 0; }
static dbc_status  f_tx(dbc_conn *c) { (void)c; return g_dead ? DBC_ERR_CONN : DBC_OK; }

static dbc_driver_t fake_driver(void)
{
    dbc_driver_t d = {0};
    d.abi_version   = DBC_ABI_VERSION;
    d.name          = "lostdb";
    d.display_name  = "lostdb";
    d.connect       = f_connect;
    d.disconnect    = f_disconnect;
    d.last_error    = f_last_error;
    d.query         = f_query;
    d.free_result   = f_free_result;
    d.col_count     = f_col_count;
    d.col_name      = f_col_name;
    d.col_type      = f_col_type;
    d.next_row      = f_next_row;
    d.cell_text     = f_cell_text;
    d.rows_affected = f_rows_affected;
    d.begin         = f_tx;
    d.commit        = f_tx;
    d.rollback      = f_tx;
    d.features      = DBC_FEAT_TRANSACTIONS;
    return d;
}

/* What one call answered. */
typedef struct {
    int code;      /* 0 = success */
    int has_data;  /* error.data present */
    int conn_lost;
    int in_tx;
    int retry_safe;
} answer;

static int bool_of(const cJSON *obj, const char *key)
{
    return cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(obj, key));
}

static answer call(const char *method, const char *params_json)
{
    char req[512];
    snprintf(req, sizeof req, "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"%s\",\"params\":%s}",
             method, params_json);
    char *resp = dbcore_ipc_handle(req);
    cJSON *root = cJSON_Parse(resp);
    dbcore_ipc_free(resp);
    answer a = {0, 0, 0, 0, 0};
    cJSON *err = cJSON_GetObjectItemCaseSensitive(root, "error");
    cJSON *code = cJSON_GetObjectItemCaseSensitive(err, "code");
    a.code = cJSON_IsNumber(code) ? code->valueint : 0;
    cJSON *data = cJSON_GetObjectItemCaseSensitive(err, "data");
    a.has_data = cJSON_IsObject(data);
    a.conn_lost = bool_of(data, "connLost");
    a.in_tx = bool_of(data, "inTx");
    a.retry_safe = bool_of(data, "retrySafe");
    cJSON_Delete(root);
    return a;
}

static answer run(const char *sql)
{
    char params[256];
    snprintf(params, sizeof params, "{\"connId\":\"c1\",\"sql\":\"%s\"}", sql);
    return call("query.run", params);
}

/* The pure builder, without the dispatcher. */
static void test_pure(void)
{
    cJSON *params = cJSON_Parse("{\"connId\":\"c1\",\"sql\":\"SELECT 1\"}");
    cJSON *d = ipc_conn_lost_data("query.run", params, 0);
    EXPECT(bool_of(d, "connLost") && !bool_of(d, "inTx") && bool_of(d, "retrySafe"),
           "pure: a read outside a transaction is retry-safe");
    cJSON_Delete(d);

    d = ipc_conn_lost_data("query.run", params, 1);
    EXPECT(bool_of(d, "inTx") && !bool_of(d, "retrySafe"), "pure: never inside a transaction");
    cJSON_Delete(d);

    d = ipc_conn_lost_data("schema.tree", params, 0);
    EXPECT(!bool_of(d, "retrySafe"), "pure: only query.run is retried");
    cJSON_Delete(d);
    cJSON_Delete(params);

    d = ipc_conn_lost_data("query.run", NULL, 0);
    EXPECT(bool_of(d, "connLost") && !bool_of(d, "retrySafe"), "pure: no sql -> not retry-safe");
    cJSON_Delete(d);

    d = ipc_conn_lost_data(NULL, NULL, 0);
    EXPECT(d != NULL && !bool_of(d, "retrySafe"), "pure: NULL method is handled");
    cJSON_Delete(d);
}

int main(void)
{
    test_pure();

    dbcore_runtime_reset();
    dbc_driver_t d = fake_driver();
    dbcore_runtime_register_driver(dbcore_runtime_get(), &d);
    char *resp = dbcore_ipc_handle("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"conn.open\","
                                   "\"params\":{\"driver\":\"lostdb\",\"dsn\":{}}}");
    dbcore_ipc_free(resp); /* c1 */

    /* A provably read-only statement outside a transaction: safe to re-send. */
    answer a = run("SELECT * FROM t");
    EXPECT(a.code == -32000, "lost read -> -32000");
    EXPECT(a.has_data && a.conn_lost, "lost read carries connLost");
    EXPECT(!a.in_tx, "no transaction was open");
    EXPECT(a.retry_safe, "a read outside a transaction is retry-safe");

    /* Writes and anything the classifier cannot prove read-only: never. */
    a = run("UPDATE t SET x = 1");
    EXPECT(a.conn_lost && !a.retry_safe, "a write is not retry-safe");
    a = run("SELECT 1; DROP TABLE t");
    EXPECT(a.conn_lost && !a.retry_safe, "a read smuggling a write is not retry-safe");
    a = run("WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d");
    EXPECT(a.conn_lost && !a.retry_safe, "a data-modifying CTE is not retry-safe");

    /* Inside a transaction: the server rolled it back, nothing is retry-safe. */
    EXPECT(call("tx.begin", "{\"connId\":\"c1\"}").code == 0, "begin");
    a = run("SELECT * FROM t");
    EXPECT(a.conn_lost && a.in_tx, "lost inside a transaction says so");
    EXPECT(!a.retry_safe, "a read inside a transaction is not retry-safe");

    /* The commit that finds the session dead still reports the transaction. */
    g_dead = 1;
    a = call("tx.commit", "{\"connId\":\"c1\"}");
    EXPECT(a.code == -32000 && a.conn_lost && a.in_tx && !a.retry_safe,
           "a commit on a dead session reports the lost transaction");
    a = call("tx.rollback", "{\"connId\":\"c1\"}");
    EXPECT(a.conn_lost && a.in_tx, "the rollback reports it too (read before the call)");
    a = run("SELECT 1");
    EXPECT(a.conn_lost && !a.in_tx && a.retry_safe, "after the rollback no transaction remains");
    g_dead = 0;

    /* Not a lost connection: an ordinary query error carries no data. */
    g_query_fails = 1;
    a = run("SELECT 1");
    EXPECT(a.code == -32003 && !a.has_data, "a query error is not a lost connection");
    g_query_fails = 0;

    /* conn.open's -32000 means "could not open", not "lost". */
    g_open_fails = 1;
    a = call("conn.open", "{\"driver\":\"lostdb\",\"dsn\":{}}");
    EXPECT(a.code == -32000 && !a.has_data, "a failed open is not a lost connection");
    g_open_fails = 0;

    /* An unknown connection is not a lost one either. */
    a = call("query.run", "{\"connId\":\"c99\",\"sql\":\"SELECT 1\"}");
    EXPECT(a.code == -32002 && !a.has_data, "unknown connId -> -32002 without data");

    dbcore_runtime_reset();

    if (failures == 0) {
        printf("OK: connection-lost classification (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
