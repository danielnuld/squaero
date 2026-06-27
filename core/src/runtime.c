#include "dbcore/runtime.h"

#include <stdlib.h>
#include <string.h>

struct dbcore_runtime {
    const dbc_driver_t **drivers;  /* borrowed vtables, indexed by registration */
    size_t               driver_count;
    size_t               driver_cap;
    dbcore_conn_manager *conns;
};

static dbcore_runtime *g_runtime = NULL;

static dbcore_runtime *runtime_new(void)
{
    dbcore_runtime *rt = calloc(1, sizeof *rt);
    if (rt == NULL) {
        return NULL;
    }
    rt->conns = dbcore_conn_manager_new();
    if (rt->conns == NULL) {
        free(rt);
        return NULL;
    }
    return rt;
}

static void runtime_free(dbcore_runtime *rt)
{
    if (rt == NULL) {
        return;
    }
    dbcore_conn_manager_free(rt->conns);
    free(rt->drivers);
    free(rt);
}

dbcore_runtime *dbcore_runtime_get(void)
{
    if (g_runtime == NULL) {
        g_runtime = runtime_new();
    }
    return g_runtime;
}

void dbcore_runtime_reset(void)
{
    runtime_free(g_runtime);
    g_runtime = NULL;
}

dbc_status dbcore_runtime_register_driver(dbcore_runtime *rt,
                                          const dbc_driver_t *driver)
{
    if (rt == NULL || driver == NULL || driver->name == NULL) {
        return DBC_ERR_PARAM;
    }

    /* Replace an existing registration with the same name. */
    for (size_t i = 0; i < rt->driver_count; i++) {
        if (strcmp(rt->drivers[i]->name, driver->name) == 0) {
            rt->drivers[i] = driver;
            return DBC_OK;
        }
    }

    if (rt->driver_count == rt->driver_cap) {
        size_t newcap = rt->driver_cap == 0 ? 4 : rt->driver_cap * 2;
        const dbc_driver_t **grown =
            realloc(rt->drivers, newcap * sizeof *grown);
        if (grown == NULL) {
            return DBC_ERR_NOMEM;
        }
        rt->drivers = grown;
        rt->driver_cap = newcap;
    }
    rt->drivers[rt->driver_count++] = driver;
    return DBC_OK;
}

const dbc_driver_t *dbcore_runtime_find_driver(const dbcore_runtime *rt,
                                               const char *name)
{
    if (rt == NULL || name == NULL) {
        return NULL;
    }
    for (size_t i = 0; i < rt->driver_count; i++) {
        if (strcmp(rt->drivers[i]->name, name) == 0) {
            return rt->drivers[i];
        }
    }
    return NULL;
}

int dbcore_runtime_driver_count(const dbcore_runtime *rt)
{
    return rt != NULL ? (int)rt->driver_count : 0;
}

dbcore_conn_manager *dbcore_runtime_conns(dbcore_runtime *rt)
{
    return rt != NULL ? rt->conns : NULL;
}
