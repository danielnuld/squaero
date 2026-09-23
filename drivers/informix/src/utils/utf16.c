#include "utf16.h"

#include <stdlib.h>
#include <string.h>

int ifx_sql_wide_safe(const char *sql)
{
    if (sql == NULL) {
        return 0;
    }

    int in_literal = 0;
    int seen = 0;
    for (const unsigned char *p = (const unsigned char *)sql; *p != '\0'; p++) {
        if (*p == '\'') {
            /* A doubled quote inside a literal is an escaped quote, not the end. */
            if (in_literal && p[1] == '\'') {
                p++;
                continue;
            }
            in_literal = !in_literal;
            continue;
        }
        if (*p >= 0x80) {
            if (!in_literal) {
                return 0;   /* identifier/comment: the wide call would crash */
            }
            seen = 1;
        }
    }
    return seen;
}

/*
 * Decode one UTF-8 sequence at `s` (with `n` bytes left). Stores the code point in
 * *cp and returns the sequence length, or 0 when the bytes there are not a
 * well-formed sequence. The lead-byte ranges reject overlong forms, surrogates and
 * anything above U+10FFFF, so a malformed statement is refused rather than turned
 * into a different statement.
 */
static size_t decode(const unsigned char *s, size_t n, unsigned long *cp)
{
    unsigned char c = s[0];
    if (c < 0x80) {
        *cp = c;
        return 1;
    }

    size_t len;
    unsigned char min2, max2;
    if (c >= 0xC2 && c <= 0xDF) {
        len = 2; min2 = 0x80; max2 = 0xBF;
    } else if (c == 0xE0) {
        len = 3; min2 = 0xA0; max2 = 0xBF;
    } else if (c == 0xED) {
        len = 3; min2 = 0x80; max2 = 0x9F;
    } else if ((c >= 0xE1 && c <= 0xEC) || c == 0xEE || c == 0xEF) {
        len = 3; min2 = 0x80; max2 = 0xBF;
    } else if (c == 0xF0) {
        len = 4; min2 = 0x90; max2 = 0xBF;
    } else if (c >= 0xF1 && c <= 0xF3) {
        len = 4; min2 = 0x80; max2 = 0xBF;
    } else if (c == 0xF4) {
        len = 4; min2 = 0x80; max2 = 0x8F;
    } else {
        return 0;
    }

    if (n < len || s[1] < min2 || s[1] > max2) {
        return 0;
    }
    for (size_t k = 2; k < len; k++) {
        if ((s[k] & 0xC0) != 0x80) {
            return 0;
        }
    }

    unsigned long v = (unsigned long)(c & (0xFF >> (len + 1)));
    for (size_t k = 1; k < len; k++) {
        v = (v << 6) | (unsigned long)(s[k] & 0x3F);
    }
    *cp = v;
    return len;
}

unsigned short *ifx_utf8_to_utf16(const char *s, size_t *out_len)
{
    if (s == NULL) {
        return NULL;
    }
    size_t n = strlen(s);

    /* Worst case one UTF-16 unit per input byte (ASCII), and a 4-byte sequence
       yields two units — never more than n units in total, plus the terminator. */
    unsigned short *out = malloc((n + 1) * sizeof *out);
    if (out == NULL) {
        return NULL;
    }

    const unsigned char *p = (const unsigned char *)s;
    size_t i = 0, o = 0;
    while (i < n) {
        unsigned long cp;
        size_t len = decode(p + i, n - i, &cp);
        if (len == 0) {
            free(out);
            return NULL;
        }
        i += len;
        if (cp <= 0xFFFF) {
            out[o++] = (unsigned short)cp;
        } else {
            cp -= 0x10000;
            out[o++] = (unsigned short)(0xD800 + (cp >> 10));
            out[o++] = (unsigned short)(0xDC00 + (cp & 0x3FF));
        }
    }
    out[o] = 0;
    if (out_len != NULL) {
        *out_len = o;
    }
    return out;
}
