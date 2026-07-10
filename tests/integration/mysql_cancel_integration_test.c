/*
 * MySQL cancel integration test: the full cancellation path under real
 * concurrency, exactly as the app drives it. A background thread runs a slow
 * query (SELECT SLEEP) through query.run — which registers it in the op registry
 * — while the main thread calls op.cancel, reaching the driver's cancel hook
 * (KILL QUERY over a side connection) on another thread. The property under test
 * is the user-facing one: the slow query returns PROMPTLY instead of hanging for
 * its full duration.
 *
 * Requires a reachable server; SKIPS (exit 0) unless QUAERO_MYSQL_DSN is set.
 * MYSQL_PLUGIN_PATH is injected by CMake as the built plugin's full path.
 */
#include "dbcore/ipc.h"
#include "dbcore/loader.h"
#include "dbcore/runtime.h"

#include "cJSON.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#if defined(_WIN32)
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
#else
#  include <pthread.h>
#  include <unistd.h>
#endif

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

static cJSON *call(const char *request)
{
    char *resp = dbcore_ipc_handle(request);
    cJSON *root = cJSON_Parse(resp);
    dbcore_ipc_free(resp);
    return root;
}

/* Shared between the query thread and main: the running query's outcome. */
struct slow_query {
    char   conn_id[32];
    double seconds;   /* wall-clock time the query.run took */
    int    finished;  /* set once the thread returns */
};

/* Background thread body: run a 10s sleep query and record how long it took. */
static void run_slow_query(struct slow_query *s)
{
    char req[512];
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":100,\"method\":\"query.run\","
             "\"params\":{\"connId\":\"%s\",\"sql\":\"SELECT SLEEP(10)\"}}",
             s->conn_id);
    time_t t0 = time(NULL);
    cJSON *root = call(req);
    s->seconds = difftime(time(NULL), t0);
    cJSON_Delete(root);
    s->finished = 1;
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
static void sleep_ms(unsigned ms) { usleep(ms * 1000); }
#endif

int main(void)
{
    const char *dsn = getenv("QUAERO_MYSQL_DSN");
    if (dsn == NULL || dsn[0] == '\0') {
        printf("SKIP: QUAERO_MYSQL_DSN not set; MySQL cancel test skipped\n");
        return 0;
    }

    char err[256];
    dbc_plugin *plugin = NULL;
    dbc_status st = dbc_plugin_load(MYSQL_PLUGIN_PATH, &plugin, err, sizeof err);
    EXPECT(st == DBC_OK, "load the MySQL plugin");
    if (st != DBC_OK) {
        fprintf(stderr, "could not load %s: %s\n", MYSQL_PLUGIN_PATH, err);
        return 1;
    }
    const dbc_driver_t *drv = dbc_plugin_driver(plugin);
    EXPECT(drv != NULL && (drv->features & DBC_FEAT_CANCEL) != 0,
           "mysql driver advertises DBC_FEAT_CANCEL");

    dbcore_runtime_reset();
    dbcore_runtime_register_driver(dbcore_runtime_get(), drv);

    struct slow_query s = {{0}, 0.0, 0};
    {
        char req[1024];
        snprintf(req, sizeof req,
                 "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"conn.open\","
                 "\"params\":{\"driver\":\"mysql\",\"dsn\":%s}}",
                 dsn);
        cJSON *root = call(req);
        cJSON *cid = cJSON_GetObjectItem(cJSON_GetObjectItem(root, "result"), "connId");
        EXPECT(cJSON_IsString(cid), "conn.open returns a connId");
        if (cJSON_IsString(cid)) {
            snprintf(s.conn_id, sizeof s.conn_id, "%s", cid->valuestring);
        }
        cJSON_Delete(root);
    }
    if (s.conn_id[0] == '\0') {
        fprintf(stderr, "FAIL: no connId; aborting\n");
        dbcore_runtime_reset();
        dbc_plugin_unload(plugin);
        return 1;
    }

    /* Start the slow query on its own thread, give it time to actually reach the
       server, then cancel it from this thread. */
#if defined(_WIN32)
    HANDLE th = CreateThread(NULL, 0, thread_entry, &s, 0, NULL);
    EXPECT(th != NULL, "spawn query thread");
#else
    pthread_t th;
    EXPECT(pthread_create(&th, NULL, thread_entry, &s) == 0, "spawn query thread");
#endif

    sleep_ms(700);  /* let SELECT SLEEP(10) start running on the server */

    {
        char req[256];
        snprintf(req, sizeof req,
                 "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"op.cancel\","
                 "\"params\":{\"connId\":\"%s\"}}",
                 s.conn_id);
        cJSON *root = call(req);
        cJSON *canceled = cJSON_GetObjectItem(cJSON_GetObjectItem(root, "result"),
                                              "canceled");
        EXPECT(cJSON_IsTrue(canceled), "op.cancel delivered a cancel (canceled:true)");
        cJSON_Delete(root);
    }

#if defined(_WIN32)
    WaitForSingleObject(th, INFINITE);
    CloseHandle(th);
#else
    pthread_join(th, NULL);
#endif

    EXPECT(s.finished, "slow query thread returned");
    /* The heart of the test: a 10s query, canceled ~0.7s in, must come back well
       before its natural end. A generous 5s bound tolerates scheduling jitter
       while still failing loudly if the cancel did nothing. */
    EXPECT(s.seconds < 5.0, "canceled query returned promptly, not after its full sleep");
    if (s.seconds >= 5.0) {
        fprintf(stderr, "slow query took %.0fs (expected < 5)\n", s.seconds);
    }

    {
        char req[256];
        snprintf(req, sizeof req,
                 "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"conn.close\","
                 "\"params\":{\"connId\":\"%s\"}}",
                 s.conn_id);
        cJSON *root = call(req);
        cJSON_Delete(root);
    }

    dbcore_runtime_reset();
    dbc_plugin_unload(plugin);

    if (failures == 0) {
        printf("OK: MySQL cancel (concurrent op.cancel interrupts a slow query)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
