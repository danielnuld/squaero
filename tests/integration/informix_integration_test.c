/*
 * Informix integration test over DRDA (issue #557): the core drives the real
 * driver through IPC against a real server, as the app does. It checks what the
 * move from ODBC to DRDA could have broken:
 *   - text in and out as UTF-8 (the database code set is converted),
 *   - autocommit: a statement is visible from another connection at once,
 *   - BEGIN WORK / ROLLBACK WORK / COMMIT WORK typed in the editor,
 *   - a paging cursor left open while other statements run (issue #478),
 *   - cancel from another thread: the query stops at once and the connection
 *     is reported lost, and a new one works.
 *
 * SKIPS (exit 0) unless QUAERO_INFORMIX_DSN is set, e.g.
 *   {"host":"127.0.0.1","port":"19089","database":"drdatest",
 *    "user":"informix","password":"in4mix"}
 * The database must have a log (the transaction checks need one) and be
 * writable: the test creates and drops table quaero_ifx_it.
 * INFORMIX_PLUGIN_PATH is injected by CMake as the built plugin's full path.
 */
#define _POSIX_C_SOURCE 199309L

#include "dbcore/ipc.h"
#include "dbcore/loader.h"
#include "dbcore/runtime.h"

#include "cJSON.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#if defined(_WIN32)
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
#else
#  include <pthread.h>
#endif

static int failures = 0;
#define EXPECT(cond, msg)                         \
    do {                                          \
        if (!(cond)) {                            \
            fprintf(stderr, "FAIL: %s\n", (msg)); \
            failures++;                           \
        }                                         \
    } while (0)

/* One JSON-RPC call built with printf-style arguments. */
static cJSON *rpc(const char *fmt, ...)
{
    char req[4096];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(req, sizeof req, fmt, ap);
    va_end(ap);
    char *resp = dbcore_ipc_handle(req);
    cJSON *root = cJSON_Parse(resp);
    dbcore_ipc_free(resp);
    return root;
}

static cJSON *result_of(cJSON *root) { return cJSON_GetObjectItem(root, "result"); }

static int open_conn(const char *dsn, char *id, size_t cap)
{
    cJSON *root = rpc("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"conn.open\","
                      "\"params\":{\"driver\":\"informix\",\"dsn\":%s}}", dsn);
    cJSON *cid = cJSON_GetObjectItem(result_of(root), "connId");
    int ok = cJSON_IsString(cid);
    if (ok) {
        snprintf(id, cap, "%s", cid->valuestring);
    } else {
        cJSON *m = cJSON_GetObjectItem(cJSON_GetObjectItem(root, "error"), "message");
        fprintf(stderr, "conn.open error: %s\n", cJSON_IsString(m) ? m->valuestring : "?");
    }
    cJSON_Delete(root);
    return ok;
}

/* Run sql on conn; returns the parsed response (caller frees). */
static cJSON *run(const char *conn, const char *sql)
{
    return rpc("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"query.run\","
               "\"params\":{\"connId\":\"%s\",\"sql\":\"%s\"}}", conn, sql);
}

static int run_ok(const char *conn, const char *sql)
{
    cJSON *root = run(conn, sql);
    int ok = result_of(root) != NULL;
    cJSON_Delete(root);
    return ok;
}

/* First cell of the first row as text, into buf; "" when none. */
static const char *scalar(const char *conn, const char *sql, char *buf, size_t cap)
{
    cJSON *root = run(conn, sql);
    cJSON *rows = cJSON_GetObjectItem(result_of(root), "rows");
    cJSON *cell = cJSON_GetArrayItem(cJSON_GetArrayItem(rows, 0), 0);
    buf[0] = '\0';
    if (cJSON_IsString(cell)) {
        snprintf(buf, cap, "%s", cell->valuestring);
    } else if (cJSON_IsNumber(cell)) {
        snprintf(buf, cap, "%.0f", cell->valuedouble);
    }
    cJSON_Delete(root);
    return buf;
}

/* --- cancel: a slow query on its own thread ---------------------------- */

