#include "options.h"

#include <stdio.h>
#include <string.h>

/* Unit tests for the SQL Server DSN `encryption` field. */

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

static int is(const char *got, const char *want)
{
    return got != NULL && strcmp(got, want) == 0;
}

int main(void)
{
    /* The default must encrypt: "request" measured as plaintext. */
    EXPECT(is(mssql_encryption_option(NULL), "require"), "absent -> require");
    EXPECT(is(mssql_encryption_option(""), "require"), "empty -> require");
    EXPECT(is(mssql_encryption_option("off"), "off"), "off");
    EXPECT(is(mssql_encryption_option("request"), "request"), "request");
    EXPECT(is(mssql_encryption_option("require"), "require"), "require");
    EXPECT(is(mssql_encryption_option("strict"), "strict"), "strict");
    EXPECT(mssql_encryption_option("required") == NULL, "near miss rejected");
    EXPECT(mssql_encryption_option("REQUIRE") == NULL, "case-sensitive");
    EXPECT(mssql_encryption_option("yes") == NULL, "unknown rejected");

    if (failures == 0) {
        printf("OK: mssql encryption option (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
