#include "dbcore/conn.h"

#include "ssh_tunnel.h"  /* ssh_tunnel_available: gates the tunnel-path assertions */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* The driver owns dbc_conn; the stub gives it a trivial concrete shape. */
struct dbc_conn { int tag; };

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

/* --- call counters, shared by the stub drivers --- */
static int g_connects = 0;
static int g_disconnects = 0;
static int g_live = 0;

/* --- trivial required members reused by every stub vtable --- */
static dbc_status  s_query(dbc_conn *c, const char *s, dbc_result **o) { (void)c; (void)s; (void)o; return DBC_OK; }
static void        s_free_result(dbc_result *r) { (void)r; }
static int         s_col_count(dbc_result *r) { (void)r; return 0; }
static const char *s_col_name(dbc_result *r, int c) { (void)r; (void)c; return ""; }
static dbc_type    s_col_type(dbc_result *r, int c) { (void)r; (void)c; return DBC_TYPE_NULL; }
static int         s_next_row(dbc_result *r) { (void)r; return 0; }
static const char *s_cell_text(dbc_result *r, int c) { (void)r; (void)c; return NULL; }
static long long   s_rows_affected(dbc_result *r) { (void)r; return 0; }

/* --- success driver: allocates and tracks a live handle --- */
static dbc_status ok_connect(const char *dsn, dbc_conn **out)
{
    (void)dsn;
    g_connects++;
    dbc_conn *c = malloc(sizeof *c);
    if (c == NULL) { return DBC_ERR_CONN; }
    c->tag = 1;
    *out = c;
    g_live++;
    return DBC_OK;
}
static void ok_disconnect(dbc_conn *c)
{
    if (c != NULL) { free(c); g_disconnects++; g_live--; }
}
static const char *ok_last_error(dbc_conn *c) { (void)c; return ""; }

/* --- failure driver that returns an error-state handle for last_error --- */
static dbc_conn g_err_handle = {0};
static dbc_status fail_connect_h(const char *dsn, dbc_conn **out)
{
    (void)dsn;
    *out = &g_err_handle;  /* not heap: disconnect must not free it */
    return DBC_ERR_CONN;
}
static void fail_disconnect(dbc_conn *c) { (void)c; g_disconnects++; }
static const char *fail_last_error(dbc_conn *c) { (void)c; return "connection refused"; }

/* --- failure driver that yields no handle at all --- */
static dbc_status fail_connect_n(const char *dsn, dbc_conn **out)
{
    (void)dsn;
    *out = NULL;
    return DBC_ERR_CONN;
}

