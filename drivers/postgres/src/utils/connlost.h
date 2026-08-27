#ifndef QUAERO_PG_CONNLOST_H
#define QUAERO_PG_CONNLOST_H

/*
 * Telling "the connection died" apart from "the SQL was wrong" (issue #407).
 * See the MySQL driver's connlost.h for why: both arrive as a failed query, and
 * the app could not react differently to something it could not distinguish.
 *
 * PostgreSQL says it in the SQLSTATE, which is what makes this pure: the class
 * is the first two characters and class 08 IS "connection exception" in the
 * standard, so the rule is the class rather than a list of codes that grows with
 * every release.
 */

/*
 * True when `sqlstate` (5 characters, from PG_DIAG_SQLSTATE) means the
 * connection is gone. NULL or a short string is not: an unreadable diagnostic
 * must stay a query error rather than send the user to reconnect on a guess.
 *
 * Class 08 is connection exception. The three 57P0x codes are the server going
 * away on purpose — shutdown, crash shutdown, and "cannot connect now" during
 * recovery — which the standard files under operator intervention, not under 08.
 */
int pg_sqlstate_is_conn_lost(const char *sqlstate);

#endif /* QUAERO_PG_CONNLOST_H */
