/* Static driver registry (issue #573): every driver this configuration linked
   registers under its own name, and the dispatcher answers app.hello with
   them in place — the same boot an iOS app does, without dlopen. */
#include "static_drivers.h"

#include "dbcore/ipc.h"

#include "cJSON.h"

#include <stdio.h>
#include <string.h>

static int g_failures = 0;

#define CHECK(cond, msg)                                            \
    do {                                                            \
        if (!(cond)) {                                              \
            fprintf(stderr, "FAIL: %s (%s:%d)\n", (msg),           \
                    __FILE__, __LINE__);                            \
            g_failures++;                                           \
        }                                                           \
    } while (0)

static void test_registers_every_linked_driver(void)
{
    dbcore_runtime_reset();
    dbcore_runtime *rt = dbcore_runtime_get();

    char names[] = QUAERO_STATIC_DRIVER_NAMES;
    int expected = 0;
    int n = quaero_register_static_drivers(rt);

    for (char *name = names; name != NULL; ) {
        char *comma = strchr(name, ',');
        if (comma != NULL) {
            *comma = '\0';
        }
        expected++;
        if (dbcore_runtime_find_driver(rt, name) == NULL) {
            fprintf(stderr, "FAIL: driver '%s' not registered\n", name);
            g_failures++;
        }
        name = comma != NULL ? comma + 1 : NULL;
    }
    CHECK(n == expected, "every linked driver registers");
    CHECK(dbcore_runtime_driver_count(rt) == expected, "registry holds them all");
    CHECK(dbcore_runtime_find_driver(rt, "sqlite") != NULL, "sqlite is always in");
    CHECK(quaero_register_static_drivers(NULL) == -1, "NULL runtime is rejected");
}

static void test_app_hello(void)
{
    char *raw = dbcore_ipc_handle(
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"app.hello\"}");
    CHECK(raw != NULL, "dispatcher answered");
    cJSON *resp = raw != NULL ? cJSON_Parse(raw) : NULL;
    cJSON *result = cJSON_GetObjectItemCaseSensitive(resp, "result");
    CHECK(cJSON_IsObject(result), "app.hello returns a result");
    CHECK(cJSON_IsString(cJSON_GetObjectItemCaseSensitive(result, "coreVersion")),
          "app.hello carries the core version");
    cJSON_Delete(resp);
    dbcore_ipc_free(raw);
}

int main(void)
{
    test_registers_every_linked_driver();
    test_app_hello();
    dbcore_runtime_reset();
    if (g_failures != 0) {
        fprintf(stderr, "%d failure(s)\n", g_failures);
        return 1;
    }
    printf("static_registry_test: OK (%s)\n", QUAERO_STATIC_DRIVER_NAMES);
    return 0;
}
