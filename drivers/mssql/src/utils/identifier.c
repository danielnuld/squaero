#include "identifier.h"

/* Write prefix, then `s` with every `quote` doubled, then `close`. */
static int quote(const char *prefix, const char *s, char quote_ch, char close,
                 char *buf, size_t cap)
{
    if (s == NULL || buf == NULL || cap == 0) {
        return 0;
    }
    size_t w = 0;
    for (const char *p = prefix; *p != '\0'; p++) {
        if (w + 1 >= cap) {
            return 0;
        }
        buf[w++] = *p;
    }
    for (const char *p = s; *p != '\0'; p++) {
        size_t need = (*p == quote_ch) ? 2 : 1;
        if (w + need >= cap) {
            return 0;
        }
        buf[w++] = *p;
        if (*p == quote_ch) {
            buf[w++] = *p;
        }
    }
    if (w + 2 > cap) {
        return 0;
    }
    buf[w++] = close;
    buf[w] = '\0';
    return 1;
}

int mssql_quote_identifier(const char *id, char *buf, size_t cap)
{
    return quote("[", id, ']', ']', buf, cap);
}

int mssql_quote_literal(const char *value, char *buf, size_t cap)
{
    return quote("N'", value, '\'', '\'', buf, cap);
}
