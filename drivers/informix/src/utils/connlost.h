#ifndef QUAERO_IFX_CONNLOST_H
#define QUAERO_IFX_CONNLOST_H

/*
 * Telling "the connection died" apart from "the SQL was wrong" (issue #407).
 * This is the engine the report was about: Informix sessions get closed on
 * inactivity or lost with the tunnel, and the ODBC error that finally surfaces
 * says nothing a user can act on. Now the driver reports DBC_ERR_CONN and the
 * app can say the connection is gone and offer to reopen it.
 *
 * ODBC puts the answer in the SQLSTATE, whose first two characters are the
 * class. Class 08 is "connection exception" — the same class PostgreSQL uses,
 * for the same reason: it is the standard's.
 */

/*
 * True when `sqlstate` (from SQLGetDiagRec) means the connection is gone.
 * Class 08 covers 08001/08003/08004/08007/08S01 without listing them. NULL or a
 * short string is not a lost connection: an unreadable diagnostic stays a query
 * error rather than sending the user to reconnect on a guess.
 */
int ifx_sqlstate_is_conn_lost(const char *sqlstate);

#endif /* QUAERO_IFX_CONNLOST_H */
