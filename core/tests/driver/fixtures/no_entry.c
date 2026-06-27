/* Test fixture: a loadable shared library that does NOT export the driver entry
   symbol. The loader must report DBC_ERR_UNSUPPORTED without crashing. */
#include "dbcore/driver.h"

DBC_DRIVER_EXPORT int dbc_fixture_unrelated_symbol(void)
{
    return 42;
}
