#ifndef DBCORE_RUNTIME_H
#define DBCORE_RUNTIME_H

/*
 * Process runtime — the core's single mutable state holder: the registry of
 * available driver vtables plus the live connection manager.
 *
 * The IPC method handlers are stateless functions (see core/src/ipc), so they
 * reach connections and drivers through the process-global instance returned by
 * dbcore_runtime_get(). The app shell registers loaded drivers (issue #7) into
 * this registry at startup; tests register stub drivers and call
 * dbcore_runtime_reset() to isolate cases.
 *
 * Single-threaded, like the rest of the core.
 */

#include "dbcore/conn.h"
#include "dbcore/driver.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct dbcore_runtime dbcore_runtime;

/* The process-global runtime, lazily created. NULL only on allocation failure. */
dbcore_runtime *dbcore_runtime_get(void);

/* Tear down and recreate the global runtime (closing all connections). Intended
   for test isolation; the app does not need to call it. */
void dbcore_runtime_reset(void);

/*
 * Register a driver vtable under its driver->name. The vtable is borrowed: the
 * caller (the plugin loader / app) keeps it alive for the runtime's lifetime.
 * Re-registering the same name replaces the previous entry.
 *
 * Returns DBC_OK, DBC_ERR_PARAM (NULL args / unnamed driver), or DBC_ERR_NOMEM.
 */
dbc_status dbcore_runtime_register_driver(dbcore_runtime *rt,
                                          const dbc_driver_t *driver);

/* Look up a registered driver by name, or NULL if none matches. */
const dbc_driver_t *dbcore_runtime_find_driver(const dbcore_runtime *rt,
                                               const char *name);

/* Number of registered drivers. */
int dbcore_runtime_driver_count(const dbcore_runtime *rt);

/* The runtime's connection manager (never NULL for a live runtime). */
dbcore_conn_manager *dbcore_runtime_conns(dbcore_runtime *rt);

#ifdef __cplusplus
}
#endif

#endif /* DBCORE_RUNTIME_H */
