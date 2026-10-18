#ifndef QUAERO_MSSQL_CANCEL_H
#define QUAERO_MSSQL_CANCEL_H

/*
 * The cancel request of one connection, free of FreeTDS so it is unit-tested
 * without the client library (issue #668).
 *
 * db-lib's dbcancel is not safe to call from another thread while dbsqlexec
 * runs on the connection, so the cancel hook never touches the DBPROCESS: it
 * only raises this flag. The query thread acts on it — from db-lib's interrupt
 * handler while it waits on the server, or between rows while it reads — and
 * sends the ATTENTION itself. Every operation is atomic, so request() is safe
 * from any thread.
 *
 *   IDLE --request--> REQUESTED --claim--> SENT
 *     ^                                      |
 *     +-------------- reset (next query) ----+
 */

typedef struct {
    volatile long state;  /* only through the functions below */
} mssql_cancel;

/* The query thread starts a new query: forget any earlier request. */
void mssql_cancel_reset(mssql_cancel *c);

/* Ask the running query to stop. Any thread; harmless when idle (the next
   query resets it). */
void mssql_cancel_request(mssql_cancel *c);

/* 1 while a request waits to be acted on (db-lib's chkintr). */
int mssql_cancel_pending(mssql_cancel *c);

/* Take the pending request: 1 for the one caller that moves it to SENT and must
   now stop the query, 0 when there was nothing (left) to act on. */
int mssql_cancel_claim(mssql_cancel *c);

#endif /* QUAERO_MSSQL_CANCEL_H */
