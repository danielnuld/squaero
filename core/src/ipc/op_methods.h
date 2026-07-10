#ifndef DBCORE_IPC_OP_METHODS_H
#define DBCORE_IPC_OP_METHODS_H

#include "cJSON.h"

/*
 * IPC handler for op.cancel — request cancellation of the query currently
 * running on a connection (issue: cancelable queries). It reaches the driver's
 * cancel hook through the op registry, which is thread-safe, so unlike the data
 * methods this one is meant to be dispatched WITHOUT waiting behind the running
 * query (the app shell handles it inline rather than on the RPC worker).
 *
 * params: { connId: "c<N>" }
 * result: { canceled: bool }  -- true only when a cancel was actually delivered
 *         (a query that already finished, or an engine that cannot cancel, both
 *         report false; neither is an error).
 */
cJSON *ipc_method_op_cancel(const cJSON *params, int *code, const char **message);

#endif /* DBCORE_IPC_OP_METHODS_H */
