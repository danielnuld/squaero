#ifndef QUAERO_MONGODB_TX_SUPPORT_H
#define QUAERO_MONGODB_TX_SUPPORT_H

/*
 * Whether the server the driver is talking to can run multi-document
 * transactions. MongoDB has them only on a replica set (primary) or a sharded
 * cluster (mongos), and from server 4.0 / 4.2 on respectively; a standalone
 * mongod has none. Pure: the caller passes what the topology reports.
 */

typedef enum {
    MONGO_TX_OK = 0,
    MONGO_TX_STANDALONE,    /* a standalone mongod */
    MONGO_TX_NOT_PRIMARY,   /* a replica-set member that cannot take writes */
    MONGO_TX_TOO_OLD,       /* replica set < 4.0 / sharded < 4.2 */
    MONGO_TX_UNKNOWN        /* a server type that is none of the above */
} mongo_tx_support;

/* `server_type` is mongoc_server_description_type() ("Standalone", "RSPrimary",
   "Mongos", ...), `max_wire` the server's maxWireVersion (0 when unknown, which
   is not held against it). */
mongo_tx_support mongo_tx_check(const char *server_type, int max_wire);

/* The reason, ready to show; "" for MONGO_TX_OK. */
const char *mongo_tx_message(mongo_tx_support s);

#endif /* QUAERO_MONGODB_TX_SUPPORT_H */
