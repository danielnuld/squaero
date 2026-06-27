#include "dbcore/loader.h"

#include <stdio.h>
#include <string.h>

/*
 * Smoke test for the dynamic loader against real fixture plugins built by CMake.
 * Paths are injected as compile definitions:
 *   GOOD_DRIVER_PATH, BAD_ABI_DRIVER_PATH, NO_ENTRY_PATH, FIXTURES_DIR
 */

static int failures = 0;

#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

/* Scan accounting. */
struct scan_acc {
    int loaded;
    int errors;
    int abi_errors;
};

static void on_load(dbc_plugin *p, void *ctx)
{
    struct scan_acc *acc = ctx;
    acc->loaded++;
    EXPECT(dbc_plugin_driver(p) != NULL, "scanned plugin exposes a vtable");
    dbc_plugin_unload(p);  /* this test owns and releases the plugin */
}

static void on_error(const char *path, dbc_status st, const char *msg, void *ctx)
{
    struct scan_acc *acc = ctx;
    (void)path;
    acc->errors++;
    if (st == DBC_ERR_ABI) {
        acc->abi_errors++;
    }
    EXPECT(msg != NULL && msg[0] != '\0', "scan error carries a message");
}

int main(void)
{
    char err[256];

    /* 1. A valid plugin loads, validates, and exposes its vtable. */
    {
        dbc_plugin *p = NULL;
        dbc_status st = dbc_plugin_load(GOOD_DRIVER_PATH, &p, err, sizeof err);
        EXPECT(st == DBC_OK, "good driver loads with DBC_OK");
        EXPECT(p != NULL, "good driver yields a plugin");
        if (p != NULL) {
            const dbc_driver_t *d = dbc_plugin_driver(p);
            EXPECT(d != NULL, "good driver exposes a vtable");
            EXPECT(d != NULL && strcmp(d->name, "fixture") == 0,
                   "good driver reports its name");
            dbc_plugin_unload(p);
        }
    }

    /* 2. An ABI-incompatible plugin is rejected, library not retained. */
    {
        dbc_plugin *p = NULL;
        dbc_status st = dbc_plugin_load(BAD_ABI_DRIVER_PATH, &p, err, sizeof err);
        EXPECT(st == DBC_ERR_ABI, "bad-ABI driver is rejected with DBC_ERR_ABI");
        EXPECT(p == NULL, "rejected driver yields no plugin");
        EXPECT(err[0] != '\0', "rejected driver reports a reason");
    }

    /* 3. A library missing the entry symbol fails cleanly. */
    {
        dbc_plugin *p = NULL;
        dbc_status st = dbc_plugin_load(NO_ENTRY_PATH, &p, err, sizeof err);
        EXPECT(st == DBC_ERR_UNSUPPORTED, "missing entry is DBC_ERR_UNSUPPORTED");
        EXPECT(p == NULL, "no-entry library yields no plugin");
    }

    /* 4. A nonexistent path fails without crashing. */
    {
        dbc_plugin *p = NULL;
        dbc_status st = dbc_plugin_load("does-not-exist-xyz.bin", &p, err, sizeof err);
        EXPECT(st == DBC_ERR_CONN, "missing file is DBC_ERR_CONN");
        EXPECT(p == NULL, "missing file yields no plugin");
    }

    /* 5. NULL arguments are rejected. */
    {
        dbc_plugin *p = NULL;
        EXPECT(dbc_plugin_load(NULL, &p, err, sizeof err) == DBC_ERR_PARAM,
               "NULL path is DBC_ERR_PARAM");
        EXPECT(dbc_plugin_load(GOOD_DRIVER_PATH, NULL, err, sizeof err) == DBC_ERR_PARAM,
               "NULL out is DBC_ERR_PARAM");
    }

    /* 6. Scanning the fixtures directory loads the good plugin and reports the
          bad ones as errors — without aborting the scan. */
    {
        struct scan_acc acc = {0, 0, 0};
        int n = dbc_plugin_scan_dir(FIXTURES_DIR, on_load, on_error, &acc);
        EXPECT(n >= 1, "scan loads at least the good driver");
        EXPECT(acc.loaded == n, "scan return count matches on_load calls");
        EXPECT(acc.errors >= 1, "scan reports the bad fixtures as errors");
        EXPECT(acc.abi_errors >= 1, "scan flags the bad-ABI fixture");
    }

    /* 7. Scanning a nonexistent directory returns -1. */
    EXPECT(dbc_plugin_scan_dir("no-such-dir-xyz", on_load, on_error, NULL) == -1,
           "scanning a missing directory returns -1");

    /* 8. Handle accessors tolerate NULL. */
    EXPECT(dbc_plugin_driver(NULL) == NULL, "driver(NULL) is NULL");
    dbc_plugin_unload(NULL);  /* must not crash */

    if (failures == 0) {
        printf("OK: dynamic loader (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
