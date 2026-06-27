#include "dbcore/conn.h"

#include <stdlib.h>
#include <string.h>

/*
 * Connection manager implementation. Open connections are kept in a growable
 * array of slots; ids are handed out from a monotonic counter and never reused,
 * so a stale id can never alias a different connection.
 */

typedef struct {
    int                 id;       /* 0 == free slot */
    const dbc_driver_t *driver;
    dbc_conn           *handle;
} conn_slot;

struct dbcore_conn_manager {
    conn_slot *slots;
    size_t     cap;       /* allocated slots; live ones have id != 0 */
    int        next_id;
};

static void copy_msg(char *errbuf, size_t errcap, const char *msg)
{
    if (errbuf == NULL || errcap == 0) {
        return;
    }
    if (msg == NULL) {
        msg = "unknown error";
    }
    size_t n = strlen(msg);
    if (n >= errcap) {
        n = errcap - 1;
    }
    memcpy(errbuf, msg, n);
    errbuf[n] = '\0';
}

dbcore_conn_manager *dbcore_conn_manager_new(void)
{
    dbcore_conn_manager *mgr = calloc(1, sizeof *mgr);
    if (mgr == NULL) {
        return NULL;
    }
    mgr->next_id = 1;
    return mgr;
}

void dbcore_conn_manager_free(dbcore_conn_manager *mgr)
{
    if (mgr == NULL) {
        return;
    }
    for (size_t i = 0; i < mgr->cap; i++) {
        conn_slot *s = &mgr->slots[i];
        if (s->id != 0) {
            s->driver->disconnect(s->handle);
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
        copy_msg(errbuf, errcap, "invalid argument");
        return DBC_ERR_PARAM;
    }
    *out_id = 0;

    dbc_conn *handle = NULL;
    dbc_status st = driver->connect(dsn_json, &handle);
    if (st != DBC_OK) {
        /* A driver may expose the reason through last_error on the (error-state)
           handle it returned; capture it before tearing the handle down. */
        if (handle != NULL) {
            copy_msg(errbuf, errcap, driver->last_error(handle));
            driver->disconnect(handle);
        } else {
            copy_msg(errbuf, errcap, "could not connect");
        }
        return st;
    }
    if (handle == NULL) {
        /* Contract violation: success must yield a handle. */
        copy_msg(errbuf, errcap, "driver reported success but returned no handle");
        return DBC_ERR_PARAM;
    }

    conn_slot *slot = acquire_slot(mgr);
    if (slot == NULL) {
        copy_msg(errbuf, errcap, "out of memory");
        driver->disconnect(handle);
        return DBC_ERR_NOMEM;
    }

    slot->id = mgr->next_id++;
    slot->driver = driver;
    slot->handle = handle;
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
    slot->driver->disconnect(slot->handle);
    slot->id = 0;
    slot->driver = NULL;
    slot->handle = NULL;
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
