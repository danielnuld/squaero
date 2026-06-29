#include "dbcore/conn.h"

#include "conn_util.h"
#include "dsn_rewrite.h"
#include "ssh_config.h"
#include "ssh_tunnel.h"

#include <stdlib.h>

/*
 * Connection manager implementation. Open connections are kept in a growable
 * array of slots; ids are handed out from a monotonic counter and never reused,
 * so a stale id can never alias a different connection.
 *
 * A connection may be tunnelled: when the DSN carries ssh_* fields the manager
 * opens an engine-agnostic local port-forward before the driver connects, hands
 * the driver a DSN pointing at the forward's loopback end, and tears the tunnel
 * down after the driver disconnects. The tunnel handle lives in the slot beside
 * the connection so the two share a lifetime.
 */

typedef struct {
    int                 id;       /* 0 == free slot */
    const dbc_driver_t *driver;
    dbc_conn           *handle;
    ssh_tunnel         *tunnel;   /* NULL for a direct (non-tunnelled) connection */
} conn_slot;

struct dbcore_conn_manager {
    conn_slot *slots;
    size_t     cap;       /* allocated slots; live ones have id != 0 */
    int        next_id;
};

dbcore_conn_manager *dbcore_conn_manager_new(void)
{
    dbcore_conn_manager *mgr = calloc(1, sizeof *mgr);
    if (mgr == NULL) {
        return NULL;
    }
    mgr->next_id = 1;
    return mgr;
}

/* Disconnect the driver handle then tear down any tunnel behind it, and mark
   the slot free. Order matters: the driver's socket rides the tunnel, so the
   tunnel must outlive the disconnect. */
static void release_slot(conn_slot *s)
{
    s->driver->disconnect(s->handle);
    ssh_tunnel_close(s->tunnel);
    s->id = 0;
    s->driver = NULL;
    s->handle = NULL;
    s->tunnel = NULL;
}

void dbcore_conn_manager_free(dbcore_conn_manager *mgr)
{
    if (mgr == NULL) {
        return;
    }
    for (size_t i = 0; i < mgr->cap; i++) {
        conn_slot *s = &mgr->slots[i];
        if (s->id != 0) {
            release_slot(s);
        }
    }
    free(mgr->slots);
    free(mgr);
}

/* Return a free slot (reusing a closed one or growing the array), or NULL on
   allocation failure. */
static conn_slot *acquire_slot(dbcore_conn_manager *mgr)
{
    for (size_t i = 0; i < mgr->cap; i++) {
        if (mgr->slots[i].id == 0) {
            return &mgr->slots[i];
        }
    }
    size_t newcap = mgr->cap == 0 ? 4 : mgr->cap * 2;
    conn_slot *grown = realloc(mgr->slots, newcap * sizeof *grown);
    if (grown == NULL) {
        return NULL;
    }
    for (size_t i = mgr->cap; i < newcap; i++) {
        grown[i].id = 0;
        grown[i].driver = NULL;
        grown[i].handle = NULL;
        grown[i].tunnel = NULL;
    }
    mgr->slots = grown;
    conn_slot *slot = &grown[mgr->cap];
    mgr->cap = newcap;
    return slot;
}

dbc_status dbcore_conn_manager_open(dbcore_conn_manager *mgr,
                                    const dbc_driver_t *driver,
                                    const char *dsn_json, int *out_id,
                                    char *errbuf, size_t errcap)
{
    if (errbuf != NULL && errcap > 0) {
        errbuf[0] = '\0';
    }
    if (mgr == NULL || driver == NULL || dsn_json == NULL || out_id == NULL) {
        conn_copy_err(errbuf, errcap, "invalid argument");
        return DBC_ERR_PARAM;
    }
    *out_id = 0;

    /* Engine-agnostic SSH tunnel: if the DSN asks for one, stand up a local
       port-forward and rewrite the DSN so the driver dials its loopback end. */
    ssh_config ssh = {0};
    dbc_status sst = ssh_config_parse(dsn_json, &ssh, errbuf, errcap);
    if (sst != DBC_OK) {
        return sst;
    }

    ssh_tunnel *tunnel = NULL;
    char *rewritten = NULL;
    const char *effective_dsn = dsn_json;
    if (ssh.present) {
        int local_port = 0;
        dbc_status tst =
            ssh_tunnel_open(&ssh, &tunnel, &local_port, errbuf, errcap);
        if (tst != DBC_OK) {
            ssh_config_dispose(&ssh);
            return tst;
        }
        rewritten = dsn_rewrite_loopback(dsn_json, local_port);
        if (rewritten == NULL) {
            conn_copy_err(errbuf, errcap, "could not rewrite dsn for ssh tunnel");
            ssh_tunnel_close(tunnel);
            ssh_config_dispose(&ssh);
            return DBC_ERR_NOMEM;
        }
        effective_dsn = rewritten;
    }
    /* ssh_tunnel_open has captured whatever it needs; the parsed config (which
       holds the credential strings) is no longer required. */
    ssh_config_dispose(&ssh);

    dbc_conn *handle = NULL;
    dbc_status st = driver->connect(effective_dsn, &handle);
    free(rewritten);
    if (st != DBC_OK) {
        /* A driver may expose the reason through last_error on the (error-state)
           handle it returned; capture it before tearing the handle down. */
        if (handle != NULL) {
            conn_copy_err(errbuf, errcap, driver->last_error(handle));
            driver->disconnect(handle);
        } else {
            conn_copy_err(errbuf, errcap, "could not connect");
        }
        ssh_tunnel_close(tunnel);
        return st;
    }
    if (handle == NULL) {
        /* Contract violation: success must yield a handle. */
        conn_copy_err(errbuf, errcap, "driver reported success but returned no handle");
        ssh_tunnel_close(tunnel);
        return DBC_ERR_PARAM;
    }

    conn_slot *slot = acquire_slot(mgr);
    if (slot == NULL) {
        conn_copy_err(errbuf, errcap, "out of memory");
        driver->disconnect(handle);
        ssh_tunnel_close(tunnel);
        return DBC_ERR_NOMEM;
    }

    slot->id = mgr->next_id++;
    slot->driver = driver;
    slot->handle = handle;
    slot->tunnel = tunnel;
    *out_id = slot->id;
    return DBC_OK;
}

static conn_slot *find_slot(const dbcore_conn_manager *mgr, int id)
{
    if (mgr == NULL || id <= 0) {
        return NULL;
    }
    for (size_t i = 0; i < mgr->cap; i++) {
        if (mgr->slots[i].id == id) {
            return &mgr->slots[i];
        }
    }
    return NULL;
}

dbc_status dbcore_conn_manager_close(dbcore_conn_manager *mgr, int id)
{
    conn_slot *slot = find_slot(mgr, id);
    if (slot == NULL) {
        return DBC_ERR_PARAM;
    }
    release_slot(slot);
    return DBC_OK;
}

int dbcore_conn_manager_get(const dbcore_conn_manager *mgr, int id,
                            dbcore_conn_ref *out)
{
    conn_slot *slot = find_slot(mgr, id);
    if (slot == NULL || out == NULL) {
        return 0;
    }
    out->driver = slot->driver;
    out->handle = slot->handle;
    return 1;
}

int dbcore_conn_manager_count(const dbcore_conn_manager *mgr)
{
    if (mgr == NULL) {
        return 0;
    }
    int n = 0;
    for (size_t i = 0; i < mgr->cap; i++) {
        if (mgr->slots[i].id != 0) {
            n++;
        }
    }
    return n;
}
