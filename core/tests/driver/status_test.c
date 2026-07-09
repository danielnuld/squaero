/*
 * dbc_status now lives in its own minimal header (issue #77). This test
 * includes ONLY dbcore/status.h — no dbcore/driver.h — so it fails to compile
 * if the status type ever stops being self-contained (the whole point of the
 * split: modules that only report success/failure must not need the driver
 * ABI). It also locks the code values, which are ABI-visible and must not drift.
 */
#include "dbcore/status.h"

#include <stdio.h>

#define CHECK(cond)                                        \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", #cond);          \
            return 1;                                      \
        }                                                  \
    } while (0)

int main(void)
{
    /* DBC_OK is the zero sentinel; the rest are distinct, contiguous codes. */
    CHECK(DBC_OK == 0);
    CHECK(DBC_ERR_CONN == 1);
    CHECK(DBC_ERR_QUERY == 2);
    CHECK(DBC_ERR_PARAM == 3);
    CHECK(DBC_ERR_UNSUPPORTED == 4);
    CHECK(DBC_ERR_ABI == 5);
    CHECK(DBC_ERR_NOMEM == 6);

    /* The type is usable on its own. */
    dbc_status s = DBC_OK;
    CHECK(s == DBC_OK);

    printf("OK: dbc_status is self-contained and its codes are stable\n");
    return 0;
}
