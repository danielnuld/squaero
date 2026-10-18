#include "tx_support.h"

#include <string.h>

/* maxWireVersion of MongoDB 4.0 (replica-set transactions) and 4.2 (sharded). */
#define WIRE_RS_TX 7
#define WIRE_SHARDED_TX 8

mongo_tx_support mongo_tx_check(const char *server_type, int max_wire)
{
    if (server_type == NULL) {
        return MONGO_TX_UNKNOWN;
    }
    if (strcmp(server_type, "Standalone") == 0) {
        return MONGO_TX_STANDALONE;
    }
    if (strcmp(server_type, "RSPrimary") == 0) {
        return (max_wire > 0 && max_wire < WIRE_RS_TX) ? MONGO_TX_TOO_OLD : MONGO_TX_OK;
    }
    if (strcmp(server_type, "Mongos") == 0) {
        return (max_wire > 0 && max_wire < WIRE_SHARDED_TX) ? MONGO_TX_TOO_OLD : MONGO_TX_OK;
    }
    if (strncmp(server_type, "RS", 2) == 0) {
        return MONGO_TX_NOT_PRIMARY;
    }
    return MONGO_TX_UNKNOWN;
}

const char *mongo_tx_message(mongo_tx_support s)
{
    switch (s) {
    case MONGO_TX_OK:
        return "";
    case MONGO_TX_STANDALONE:
        return "transactions need a replica set or a sharded cluster: this MongoDB server is "
               "standalone";
    case MONGO_TX_NOT_PRIMARY:
        return "transactions need the replica set's primary, but this connection reached a "
               "member that is not one";
    case MONGO_TX_TOO_OLD:
        return "this MongoDB server is too old for multi-document transactions (replica sets "
               "need 4.0, sharded clusters 4.2)";
    case MONGO_TX_UNKNOWN:
    default:
        return "could not tell whether this MongoDB server supports transactions";
    }
}
