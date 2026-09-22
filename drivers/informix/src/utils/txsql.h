#ifndef QUAERO_INFORMIX_TXSQL_H
#define QUAERO_INFORMIX_TXSQL_H

/*
 * Transaction statements typed in the editor. DRDA has no BEGIN WORK: a unit of
 * work starts by itself and ends with a commit or rollback request, and the
 * driver commits after every statement unless a transaction is open. So these
 * statements are recognized and carried out by the driver instead of being sent
 * to the server. Leading blanks and comments are skipped, case is ignored, WORK
 * is optional and a trailing ';' is allowed. Pure, for unit tests.
 */
typedef enum {
    IFX_TX_NONE = 0,  /* any other statement */
    IFX_TX_BEGIN,     /* BEGIN [WORK] */
    IFX_TX_COMMIT,    /* COMMIT [WORK] */
    IFX_TX_ROLLBACK,  /* ROLLBACK [WORK] */
} ifx_tx_stmt;

ifx_tx_stmt informix_tx_statement(const char *sql);

#endif /* QUAERO_INFORMIX_TXSQL_H */
