#ifndef QUAERO_STATIC_DRIVERS_H
#define QUAERO_STATIC_DRIVERS_H

/*
 * Drivers linked into the binary (QUAERO_STATIC_DRIVERS, issue #573), for
 * platforms that cannot load plugins — iOS. The table behind this is generated
 * by CMake from the drivers the configuration built (drivers/CMakeLists.txt).
 */

#include "dbcore/runtime.h"

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Validate every linked driver's vtable (dbc_driver_validate, the same gate a
 * plugin goes through) and register it into `rt`. A driver that fails is
 * skipped and reported on stderr, never registered half-built.
 *
 * Returns the number of drivers registered, or -1 when `rt` is NULL.
 */
int quaero_register_static_drivers(dbcore_runtime *rt);

#ifdef __cplusplus
}
#endif

#endif /* QUAERO_STATIC_DRIVERS_H */
