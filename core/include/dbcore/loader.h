#ifndef DBCORE_LOADER_H
#define DBCORE_LOADER_H

/*
 * Dynamic driver loader.
 *
 * Discovers driver plugins (.dll/.so/.dylib) in a directory, loads each with
 * the platform loader (LoadLibrary/dlopen), resolves the DBC_DRIVER_ENTRY_SYMBOL
 * entry point, and validates the returned vtable's ABI (dbc_driver_validate)
 * before handing it to the caller. A malformed or incompatible plugin is
 * reported as an error and skipped — it never crashes the host.
 *
 * Ownership: a loaded dbc_plugin owns its OS library handle and the vtable it
 * exposes. Free it with dbc_plugin_unload(); the dbc_driver_t pointer obtained
 * via dbc_plugin_driver() is invalid afterwards.
 */

#include "dbcore/driver.h"

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* A loaded plugin: an OS library handle plus its validated vtable. Opaque. */
typedef struct dbc_plugin dbc_plugin;

/*
 * True (1) if `filename` looks like a loadable driver for this platform, i.e.
 * its name ends with the platform shared-library extension (.dll on Windows,
 * .dylib on macOS, .so elsewhere). Case-insensitive on Windows. Returns 0 for
 * NULL, empty, or non-matching names. Pure: inspects the string only.
 *
 * Versioned names (e.g. "libfoo.so.3") are intentionally NOT candidates: drivers
 * are deployed under their plain, unversioned name.
 */
int dbc_plugin_is_candidate(const char *filename);

/*
 * Load a single plugin file. On success, *out receives a newly allocated
 * dbc_plugin (free with dbc_plugin_unload) and DBC_OK is returned. On failure,
 * *out is set to NULL and a human-readable reason is written to `errbuf` (when
 * errbuf != NULL and errcap > 0, always NUL-terminated).
 *
 * Returns:
 *   DBC_OK              - loaded and validated.
 *   DBC_ERR_PARAM       - path or out is NULL.
 *   DBC_ERR_CONN        - the OS could not load the library.
 *   DBC_ERR_UNSUPPORTED - the entry symbol is missing, returns NULL, or a
 *                         required vtable member is absent.
 *   DBC_ERR_ABI         - the vtable's abi_version is incompatible.
 *   DBC_ERR_NOMEM       - allocation of the plugin handle failed.
 */
dbc_status dbc_plugin_load(const char *path, dbc_plugin **out,
                           char *errbuf, size_t errcap);

/* The validated vtable of a loaded plugin. Never NULL for a live plugin. */
const dbc_driver_t *dbc_plugin_driver(const dbc_plugin *plugin);

/* Unload a plugin and release its OS handle. NULL is a no-op. */
void dbc_plugin_unload(dbc_plugin *plugin);

/* Called once per successfully loaded plugin during a scan. The plugin is owned
   by the callee (the sink takes ownership and is responsible for unloading). */
typedef void (*dbc_plugin_sink)(dbc_plugin *plugin, void *ctx);

/* Called once per plugin that failed to load during a scan. `path` is the file
   that failed; `message` is a human-readable reason. */
typedef void (*dbc_plugin_error_sink)(const char *path, dbc_status status,
                                      const char *message, void *ctx);

/*
 * Scan `dir` for candidate plugins and attempt to load each. For every success
 * `on_load` is invoked (it takes ownership of the plugin); for every failure
 * `on_error` is invoked (may be NULL to ignore errors). A single bad plugin
 * never aborts the scan. A candidate whose full path is too long to assemble is
 * also reported via `on_error` and skipped, never silently dropped.
 *
 * Returns the number of plugins successfully loaded, or -1 if `dir` itself
 * cannot be opened. The underlying OS reason for a -1 is left in errno
 * (POSIX) / retrievable via GetLastError (Windows); it is not surfaced here.
 */
int dbc_plugin_scan_dir(const char *dir, dbc_plugin_sink on_load,
                        dbc_plugin_error_sink on_error, void *ctx);

#ifdef __cplusplus
}
#endif

#endif /* DBCORE_LOADER_H */
