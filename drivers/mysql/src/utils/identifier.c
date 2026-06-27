#include "identifier.h"

int mysql_quote_identifier(const char *id, char *buf, size_t cap)
{
    if (id == NULL || buf == NULL || cap == 0) {
        return 0;
    }

    size_t w = 0;
    if (w + 1 >= cap) {
        return 0;
    }
    buf[w++] = '`';

    for (const char *p = id; *p != '\0'; p++) {
        if (*p == '`') {
            if (w + 2 >= cap) {
                return 0;
            }
            buf[w++] = '`';
            buf[w++] = '`';
        } else {
            if (w + 1 >= cap) {
                return 0;
            }
            buf[w++] = *p;
        }
    }

    if (w + 2 > cap) {
        return 0;
    }
    buf[w++] = '`';
    buf[w] = '\0';
    return 1;
}
