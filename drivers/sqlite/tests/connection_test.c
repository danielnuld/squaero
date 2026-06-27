#include "dbcore/driver.h"

#include <stdio.h>
#include <string.h>

/*
 * DSN parsing and connect/disconnect edge cases for the SQLite driver, driven
 * through the vtable. Every failure path must yield an error-state handle whose
 * last_error is non-empty, then be safely disconnected.
 */

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

/* Assert that `dsn` fails to connect with DBC_ERR_PARAM and reports a reason. */
static void expect_bad_dsn(const dbc_driver_t *drv, const char *dsn,
                           const char *label)
{
    dbc_conn *c = NULL;
    dbc_status st = drv->connect(dsn, &c);
    EXPECT(st == DBC_ERR_PARAM, label);
    if (c != NULL) {
        EXPECT(strlen(drv->last_error(c)) > 0, "bad dsn reports a reason");
        drv->disconnect(c);
    }
}

int main(void)
{
    const dbc_driver_t *drv = dbc_driver_entry();

    /* NULL must not crash (cJSON_Parse(NULL) would strlen a NULL). */
    expect_bad_dsn(drv, NULL, "NULL dsn -> DBC_ERR_PARAM");
    /* Malformed JSON. */
    expect_bad_dsn(drv, "not json", "garbage dsn -> DBC_ERR_PARAM");
    /* Valid JSON, but no path. */
    expect_bad_dsn(drv, "{}", "missing path -> DBC_ERR_PARAM");
    /* path present but not a string. */
    expect_bad_dsn(drv, "{\"path\": 123}", "non-string path -> DBC_ERR_PARAM");

    /* A well-formed in-memory DSN connects and closes cleanly. */
    {
        dbc_conn *c = NULL;
        EXPECT(drv->connect("{\"path\":\":memory:\"}", &c) == DBC_OK, "memory dsn ok");
        EXPECT(c != NULL, "handle returned");
        drv->disconnect(c);
    }

    /* disconnect tolerates NULL. */
    drv->disconnect(NULL);

    if (failures == 0) {
        printf("OK: sqlite connection / DSN (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
