#include "tx_support.h"

#include <stdio.h>
#include <string.h>

/* Unit tests for the transaction-support check. Pure: no libbson/mongoc. */

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
    EXPECT(mongo_tx_check("RSPrimary", 17) == MONGO_TX_OK, "a replica-set primary");
    EXPECT(mongo_tx_check("RSPrimary", 7) == MONGO_TX_OK, "a 4.0 primary is the minimum");
    EXPECT(mongo_tx_check("RSPrimary", 6) == MONGO_TX_TOO_OLD, "a 3.6 primary is too old");
    EXPECT(mongo_tx_check("RSPrimary", 0) == MONGO_TX_OK, "an unknown wire version is not held against it");
    EXPECT(mongo_tx_check("Mongos", 17) == MONGO_TX_OK, "a mongos");
    EXPECT(mongo_tx_check("Mongos", 8) == MONGO_TX_OK, "a 4.2 mongos is the minimum");
    EXPECT(mongo_tx_check("Mongos", 7) == MONGO_TX_TOO_OLD, "a 4.0 mongos is too old");
    EXPECT(mongo_tx_check("Standalone", 17) == MONGO_TX_STANDALONE, "a standalone has none");
    EXPECT(mongo_tx_check("RSSecondary", 17) == MONGO_TX_NOT_PRIMARY, "a secondary cannot");
    EXPECT(mongo_tx_check("RSArbiter", 17) == MONGO_TX_NOT_PRIMARY, "an arbiter cannot");
    EXPECT(mongo_tx_check("Unknown", 17) == MONGO_TX_UNKNOWN, "an unknown server type");
    EXPECT(mongo_tx_check("LoadBalancer", 17) == MONGO_TX_UNKNOWN, "a load balancer is not assumed");
    EXPECT(mongo_tx_check(NULL, 17) == MONGO_TX_UNKNOWN, "NULL type");

    EXPECT(mongo_tx_message(MONGO_TX_OK)[0] == '\0', "no message when supported");
    EXPECT(strstr(mongo_tx_message(MONGO_TX_STANDALONE), "replica set") != NULL,
           "the standalone message names the replica set");
    EXPECT(strstr(mongo_tx_message(MONGO_TX_NOT_PRIMARY), "primary") != NULL, "not-primary message");
    EXPECT(strstr(mongo_tx_message(MONGO_TX_TOO_OLD), "4.0") != NULL, "too-old message");
    EXPECT(mongo_tx_message(MONGO_TX_UNKNOWN)[0] != '\0', "unknown message");

    if (failures == 0) {
        printf("OK: mongodb tx support check (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