struct slow_query {
    char   conn_id[32];
    double seconds;
    int    failed;
};

static void run_slow_query(struct slow_query *s)
{
    time_t t0 = time(NULL);
    cJSON *root = run(s->conn_id, "SELECT COUNT(*) FROM syscolumns a, syscolumns b, systables c");
    s->seconds = difftime(time(NULL), t0);
    s->failed = cJSON_GetObjectItem(root, "error") != NULL;
    cJSON_Delete(root);
}

#if defined(_WIN32)
static DWORD WINAPI thread_entry(LPVOID arg)
{
    run_slow_query((struct slow_query *)arg);
    return 0;
}
static void sleep_ms(unsigned ms) { Sleep(ms); }
#else
static void *thread_entry(void *arg)
{
    run_slow_query((struct slow_query *)arg);
    return NULL;
}
static void sleep_ms(unsigned ms)
{
    struct timespec ts = { ms / 1000, (long)(ms % 1000) * 1000000L };
    nanosleep(&ts, NULL);
}
#endif

int main(void)
{
    const char *dsn = getenv("QUAERO_INFORMIX_DSN");
    char a[32] = {0}, b[32] = {0}, buf[256], err[256];
    if (dsn == NULL || dsn[0] == '\0') {
        printf("SKIP: QUAERO_INFORMIX_DSN not set; Informix integration test skipped\n");
        return 0;
    }

    dbc_plugin *plugin = NULL;
    if (dbc_plugin_load(INFORMIX_PLUGIN_PATH, &plugin, err, sizeof err) != DBC_OK) {
        fprintf(stderr, "could not load %s: %s\n", INFORMIX_PLUGIN_PATH, err);
        return 1;
    }
    const dbc_driver_t *drv = dbc_plugin_driver(plugin);
    EXPECT(drv != NULL && strcmp(drv->name, "informix") == 0, "driver is informix");
    dbcore_runtime_reset();
    dbcore_runtime_register_driver(dbcore_runtime_get(), drv);

    if (!open_conn(dsn, a, sizeof a) || !open_conn(dsn, b, sizeof b)) {
        fprintf(stderr, "FAIL: no connection; aborting\n");
        dbcore_runtime_reset();
        dbc_plugin_unload(plugin);
        return 1;
    }

    /* Setup, and text in and out as UTF-8. */
    run_ok(a, "DROP TABLE quaero_ifx_it"); /* left over by an aborted run */
    EXPECT(run_ok(a, "CREATE TABLE quaero_ifx_it (id INT, name VARCHAR(40))"), "create table");
    EXPECT(run_ok(a, "INSERT INTO quaero_ifx_it VALUES (1, 'Año ñandú')"), "insert");
    EXPECT(strcmp(scalar(a, "SELECT name FROM quaero_ifx_it WHERE id = 1", buf, sizeof buf),
                  "Año ñandú") == 0, "UTF-8 round trip");

    /* Autocommit: the other connection sees the row at once. */
    EXPECT(strcmp(scalar(b, "SELECT COUNT(*) FROM quaero_ifx_it", buf, sizeof buf), "1") == 0,
           "a statement is committed as it runs");

    /* Transactions typed in the editor. */
    EXPECT(run_ok(a, "BEGIN WORK"), "BEGIN WORK");
    EXPECT(run_ok(a, "INSERT INTO quaero_ifx_it VALUES (2, 'undone')"), "insert in a transaction");
    EXPECT(strcmp(scalar(a, "SELECT COUNT(*) FROM quaero_ifx_it", buf, sizeof buf), "2") == 0,
           "the transaction sees its own row");
    EXPECT(run_ok(a, "ROLLBACK WORK"), "ROLLBACK WORK");
    EXPECT(strcmp(scalar(a, "SELECT COUNT(*) FROM quaero_ifx_it", buf, sizeof buf), "1") == 0,
           "rollback undid the insert");
    EXPECT(run_ok(a, "BEGIN WORK") && run_ok(a, "INSERT INTO quaero_ifx_it VALUES (3, 'kept')") &&
           run_ok(a, "COMMIT WORK"), "BEGIN, INSERT, COMMIT");
    EXPECT(strcmp(scalar(b, "SELECT COUNT(*) FROM quaero_ifx_it", buf, sizeof buf), "2") == 0,
           "the committed row is visible elsewhere");

    /* A paging cursor stays open while other statements run (issue #478). */
    {
        int total, seen = 0;
        cJSON *root;
        total = atoi(scalar(a, "SELECT COUNT(*) FROM syscolumns c, systables t "
                               "WHERE c.tabid = t.tabid", buf, sizeof buf));
        root = rpc("{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"query.run\","
                   "\"params\":{\"connId\":\"%s\",\"sql\":\"SELECT c.colname, t.tabname FROM "
                   "syscolumns c, systables t WHERE c.tabid = t.tabid\",\"limit\":100,"
                   "\"cursor\":true}}", a);
        seen += cJSON_GetArraySize(cJSON_GetObjectItem(result_of(root), "rows"));
        EXPECT(cJSON_IsTrue(cJSON_GetObjectItem(result_of(root), "cursor")), "cursor left open");
        cJSON_Delete(root);
        EXPECT(run_ok(a, "UPDATE quaero_ifx_it SET name = 'x' WHERE id = 3"),
               "a statement while the cursor is open");
        EXPECT(strcmp(scalar(a, "SELECT COUNT(*) FROM quaero_ifx_it", buf, sizeof buf), "2") == 0,
               "a query while the cursor is open");
        root = rpc("{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"query.next\","
                   "\"params\":{\"connId\":\"%s\",\"limit\":1000000}}", a);
        seen += cJSON_GetArraySize(cJSON_GetObjectItem(result_of(root), "rows"));
        cJSON_Delete(root);
        EXPECT(total > 100 && seen == total, "the cursor delivered every row once");
        if (seen != total) {
            fprintf(stderr, "cursor: %d of %d rows\n", seen, total);
        }
    }

    EXPECT(run_ok(a, "DROP TABLE quaero_ifx_it"), "drop table");

    /* Cancel: the slow query stops at once; the connection is then lost. */
    {
        struct slow_query s;
        memset(&s, 0, sizeof s);
        snprintf(s.conn_id, sizeof s.conn_id, "%s", b);
#if defined(_WIN32)
        HANDLE th = CreateThread(NULL, 0, thread_entry, &s, 0, NULL);
#else
        pthread_t th;
        pthread_create(&th, NULL, thread_entry, &s);
#endif
        sleep_ms(1000);
        cJSON *root = rpc("{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"op.cancel\","
                          "\"params\":{\"connId\":\"%s\"}}", b);
        EXPECT(cJSON_IsTrue(cJSON_GetObjectItem(result_of(root), "canceled")),
               "op.cancel delivered");
        cJSON_Delete(root);
#if defined(_WIN32)
        WaitForSingleObject(th, INFINITE);
        CloseHandle(th);
#else
        pthread_join(th, NULL);
#endif
        EXPECT(s.failed && s.seconds < 10.0, "the cancelled query came back at once, failed");
        EXPECT(!run_ok(b, "SELECT 1 FROM systables WHERE tabid = 1"),
               "the cancelled connection is gone");
        cJSON_Delete(rpc("{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"conn.close\",\"params\":{\"connId\":\"%s\"}}", b));
        EXPECT(open_conn(dsn, b, sizeof b) &&
               strcmp(scalar(b, "SELECT COUNT(*) FROM systables WHERE tabid = 1", buf, sizeof buf),
                      "1") == 0, "a new connection works");
    }

    cJSON_Delete(rpc("{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"conn.close\",\"params\":{\"connId\":\"%s\"}}", a));
    cJSON_Delete(rpc("{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"conn.close\",\"params\":{\"connId\":\"%s\"}}", b));
    dbcore_runtime_reset();
    dbc_plugin_unload(plugin);

    if (failures == 0) {
        printf("OK: informix integration (DRDA)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
