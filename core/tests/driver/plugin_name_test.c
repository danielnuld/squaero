#include "dbcore/loader.h"

#include <stdio.h>

/* Tests for the pure dbc_plugin_is_candidate predicate. The expected extension
   is platform-specific, so the cases are selected per platform. */

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
    /* NULL and empty are never candidates. */
    EXPECT(dbc_plugin_is_candidate(NULL) == 0, "NULL is not a candidate");
    EXPECT(dbc_plugin_is_candidate("") == 0, "empty is not a candidate");

    /* A bare extension with no stem is not a candidate. */
#if defined(_WIN32)
    EXPECT(dbc_plugin_is_candidate(".dll") == 0, "bare .dll is not a candidate");
    EXPECT(dbc_plugin_is_candidate("sqlite.dll") == 1, "sqlite.dll is a candidate");
    EXPECT(dbc_plugin_is_candidate("SQLITE.DLL") == 1, "case-insensitive on Windows");
    EXPECT(dbc_plugin_is_candidate("driver.so") == 0, ".so is not a Windows candidate");
    EXPECT(dbc_plugin_is_candidate("libdriver.dll.a") == 0, "import lib is not a candidate");
#elif defined(__APPLE__)
    EXPECT(dbc_plugin_is_candidate(".dylib") == 0, "bare .dylib is not a candidate");
    EXPECT(dbc_plugin_is_candidate("libsqlite.dylib") == 1, "libsqlite.dylib is a candidate");
    EXPECT(dbc_plugin_is_candidate("driver.so") == 0, ".so is not a macOS candidate");
    EXPECT(dbc_plugin_is_candidate("driver.DYLIB") == 0, "case-sensitive on macOS");
#else
    EXPECT(dbc_plugin_is_candidate(".so") == 0, "bare .so is not a candidate");
    EXPECT(dbc_plugin_is_candidate("libsqlite.so") == 1, "libsqlite.so is a candidate");
    EXPECT(dbc_plugin_is_candidate("driver.dll") == 0, ".dll is not a Linux candidate");
    EXPECT(dbc_plugin_is_candidate("driver.SO") == 0, "case-sensitive on Linux");
#endif

    /* A name that merely contains the extension mid-string is not a candidate. */
#if defined(_WIN32)
    EXPECT(dbc_plugin_is_candidate("a.dll.txt") == 0, "extension must be a suffix");
#else
    EXPECT(dbc_plugin_is_candidate("a.so.txt") == 0, "extension must be a suffix");
#endif

    if (failures == 0) {
        printf("OK: dbc_plugin_is_candidate (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
