#include "dbcore/dbcore.h"

#ifndef QUAERO_VERSION
#define QUAERO_VERSION "0.0.0"
#endif

const char *dbcore_version(void)
{
    return QUAERO_VERSION;
}
