#ifndef QUAERO_INFORMIX_DSN_H
#define QUAERO_INFORMIX_DSN_H

#include <stddef.h>

/* The DRDA listener's usual port (the sqlhosts entry of protocol drsoctcp). */
#define IFX_DEFAULT_PORT 9089

/* Values of `tls`, in the order of libdrda's drda_tls_mode. */
enum { IFX_TLS_OFF = 0, IFX_TLS_REQUIRE, IFX_TLS_VERIFY_CA, IFX_TLS_VERIFY_FULL };

struct ifx_dsn {
    char host[256];
    int  port;
    char database[129];
    char user[129];
    char password[256];
    int  tls;
    char tls_ca[1024];   /* "" = none */
};

/*
 * Parse the connection's JSON DSN:
 *   { "host": "10.0.0.5", "port": "9089", "database": "stores",
 *     "user": "informix", "password": "secret",
 *     "tls": "verify-full", "tls_ca": "C:/certs/ca.pem" }
 * port is a string or a number (default 9089), database defaults to sysmaster,
 * tls is "" (off), "require", "verify-ca" or "verify-full". Keys of the old ODBC
 * driver that no longer mean anything (server, client_locale, db_locale) are
 * ignored; the two that would silently change what the user asked for
 * (odbc_dsn, protocol=onsocssl) are refused with a message saying what to set.
 * Returns 0, or -1 with a message in err. Pure, for unit tests.
 */
int informix_dsn_parse(const char *json, struct ifx_dsn *d, char *err, size_t errlen);

#endif /* QUAERO_INFORMIX_DSN_H */
