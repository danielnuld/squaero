#ifndef DBCORE_IPC_TX_METHODS_H
#define DBCORE_IPC_TX_METHODS_H

#include "cJSON.h"

/*
 * IPC handlers for transaction control on an open connection (issue #28). Each
 * takes params {connId: "c<N>"} and returns {ok: true} on success. They delegate
 * to dbcore_tx_* (see dbcore/tx.h); an engine without transaction support yields
 * an UNSUPPORTED error rather than a fake success. See docs/IPC.md.
 */

/* tx.begin — params {connId}. result {ok: true}. */
cJSON *ipc_method_tx_begin(const cJSON *params, int *code, const char **message);

/* tx.commit — params {connId}. result {ok: true}. */
cJSON *ipc_method_tx_commit(const cJSON *params, int *code, const char **message);

/* tx.rollback — params {connId}. result {ok: true}. */
cJSON *ipc_method_tx_rollback(const cJSON *params, int *code, const char **message);

#endif /* DBCORE_IPC_TX_METHODS_H */
