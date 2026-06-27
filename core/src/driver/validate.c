#include "dbcore/driver.h"

#include <stddef.h>

/*
 * Load-time validation of a driver vtable. Pure: no I/O, no global state, so it
 * is unit-tested in isolation (see core/tests/driver/validate_test.c). The
 * dynamic loader (M1, issue #7) calls this on every plugin before first use.
 *
 * "Required" members are those a driver of any engine must implement. Optional
 * members (introspection, transactions) are gated behind DBC_FEAT_* flags and
 * may be NULL when the capability is not advertised, so they are not checked
 * here.
 */
dbc_status dbc_driver_validate(const dbc_driver_t *drv)
{
    if (drv == NULL) {
        return DBC_ERR_PARAM;
    }
    if (drv->abi_version != DBC_ABI_VERSION) {
        return DBC_ERR_ABI;
    }

    if (drv->name == NULL || drv->display_name == NULL) {
        return DBC_ERR_UNSUPPORTED;
    }

    if (drv->connect == NULL || drv->disconnect == NULL ||
        drv->last_error == NULL) {
        return DBC_ERR_UNSUPPORTED;
    }
    if (drv->query == NULL || drv->free_result == NULL) {
        return DBC_ERR_UNSUPPORTED;
    }
    if (drv->col_count == NULL || drv->col_name == NULL ||
        drv->col_type == NULL || drv->next_row == NULL ||
        drv->cell_text == NULL || drv->rows_affected == NULL) {
        return DBC_ERR_UNSUPPORTED;
    }

    return DBC_OK;
}
