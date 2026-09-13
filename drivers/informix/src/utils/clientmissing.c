#include "clientmissing.h"

#include <string.h>

int ifx_client_missing(int direct, const char *sqlstate)
{
    return !direct && sqlstate != NULL && strcmp(sqlstate, "IM002") == 0;
}
