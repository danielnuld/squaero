#include "options.h"

#include <stddef.h>
#include <string.h>

const char *mssql_encryption_option(const char *value)
{
    static const char *const accepted[] = {"off", "request", "require", "strict"};
    if (value == NULL || value[0] == '\0') {
        return "require";
    }
    for (size_t i = 0; i < sizeof accepted / sizeof accepted[0]; i++) {
        if (strcmp(value, accepted[i]) == 0) {
            return accepted[i];
        }
    }
    return NULL;
}
