/*
 * MongoDB cancel contract: locks in the honest decision that the driver does
 * NOT advertise query cancellation. The mongo-c-driver has no thread-safe way to
 * interrupt an in-flight operation (a mongoc_client_t is single-threaded, and
 * killOp needs admin privileges plus racy opid discovery), so faking the
 * capability would violate the project's honesty rule. This test loads the real
 * plugin and asserts the absence — it needs no server (no DSN, no query), only
 * the built driver, so it always runs when the driver is present.
 *
 * MONGODB_PLUGIN_PATH is injected by CMake as the built plugin's full path.
 */
#include "dbcore/loader.h"

#include <stdio.h>
#include <string.h>

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

int main(void)
{
    char err[256];
    dbc_plugin *plugin = NULL;
    dbc_status st = dbc_plugin_load(MONGODB_PLUGIN_PATH, &plugin, err, sizeof err);
    EXPECT(st == DBC_OK, "load the MongoDB plugin");
    if (st != DBC_OK) {
        fprintf(stderr, "could not load %s: %s\n", MONGODB_PLUGIN_PATH, err);
        return 1;
    }
    const dbc_driver_t *drv = dbc_plugin_driver(plugin);
    EXPECT(drv != NULL && strcmp(drv->name, "mongodb") == 0, "driver is mongodb");

    /* The honest contract: cancellation is not backed, so it is not advertised. */
    EXPECT((drv->features & DBC_FEAT_CANCEL) == 0,
           "mongodb does NOT advertise DBC_FEAT_CANCEL");
    EXPECT(drv->cancel == NULL, "mongodb leaves the cancel hook NULL");

    dbc_plugin_unload(plugin);

    if (failures == 0) {
        printf("OK: mongodb cancel contract (honestly unsupported)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
