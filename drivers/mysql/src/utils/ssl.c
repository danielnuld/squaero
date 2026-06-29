#include "ssl.h"

#include <stddef.h>
#include <string.h>

int mysql_ssl_mode_parse(const char *s, mysql_ssl_mode *out)
{
    *out = MYSQL_SSL_UNSET;
    if (s == NULL || s[0] == '\0') {
        return 1;
    }
    if (strcmp(s, "disabled") == 0) {
        *out = MYSQL_SSL_DISABLED;
    } else if (strcmp(s, "required") == 0) {
        *out = MYSQL_SSL_REQUIRED;
    } else if (strcmp(s, "verify_ca") == 0) {
        *out = MYSQL_SSL_VERIFY_CA;
    } else if (strcmp(s, "verify_identity") == 0) {
        *out = MYSQL_SSL_VERIFY_IDENTITY;
    } else {
        return 0;
    }
    return 1;
}
