#include "identifier.h"

int sqlite_quote_identifier(const char *id, char *buf, size_t cap)
{
    if (id == NULL || buf == NULL || cap == 0) {
        return 0;
    }

    size_t w = 0;
    /* opening quote */
    if (w + 1 >= cap) {
        return 0;
    }
    buf[w++] = '"';

    for (const char *p = id; *p != '\0'; p++) {
        /* A double quote inside the identifier is escaped by doubling it. */
        if (*p == '"') {
            if (w + 2 >= cap) {
                return 0;
            }
            buf[w++] = '"';
            buf[w++] = '"';
        } else {
            if (w + 1 >= cap) {
                return 0;
            }
            buf[w++] = *p;
        }
    }

    /* closing quote + NUL */
    if (w + 2 > cap) {
        return 0;
    }
    buf[w++] = '"';
    buf[w] = '\0';
    return 1;
}
