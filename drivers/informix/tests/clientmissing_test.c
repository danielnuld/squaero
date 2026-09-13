#include "clientmissing.h"

#include <stdio.h>
#include <string.h>

/* Unit tests for recognizing a missing Informix client (issue #506). */

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
    /* The Driver Manager fallback with no Informix driver registered. */
    EXPECT(ifx_client_missing(0, "IM002") == 1, "manager + IM002 is a missing client");

    /* A loaded client failing is a real connect error, whatever it says. */
    EXPECT(ifx_client_missing(1, "IM002") == 0, "direct client + IM002 is not");
    EXPECT(ifx_client_missing(1, "08004") == 0, "direct client refused by server is not");

    /* Other manager failures are not about the client being absent. */
    EXPECT(ifx_client_missing(0, "08001") == 0, "manager + unreachable server is not");
    EXPECT(ifx_client_missing(0, "28000") == 0, "manager + bad login is not");
    EXPECT(ifx_client_missing(0, "IM0021") == 0, "longer state is not");
    EXPECT(ifx_client_missing(0, "IM00") == 0, "shorter state is not");
    EXPECT(ifx_client_missing(0, "") == 0, "empty state is not");
    EXPECT(ifx_client_missing(0, NULL) == 0, "no diagnostic is not");

    /* The marker is part of the contract with the frontend. */
    EXPECT(strcmp(IFX_CLIENT_MISSING_MARKER, "IFX_CLIENT_MISSING") == 0, "marker text is stable");

    if (failures == 0) {
        printf("OK: informix client-missing detection (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
