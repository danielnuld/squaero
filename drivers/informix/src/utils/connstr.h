#ifndef QUAERO_INFORMIX_CONNSTR_H
#define QUAERO_INFORMIX_CONNSTR_H

#include <stddef.h>

/*
 * Pure builder for the connection string of the SQLI fallback (sqli.c): the
 * CSDK's ODBC driver, loaded directly, so there is no DRIVER= for a Driver
 * Manager to resolve. It reaches the server's onsoctcp listener by host and
 * service, and needs the server's INFORMIXSERVER name: the engine refuses a
 * name that is not one of its DBSERVERNAME/DBSERVERALIASES (-761).
 *
 * CLIENT_LOCALE is always en_us.utf8, so the CSDK converts the database's code
 * set for us (issue #323: the keyword works, the environment variable does not).
 *
 * Values containing a delimiter ({ } ; =) or whitespace are wrapped in braces
 * per the ODBC connection-string grammar, and any literal '}' inside such a
 * value is doubled, so passwords with special characters round-trip safely.
 */
struct informix_conn_params {
    const char *host;
    const char *service;   /* TCP port number */
    const char *server;    /* INFORMIXSERVER name */
    const char *database;
    const char *user;
    const char *password;
};

/*
 * Write the connection string into buf. Returns the length written (excluding
 * the NUL), or -1 when the result would not fit or host, service or server is
 * missing.
 */
int informix_build_conn_str(const struct informix_conn_params *p,
                            char *buf, size_t buflen);

#endif /* QUAERO_INFORMIX_CONNSTR_H */
