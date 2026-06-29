#ifndef QUAERO_INFORMIX_CONNSTR_H
#define QUAERO_INFORMIX_CONNSTR_H

#include <stddef.h>

/*
 * Pure builder for the ODBC connection string passed to SQLDriverConnect.
 *
 * Two shapes are supported:
 *   - A pre-configured ODBC data source: set `odbc_dsn`; the result is
 *     "DSN=<dsn>;Uid=<user>;Pwd=<password>;" (driver/host/... are ignored).
 *   - A driver-direct connection (no sqlhosts entry needed): set `host`,
 *     `service` and `server`; the result lists DRIVER + Host/Service/Server/
 *     Protocol/Database/Uid/Pwd. `driver` defaults to the registered IBM
 *     Informix ODBC driver and `protocol` to onsoctcp.
 *
 * Values containing a delimiter ({ } ; =) or whitespace are wrapped in braces
 * per the ODBC connection-string grammar, and any literal '}' inside such a
 * value is doubled, so passwords with special characters round-trip safely.
 */
struct informix_conn_params {
    const char *driver;    /* NULL/"" => "IBM INFORMIX ODBC DRIVER" */
    const char *odbc_dsn;  /* when set, use DSN= form */
    const char *host;
    const char *service;   /* TCP port number or /etc/services name */
    const char *server;    /* INFORMIXSERVER name */
    const char *protocol;  /* NULL/"" => "onsoctcp" */
    const char *database;
    const char *user;
    const char *password;
};

/*
 * Write the connection string into buf. Returns the length written (excluding
 * the NUL), or -1 when the result would not fit or the params are insufficient
 * (neither an odbc_dsn nor the host/service/server triple was provided).
 */
int informix_build_conn_str(const struct informix_conn_params *p,
                            char *buf, size_t buflen);

#endif /* QUAERO_INFORMIX_CONNSTR_H */
