#include "dbcore/dbcore.h"

#include <stdio.h>
#include <string.h>

/*
 * Base test that proves the test harness works end-to-end (build -> link ->
 * run -> CTest reporting). Real coverage of the core API arrives with M1.
 */
int main(void)
{
    const char *version = dbcore_version();

    if (version == NULL) {
        fprintf(stderr, "FAIL: dbcore_version() returned NULL\n");
        return 1;
    }
    if (strlen(version) == 0) {
        fprintf(stderr, "FAIL: dbcore_version() returned an empty string\n");
        return 1;
    }

    printf("OK: dbcore version = %s\n", version);
    return 0;
}
