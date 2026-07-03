#include "dbcore/tx.h"

#include "materialize.h"  /* dbcore_copy_error */

/*
 * Transaction control. Each entry point validates the borrowed connection,
 * checks that the driver actually supports transactions (advertises the flag AND
 * provides the member), then delegates to the vtable. A driver that does not
 * support transactions gets an explicit DBC_ERR_UNSUPPORTED — never a fake OK.
 */

typedef dbc_status (*tx_member_fn)(dbc_conn *);

static dbc_status run_tx(const dbcore_conn_ref *conn, tx_member_fn member,
                         const char *verb, char *errbuf, size_t errcap)
{
    if (errbuf != NULL && errcap > 0) {
        errbuf[0] = '\0';
    }
    if (conn == NULL || conn->driver == NULL || conn->handle == NULL) {
        dbcore_copy_error(errbuf, errcap, "invalid argument");
        return DBC_ERR_PARAM;
    }

    const dbc_driver_t *drv = conn->driver;
    if (!(drv->features & DBC_FEAT_TRANSACTIONS) || member == NULL) {
        dbcore_copy_error(errbuf, errcap,
                          "this engine does not support transactions");
        (void)verb;
        return DBC_ERR_UNSUPPORTED;
    }

    dbc_status st = member(conn->handle);
    if (st != DBC_OK) {
        dbcore_copy_error(errbuf, errcap, drv->last_error(conn->handle));
    }
    return st;
}

dbc_status dbcore_tx_begin(const dbcore_conn_ref *conn, char *errbuf, size_t errcap)
{
    return run_tx(conn, conn != NULL && conn->driver != NULL ? conn->driver->begin : NULL,
                  "begin", errbuf, errcap);
}

dbc_status dbcore_tx_commit(const dbcore_conn_ref *conn, char *errbuf, size_t errcap)
{
    return run_tx(conn, conn != NULL && conn->driver != NULL ? conn->driver->commit : NULL,
                  "commit", errbuf, errcap);
}

dbc_status dbcore_tx_rollback(const dbcore_conn_ref *conn, char *errbuf, size_t errcap)
{
    return run_tx(conn, conn != NULL && conn->driver != NULL ? conn->driver->rollback : NULL,
                  "rollback", errbuf, errcap);
}
