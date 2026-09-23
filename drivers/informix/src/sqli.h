#ifndef QUAERO_INFORMIX_SQLI_H
#define QUAERO_INFORMIX_SQLI_H

/*
 * The SQLI fallback: the server's onsoctcp listener (usually 9088) through the
 * IBM Informix Client SDK's ODBC driver, for servers without a DRDA listener.
 *
 * libdrda is always tried first; the driver falls back here only when that
 * fails, the DSN names the server (sqli_server) and TLS is off. Windows only,
 * and the CSDK is never shipped: it must be installed on the machine, in the
 * process's bitness (64-bit for the x64 app). It is loaded directly from
 * INFORMIXDIR (the environment, then the registry), so no ODBC registration
 * and no Driver Manager are involved (issue #490). Elsewhere ifx_sqli_connect
 * refuses and nothing else is ever reached.
 *
 * The API mirrors libdrda's so the driver can dispatch call for call. Unlike
 * DRDA the connection runs in autocommit, and cancel interrupts the statement
 * without cutting the connection.
 */

#include "dbcore/driver.h"
#include "utils/dsn.h"

#include <stddef.h>

typedef struct ifx_sqli ifx_sqli;
typedef struct ifx_sqli_result ifx_sqli_result;

/* Connect over SQLI with host, port, database, user, password and sqli_server.
   NULL with a reason in err on failure. */
ifx_sqli   *ifx_sqli_connect(const struct ifx_dsn *d, char *err, size_t errlen);
void        ifx_sqli_close(ifx_sqli *s);
const char *ifx_sqli_error(const ifx_sqli *s);   /* UTF-8 */
/* 1 when the last failure said the connection is gone (SQLSTATE class 08). */
int         ifx_sqli_conn_lost(const ifx_sqli *s);
/* Interrupt the statement running on another thread. 0, or -1 when nothing
   is running. */
int         ifx_sqli_cancel(ifx_sqli *s);

/* Start (autocommit off) and end (commit or roll back, autocommit back on) an
   explicit transaction. 0 or -1. */
int         ifx_sqli_begin(ifx_sqli *s);
int         ifx_sqli_end(ifx_sqli *s, int commit);

/* Run a statement. 0 with *out set, or -1. */
int         ifx_sqli_query(ifx_sqli *s, const char *sql, ifx_sqli_result **out);
int         ifx_sqli_col_count(const ifx_sqli_result *r);
const char *ifx_sqli_col_name(const ifx_sqli_result *r, int col);
dbc_type    ifx_sqli_col_type(const ifx_sqli_result *r, int col);
/* 1 = a row, 0 = end, -1 = error (in ifx_sqli_error of its connection). */
int         ifx_sqli_next(ifx_sqli_result *r);
/* UTF-8 text of a cell of the current row, NULL for SQL NULL. Valid until the
   next ifx_sqli_next or ifx_sqli_free. */
const char *ifx_sqli_text(ifx_sqli_result *r, int col);
long long   ifx_sqli_rows_affected(const ifx_sqli_result *r);
void        ifx_sqli_free(ifx_sqli_result *r);

#endif /* QUAERO_INFORMIX_SQLI_H */
