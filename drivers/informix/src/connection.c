#include "internal.h"
#include "utils/dsn.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Connection lifecycle for the Informix driver over DRDA (libdrda, issue #557).
 * The DSN arrives as JSON (see utils/dsn.h):
 *
 *   { "host": "10.0.0.5", "port": "9089", "database": "stores",
 *     "user": "informix", "password": "secret",
 *     "tls": "verify-full", "tls_ca": "C:/certs/ca.pem" }
 *
 * The port is the server's DRDA listener (sqlhosts protocol drsoctcp, or
 * drsocssl for TLS), not the onsoctcp one the IBM clients use. On any failure
 * connect still returns the (error-state) handle so the core can read
 * last_error before disconnecting. The engine-agnostic SSH tunnel is handled in
 * the core (issue #76), transparently to this driver.
 */

static void lock_init(dbc_conn *c)
{
#if defined(_WIN32)
    InitializeCriticalSection(&c->lock);
#else
    pthread_mutex_init(&c->lock, NULL);
#endif
}

static void lock_destroy(dbc_conn *c)
{
#if defined(_WIN32)
    DeleteCriticalSection(&c->lock);
#else
    pthread_mutex_destroy(&c->lock);
#endif
}

static void lock_acquire(dbc_conn *c)
{
#if defined(_WIN32)
    EnterCriticalSection(&c->lock);
#else
    pthread_mutex_lock(&c->lock);
#endif
}

static void lock_release(dbc_conn *c)
{
#if defined(_WIN32)
    LeaveCriticalSection(&c->lock);
#else
    pthread_mutex_unlock(&c->lock);
#endif
}

void ifx_set_err(dbc_conn *c, const char *msg)
{
    if (c != NULL) {
        snprintf(c->err, sizeof c->err, "%s", msg);
    }
}

void ifx_stash_drda(dbc_conn *c, const char *ctx)
{
    if (c == NULL) {
        return;
    }
    snprintf(c->err, sizeof c->err, "%s: %s", ctx != NULL ? ctx : "error",
             c->d != NULL ? drda_error(c->d) : "not connected");
}

dbc_status ifx_failure_status(const dbc_conn *c)
{
    return (c == NULL || c->d == NULL || drda_conn_lost(c->d)) ? DBC_ERR_CONN : DBC_ERR_QUERY;
}

void ifx_busy(dbc_conn *c, int on)
{
    if (c == NULL) {
        return;
    }
    lock_acquire(c);
    c->busy = on;
    lock_release(c);
}

dbc_status ifx_cancel(dbc_conn *c)
{
    dbc_status st;
    if (c == NULL) {
        return DBC_ERR_UNSUPPORTED;
    }
    /* Under the lock, so disconnect cannot free the connection while its
       socket is being shut down. drda_cancel is only a shutdown() call. */
    lock_acquire(c);
    if (c->d == NULL || !c->busy) {
        st = DBC_ERR_PARAM; /* nothing running on this connection */
    } else {
        drda_cancel(c->d);
        st = DBC_OK;
    }
    lock_release(c);
    return st;
}

dbc_status ifx_connect(const char *dsn_json, dbc_conn **out)
{
    struct ifx_dsn d;
    drda_options o;
    char err[512];
    dbc_conn *c = calloc(1, sizeof *c);
    *out = NULL;
    if (c == NULL) {
        return DBC_ERR_NOMEM;
    }
    lock_init(c);
    *out = c;

    if (informix_dsn_parse(dsn_json, &d, err, sizeof err) != 0) {
        ifx_set_err(c, err);
        return DBC_ERR_PARAM;
    }
#if !defined(QUAERO_IFX_TLS)
    if (d.tls != IFX_TLS_OFF) {
        ifx_set_err(c, "this build of Squaero has no TLS support for Informix");
        return DBC_ERR_UNSUPPORTED;
    }
#endif
    memset(&o, 0, sizeof o);
    o.tls = (drda_tls_mode)d.tls;
    o.ca_file = d.tls_ca[0] != '\0' ? d.tls_ca : NULL;
    c->d = drda_connect_opts(d.host, d.port, d.database, d.user, d.password, &o, err,
                             (int)sizeof err);
    /* The password is not needed past this point. */
    memset(d.password, 0, sizeof d.password);
    if (c->d == NULL) {
        snprintf(c->err, sizeof c->err, "connect: %s", err);
        return DBC_ERR_CONN;
    }
    return DBC_OK;
}

void ifx_disconnect(dbc_conn *c)
{
    if (c == NULL) {
        return;
    }
    lock_acquire(c);
    if (c->d != NULL) {
        /* Outside an explicit transaction everything is already committed;
           inside one, closing without a commit is a rollback, as it was. */
        drda_close(c->d);
        c->d = NULL;
    }
    lock_release(c);
    lock_destroy(c);
    free(c);
}

const char *ifx_last_error(dbc_conn *c)
{
    return c != NULL ? c->err : "";
}
