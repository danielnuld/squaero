#include "value_fmt.h"

#include <stdio.h>
#include <string.h>

/* Unit tests for the pure ISO 8601 datetime formatter. */

static int failures = 0;
#define EXPECT_STR(millis, want)                                       \
    do {                                                               \
        char buf[32];                                                  \
        mongo_format_datetime((millis), buf, sizeof(buf));             \
        if (strcmp(buf, (want)) != 0) {                                \
            fprintf(stderr, "FAIL: %lld -> '%s' (want '%s')\n",        \
                    (long long)(millis), buf, (want));                 \
            failures++;                                                \
        }                                                              \
    } while (0)

int main(void)
{
    /* The Unix epoch. */
    EXPECT_STR(0, "1970-01-01T00:00:00.000Z");

    /* Sub-second and second components. */
    EXPECT_STR(1234, "1970-01-01T00:00:01.234Z");

    /* A well-known instant: 2021-01-01T00:00:00Z. */
    EXPECT_STR(1609459200000LL, "2021-01-01T00:00:00.000Z");

    /* A mid-day timestamp with milliseconds: 2009-02-13T23:31:30.123Z. */
    EXPECT_STR(1234567890123LL, "2009-02-13T23:31:30.123Z");

    /* Just before the epoch: flooring must roll the date/time back. */
    EXPECT_STR(-1, "1969-12-31T23:59:59.999Z");

    /* A leap day. 2020-02-29T12:00:00Z. */
    EXPECT_STR(1582977600000LL, "2020-02-29T12:00:00.000Z");

    if (failures == 0) {
        printf("OK: mongodb datetime formatter (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
