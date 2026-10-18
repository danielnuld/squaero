/*
 * MongoDB cancel integration test: the full cancellation path under real
 * concurrency, as the app drives it. A background thread runs a slow find
 * (a $where that sleeps for every document) through query.run -- which registers
 * it in the op registry -- while the main thread calls op.cancel, reaching the
 * driver's cancel hook from another thread. The hook finds the operation by the
 * `comment` tag the read carries (from a side client) and kills it with killOp.
 *
 * The property under test is the user-facing one: the slow query returns
 * PROMPTLY with an error, instead of running for its full duration, and
 * op.cancel says it canceled. A second pass checks the other half of the
 * contract: with nothing running, op.cancel is a harmless canceled:false.
 *
 * Requires a reachable server PRE-SEEDED like the main test (a `quaero_it`
 * collection with at least two documents) and server-side JavaScript enabled
 * (the default). SKIPS (exit 0) unless QUAERO_MONGODB_DSN is set.
 * MONGODB_PLUGIN_PATH is injected by CMake.
 */
/* nanosleep on the POSIX path needs the feature-test macro under -std=c11. */
#if defined(__APPLE__)
#define _DARWIN_C_SOURCE 1
#else
#define _POSIX_C_SOURCE 199309L
#endif

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

/* The running query's outcome, shared between the query thread and main. */
struct slow_query {
    char   conn_id[32];
    double seconds;     /* wall-clock time the query.run took */
    int    finished;    /* set once the thread returns */
    int    failed;      /* the response was an error */
    char   message[256];
};

/* Background thread body: a find that sleeps 4 s per document (2+ documents). */
static void run_slow_query(struct slow_query *s)
{
    char req[512];
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":100,\"method\":\"query.run\","
             "\"params\":{\"connId\":\"%s\","
             "\"sql\":\"db.quaero_it.find({$where: 'sleep(4000) || true'})\"}}",
             s->conn_id);
    time_t t0 = time(NULL);
    cJSON *root = call(req);
    s->seconds = difftime(time(NULL), t0);
    cJSON *e = root != NULL ? cJSON_GetObjectItem(root, "error") : NULL;
    s->failed = e != NULL;
    if (e != NULL) {
        cJSON *m = cJSON_GetObjectItem(e, "message");
        if (cJSON_IsString(m)) {
            snprintf(s->message, sizeof s->message, "%s", m->valuestring);
        }
    }
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
static void sleep_ms(unsigned ms)
{
    struct timespec ts = { ms / 1000, (long)(ms % 1000) * 1000000L };
    nanosleep(&ts, NULL);
}
#endif

static int cancel_delivered(const char *conn_id)
{
    char req[256];
    snprintf(req, sizeof req,
             "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"op.cancel\","
             "\"params\":{\"connId\":\"%s\"}}",
             conn_id);
    cJSON *root = call(req);
    int yes = cJSON_IsTrue(cJSON_GetObjectItem(cJSON_GetObjectItem(root, "result"), "canceled"));
    cJSON_Delete(root);
    return yes;
}

int main(void)
{
    const char *dsn = getenv("QUAERO_MONGODB_DSN");
    if (dsn == NULL || dsn[0] == '\0') {
        printf("SKIP: QUAERO_MONGODB_DSN not set; MongoDB cancel test skipped\n");
        return 0;
    }

    char err[256];
    dbc_plugin *plugin = NULL;
    dbc_status st = dbc_plugin_load(MONGODB_PLUGIN_PATH, &plugin, err, sizeof err);
    EXPECT(st == DBC_OK, "load the MongoDB plugin");
    if (st != DBC_OK) {
        fprintf(stderr, "could not load %s: %s\n", MONGODB_PLUGIN_PATH, err);
        return 1;
    }
    const dbc_driver_t *drv = dbc_plugin_driver(plugin);
    EXPECT(drv != NULL && (drv->features & DBC_FEAT_CANCEL) != 0,
           "mongodb driver advertises DBC_FEAT_CANCEL");

    dbcore_runtime_reset();
    dbcore_runtime_register_driver(dbcore_runtime_get(), drv);

    struct slow_query s;
    memset(&s, 0, sizeof s);
    {
        char req[1024];
        snprintf(req, sizeof req,
                 "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"conn.open\","
                 "\"params\":{\"driver\":\"mongodb\",\"dsn\":%s}}",
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

    /* Nothing is running: a harmless canceled:false. */
    EXPECT(!cancel_delivered(s.conn_id), "op.cancel with nothing running says canceled:false");

    /* Start the slow find on its own thread, give it time to reach the server,
       then cancel it from this thread. */
#if defined(_WIN32)
    HANDLE th = CreateThread(NULL, 0, thread_entry, &s, 0, NULL);
    EXPECT(th != NULL, "spawn query thread");
#else
    pthread_t th;
    EXPECT(pthread_create(&th, NULL, thread_entry, &s) == 0, "spawn query thread");
#endif

    sleep_ms(800);

    EXPECT(cancel_delivered(s.conn_id), "op.cancel delivered a cancel (canceled:true)");

#if defined(_WIN32)
    WaitForSingleObject(th, INFINITE);
    CloseHandle(th);
#else
    pthread_join(th, NULL);
#endif

    EXPECT(s.finished, "slow query thread returned");
    /* Two documents at 4 s each take ~8 s; a cancel ~1 s in must come back well
       before. */
    EXPECT(s.seconds < 5.0, "canceled query returned promptly, not after its full sleep");
    if (s.seconds >= 5.0) {
        fprintf(stderr, "slow query took %.0fs (expected < 5)\n", s.seconds);
    }
    EXPECT(s.failed, "the canceled query is reported as an error");
    EXPECT(strstr(s.message, "interrupted") != NULL, "the error says the operation was interrupted");
    if (strstr(s.message, "interrupted") == NULL) {
        fprintf(stderr, "error was: %s\n", s.message);
    }

    /* The connection is still good afterwards. */
    {
        char req[256];
        snprintf(req, sizeof req,
                 "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"query.run\","
                 "\"params\":{\"connId\":\"%s\",\"sql\":\"db.quaero_it.countDocuments({})\"}}",
                 s.conn_id);
        cJSON *root = call(req);
        EXPECT(cJSON_GetObjectItem(root, "error") == NULL, "the connection still works after a cancel");
        cJSON_Delete(root);
    }

    {
        char req[256];
        snprintf(req, sizeof req,
                 "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"conn.close\","
                 "\"params\":{\"connId\":\"%s\"}}",
                 s.conn_id);
        cJSON *root = call(req);
        cJSON_Delete(root);
    }

    dbcore_runtime_reset();
    dbc_plugin_unload(plugin);

    if (failures == 0) {
        printf("OK: MongoDB cancel (concurrent op.cancel kills a slow find via killOp)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
