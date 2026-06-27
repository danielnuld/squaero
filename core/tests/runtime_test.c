#include "dbcore/runtime.h"

#include <stdio.h>

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

/* The registry only inspects driver->name, so minimal named vtables suffice. */
static dbc_driver_t named(const char *name)
{
    dbc_driver_t d = {0};
    d.abi_version = DBC_ABI_VERSION;
    d.name = name;
    return d;
}

int main(void)
{
    dbcore_runtime_reset();  /* isolate from any prior global state */

    dbcore_runtime *rt = dbcore_runtime_get();
    EXPECT(rt != NULL, "runtime is created");
    EXPECT(dbcore_runtime_get() == rt, "runtime is a stable singleton");
    EXPECT(dbcore_runtime_driver_count(rt) == 0, "no drivers initially");
    EXPECT(dbcore_runtime_conns(rt) != NULL, "connection manager exists");

    dbc_driver_t a = named("alpha");
    dbc_driver_t b = named("beta");
    dbc_driver_t a2 = named("alpha");  /* same name, different vtable */

    EXPECT(dbcore_runtime_register_driver(rt, &a) == DBC_OK, "register alpha");
    EXPECT(dbcore_runtime_register_driver(rt, &b) == DBC_OK, "register beta");
    EXPECT(dbcore_runtime_driver_count(rt) == 2, "two drivers");
    EXPECT(dbcore_runtime_find_driver(rt, "alpha") == &a, "find alpha");
    EXPECT(dbcore_runtime_find_driver(rt, "beta") == &b, "find beta");
    EXPECT(dbcore_runtime_find_driver(rt, "gamma") == NULL, "unknown driver is NULL");

    /* Re-registering a name replaces the entry without growing the count. */
    EXPECT(dbcore_runtime_register_driver(rt, &a2) == DBC_OK, "re-register alpha");
    EXPECT(dbcore_runtime_driver_count(rt) == 2, "count unchanged on replace");
    EXPECT(dbcore_runtime_find_driver(rt, "alpha") == &a2, "alpha now resolves to the new vtable");

    /* Bad arguments. */
    dbc_driver_t unnamed = named(NULL);
    EXPECT(dbcore_runtime_register_driver(rt, NULL) == DBC_ERR_PARAM, "NULL driver rejected");
    EXPECT(dbcore_runtime_register_driver(rt, &unnamed) == DBC_ERR_PARAM, "unnamed driver rejected");
    EXPECT(dbcore_runtime_find_driver(rt, NULL) == NULL, "find(NULL) is NULL");

    /* Reset clears everything. */
    dbcore_runtime_reset();
    rt = dbcore_runtime_get();
    EXPECT(dbcore_runtime_driver_count(rt) == 0, "reset clears drivers");

    if (failures == 0) {
        printf("OK: runtime (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
