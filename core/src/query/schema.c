#include "dbcore/schema.h"

#include "materialize.h"

/* Common tail: turn a just-called introspection method's outcome into a
   materialized result. `st`/`dr` are the method's return value and out-param. */
static dbc_status finish(const dbc_driver_t *drv, dbc_conn *handle, dbc_status st,
                         dbc_result *dr, int max_rows, dbcore_result **out,
                         char *errbuf, size_t errcap)
{
    if (st != DBC_OK) {
        dbcore_copy_error(errbuf, errcap, drv->last_error(handle));
        if (dr != NULL) {
            drv->free_result(dr);
        }
        return st;
    }
    if (dr == NULL) {
        dbcore_copy_error(errbuf, errcap,
                          "driver reported success but returned no result");
        return DBC_ERR_QUERY;
    }
    return dbcore_materialize(drv, handle, dr, max_rows, out, errbuf, errcap);
}

/* Validate the ref and that the driver advertises `feature`. */
static dbc_status guard(const dbcore_conn_ref *conn, unsigned int feature,
                        dbcore_result **out, char *errbuf, size_t errcap)
{
    if (errbuf != NULL && errcap > 0) {
        errbuf[0] = '\0';
    }
    if (conn == NULL || conn->driver == NULL || conn->handle == NULL ||
        out == NULL) {
        dbcore_copy_error(errbuf, errcap, "invalid argument");
        return DBC_ERR_PARAM;
    }
    *out = NULL;
    if ((conn->driver->features & feature) == 0) {
        dbcore_copy_error(errbuf, errcap, "operation not supported by this driver");
        return DBC_ERR_UNSUPPORTED;
    }
    return DBC_OK;
}

static dbc_status unsupported(char *errbuf, size_t errcap)
{
    dbcore_copy_error(errbuf, errcap, "operation not supported by this driver");
    return DBC_ERR_UNSUPPORTED;
}

dbc_status dbcore_schema_tree(const dbcore_conn_ref *conn, const char *db,
                              const char *schema, int max_rows,
                              dbcore_result **out, char *errbuf, size_t errcap)
{
    dbc_status g = guard(conn, DBC_FEAT_INTROSPECTION, out, errbuf, errcap);
    if (g != DBC_OK) {
        return g;
    }
    const dbc_driver_t *drv = conn->driver;
    dbc_conn *handle = conn->handle;

    dbc_result *dr = NULL;
    dbc_status st;

    if (schema != NULL) {
        /* A named schema (or, on schemaless engines, a database) -> tables. */
        if (drv->list_tables == NULL) {
            return unsupported(errbuf, errcap);
        }
        st = drv->list_tables(handle, schema, &dr);
    } else if (db != NULL) {
        if (drv->features & DBC_FEAT_SCHEMAS) {
            if (drv->list_schemas == NULL) {
                return unsupported(errbuf, errcap);
            }
            st = drv->list_schemas(handle, db, &dr);
        } else {
            /* Schemaless engine: a database's children are its tables. */
            if (drv->list_tables == NULL) {
                return unsupported(errbuf, errcap);
            }
            st = drv->list_tables(handle, db, &dr);
        }
    } else {
        if (drv->list_databases == NULL) {
            return unsupported(errbuf, errcap);
        }
        st = drv->list_databases(handle, &dr);
    }

    return finish(drv, handle, st, dr, max_rows, out, errbuf, errcap);
}

dbc_status dbcore_schema_describe(const dbcore_conn_ref *conn, const char *schema,
                                  const char *table, int max_rows,
                                  dbcore_result **out, char *errbuf, size_t errcap)
{
    dbc_status g = guard(conn, DBC_FEAT_INTROSPECTION, out, errbuf, errcap);
    if (g != DBC_OK) {
        return g;
    }
    if (table == NULL) {
        dbcore_copy_error(errbuf, errcap, "table name is required");
        return DBC_ERR_PARAM;
    }
    if (conn->driver->describe_table == NULL) {
        return unsupported(errbuf, errcap);
    }
    dbc_result *dr = NULL;
    dbc_status st = conn->driver->describe_table(conn->handle, schema, table, &dr);
    return finish(conn->driver, conn->handle, st, dr, max_rows, out, errbuf, errcap);
}

dbc_status dbcore_schema_ddl(const dbcore_conn_ref *conn, const char *schema,
                             const char *object, int max_rows,
                             dbcore_result **out, char *errbuf, size_t errcap)
{
    dbc_status g = guard(conn, DBC_FEAT_DDL, out, errbuf, errcap);
    if (g != DBC_OK) {
        return g;
    }
    if (object == NULL) {
        dbcore_copy_error(errbuf, errcap, "object name is required");
        return DBC_ERR_PARAM;
    }
    if (conn->driver->get_ddl == NULL) {
        return unsupported(errbuf, errcap);
    }
    dbc_result *dr = NULL;
    dbc_status st = conn->driver->get_ddl(conn->handle, schema, object, &dr);
    return finish(conn->driver, conn->handle, st, dr, max_rows, out, errbuf, errcap);
}
