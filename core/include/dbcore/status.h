#ifndef DBCORE_STATUS_H
#define DBCORE_STATUS_H

/*
 * Result status shared across the whole core and the driver ABI.
 *
 * This is deliberately a tiny, dependency-free header: any internal module that
 * only reports success/failure (e.g. the pure DSN parsers in conn/) can include
 * it without pulling in the full driver vtable contract (dbcore/driver.h).
 * driver.h re-exports this header, so every existing include of driver.h keeps
 * seeing dbc_status and the DBC_ERR_* codes unchanged.
 */

#ifdef __cplusplus
extern "C" {
#endif

/* Result status of any core/vtable operation. DBC_OK is always 0. */
typedef enum {
    DBC_OK = 0,
    DBC_ERR_CONN,         /* connection failed or is invalid */
    DBC_ERR_QUERY,        /* query execution / result error */
    DBC_ERR_PARAM,        /* invalid argument from the core (e.g. NULL) */
    DBC_ERR_UNSUPPORTED,  /* operation not supported by this engine */
    DBC_ERR_ABI,          /* driver ABI is incompatible with the core */
    DBC_ERR_NOMEM         /* memory allocation failed */
} dbc_status;

#ifdef __cplusplus
}
#endif

#endif /* DBCORE_STATUS_H */