static dbc_driver_t base_driver(void)
{
    dbc_driver_t d = {0};
    d.abi_version   = DBC_ABI_VERSION;
    d.name          = "stub";
    d.display_name  = "Stub";
    d.connect       = ok_connect;
    d.disconnect    = ok_disconnect;
    d.last_error    = ok_last_error;
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

int main(void)
{
    dbc_driver_t ok = base_driver();
    char err[256];

    dbcore_conn_manager *mgr = dbcore_conn_manager_new();
    EXPECT(mgr != NULL, "manager allocates");
    EXPECT(dbcore_conn_manager_count(mgr) == 0, "starts empty");

    /* Open two connections; ids are monotonic. */
    int id1 = 0, id2 = 0;
    EXPECT(dbcore_conn_manager_open(mgr, &ok, "{}", &id1, err, sizeof err) == DBC_OK, "open 1");
    EXPECT(id1 == 1, "first id is 1");
    EXPECT(dbcore_conn_manager_open(mgr, &ok, "{}", &id2, err, sizeof err) == DBC_OK, "open 2");
    EXPECT(id2 == 2, "second id is 2");
    EXPECT(dbcore_conn_manager_count(mgr) == 2, "two open");
    EXPECT(g_live == 2, "two live handles");

    /* Borrow a live connection. */
    dbcore_conn_ref ref = {0};
    EXPECT(dbcore_conn_manager_get(mgr, id1, &ref) == 1, "get known id");
    EXPECT(ref.driver == &ok && ref.handle != NULL, "ref points at the handle");
    EXPECT(dbcore_conn_manager_get(mgr, 999, &ref) == 0, "get unknown id");
    EXPECT(dbcore_conn_manager_get(mgr, id1, NULL) == 0, "get with NULL out");

    /* Close one; the slot frees and the id is never reused. */
    EXPECT(dbcore_conn_manager_close(mgr, id1) == DBC_OK, "close 1");
    EXPECT(dbcore_conn_manager_count(mgr) == 1, "one open after close");
    EXPECT(dbcore_conn_manager_get(mgr, id1, &ref) == 0, "closed id is gone");
    int id3 = 0;
    EXPECT(dbcore_conn_manager_open(mgr, &ok, "{}", &id3, err, sizeof err) == DBC_OK, "open 3");
    EXPECT(id3 == 3, "ids are never reused");

    /* Error paths. */
    EXPECT(dbcore_conn_manager_close(mgr, 999) == DBC_ERR_PARAM, "close unknown is PARAM");
    int idx = 0;
    EXPECT(dbcore_conn_manager_open(NULL, &ok, "{}", &idx, err, sizeof err) == DBC_ERR_PARAM, "NULL mgr");
    EXPECT(dbcore_conn_manager_open(mgr, NULL, "{}", &idx, err, sizeof err) == DBC_ERR_PARAM, "NULL driver");
    EXPECT(dbcore_conn_manager_open(mgr, &ok, NULL, &idx, err, sizeof err) == DBC_ERR_PARAM, "NULL dsn");

    /* Failed connect with an error-state handle: last_error is captured and the
       handle is disconnected. */
    {
        dbc_driver_t fail = base_driver();
        fail.connect = fail_connect_h;
        fail.disconnect = fail_disconnect;
        fail.last_error = fail_last_error;
        int before = g_disconnects;
        int fid = -1;
        dbc_status st = dbcore_conn_manager_open(mgr, &fail, "{}", &fid, err, sizeof err);
        EXPECT(st == DBC_ERR_CONN, "failed connect returns driver status");
        EXPECT(fid == 0, "failed connect yields id 0");
        EXPECT(strcmp(err, "connection refused") == 0, "last_error is propagated");
        EXPECT(g_disconnects == before + 1, "error-state handle is disconnected");
        EXPECT(dbcore_conn_manager_count(mgr) == 2, "failed open does not register");
    }

    /* Failed connect with no handle: a generic message is reported. */
    {
        dbc_driver_t fail = base_driver();
        fail.connect = fail_connect_n;
        int fid = -1;
        dbc_status st = dbcore_conn_manager_open(mgr, &fail, "{}", &fid, err, sizeof err);
        EXPECT(st == DBC_ERR_CONN, "handle-less failure returns status");
        EXPECT(strcmp(err, "could not connect") == 0, "generic message when no handle");
    }

    /* SSH-tunnelled DSN. When tunnel support is not compiled in (the default),
       open fails with an explicit unsupported error, calls neither the tunnel
       nor the driver, and registers nothing — honest failure, not a silent
       direct connection past the intended SSH hop. */
    {
        const char *dsn = "{\"host\":\"db\",\"port\":3306,"
                          "\"ssh_host\":\"bastion\",\"ssh_user\":\"u\"}";
        int sid = -1;
        int connects_before = g_connects;
        int count_before = dbcore_conn_manager_count(mgr);
        dbc_status st =
            dbcore_conn_manager_open(mgr, &ok, dsn, &sid, err, sizeof err);
        if (ssh_tunnel_available()) {
            /* Built: a unit test can't reach a real SSH server (bastion:22), so
               we don't assert a specific status — but open()'s core invariant
               must hold either way: an id is handed out IFF the open succeeded. */
            if (st == DBC_OK) {
                EXPECT(sid > 0, "successful tunnelled open yields a live id");
            } else {
                EXPECT(sid == 0, "failed tunnelled open yields id 0");
            }
        } else {
            EXPECT(st == DBC_ERR_UNSUPPORTED, "tunnel not built => unsupported");
            EXPECT(sid == 0, "unsupported open yields id 0");
            EXPECT(g_connects == connects_before, "driver connect not called");
            EXPECT(dbcore_conn_manager_count(mgr) == count_before,
                   "unsupported open registers nothing");
            EXPECT(err[0] != '\0', "unsupported open reports a reason");
        }
    }

    /* A malformed ssh config (ssh_host present, ssh_user missing) is rejected as
       a parameter error before any connect attempt. */
    {
        int sid = -1;
        int connects_before = g_connects;
        dbc_status st = dbcore_conn_manager_open(
            mgr, &ok, "{\"ssh_host\":\"bastion\"}", &sid, err, sizeof err);
        EXPECT(st == DBC_ERR_PARAM, "bad ssh config => PARAM");
        EXPECT(g_connects == connects_before, "bad ssh config skips connect");
    }

    /* Freeing the manager closes everything still open. */
    int live_before = g_live;
    EXPECT(live_before == 2, "two handles still live before free");
    dbcore_conn_manager_free(mgr);
    EXPECT(g_live == 0, "free closes all remaining connections");

    if (failures == 0) {
        printf("OK: connection manager (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
