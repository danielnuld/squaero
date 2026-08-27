#ifndef QUAERO_MYSQL_CONNLOST_H
#define QUAERO_MYSQL_CONNLOST_H

/*
 * Telling "the connection died" apart from "the SQL was wrong" (issue #407).
 *
 * Both arrive as a failed query, and the app used to show them the same way: an
 * error, with the connection still marked as connected, until the user guessed
 * that Reconectar was the answer. The driver knows the difference — the client
 * library says so in its error number — and reports it as DBC_ERR_CONN instead
 * of DBC_ERR_QUERY, which the IPC layer already maps to its own code.
 *
 * Pure and header-light on purpose: takes the number, not the connection, so it
 * can be tested without a server.
 */

/*
 * True when `errnum` from mysql_errno() means the connection is gone.
 *
 * Two families. The CR_* client errors (2002..2055) are the socket dropping
 * under us. The server errors 1053 and 1927 are the other end hanging up on
 * purpose — a shutdown, or a KILL, which is exactly what the server monitor's
 * own "kill session" does to somebody else's session.
 *
 * Anything else — a syntax error, a missing table, a constraint — is a query
 * error and must stay one: reporting it as a lost connection would send the user
 * to reconnect over a typo.
 */
int mysql_errno_is_conn_lost(unsigned int errnum);

#endif /* QUAERO_MYSQL_CONNLOST_H */
