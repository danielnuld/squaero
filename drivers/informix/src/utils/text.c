#include "text.h"

#include <stdlib.h>
#include <string.h>

/* True when [s, s+n) is well-formed UTF-8. Lead-byte ranges per Unicode Table 3-7,
   so overlong forms, surrogates and anything above U+10FFFF are rejected: a
   decoder is free to reject or substitute those, and that ambiguity is what breaks
   the transport. */
static int valid_utf8(const unsigned char *s, size_t n)
{
    size_t i = 0;
    while (i < n) {
        unsigned char c = s[i];
        if (c < 0x80) {
            i++;
            continue;
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

        if (n - i < len || s[i + 1] < min2 || s[i + 1] > max2) {
            return 0;
        }
        for (size_t k = 2; k < len; k++) {
            if ((s[i + k] & 0xC0) != 0x80) {
                return 0;
            }
        }
        i += len;
    }
    return 1;
}

/* Bytes needed to widen [s, s+n) from Latin-1 to UTF-8, including the NUL. */
static size_t widened_size(const unsigned char *s, size_t n)
{
    size_t need = 1;
    for (size_t i = 0; i < n; i++) {
        need += (s[i] < 0x80) ? 1 : 2;
    }
    return need;
}

/* Widen [s, s+n) from Latin-1 into `out`, which must hold widened_size() bytes.
   Every byte 0x80-0xFF becomes the two-byte UTF-8 form of the same code point. */
static void widen(const unsigned char *s, size_t n, char *out)
{
    char *o = out;
    for (size_t i = 0; i < n; i++) {
        unsigned char c = s[i];
        if (c < 0x80) {
            *o++ = (char)c;
        } else {
            *o++ = (char)(0xC0 | (c >> 6));
            *o++ = (char)(0x80 | (c & 0x3F));
        }
    }
    *o = '\0';
}

int ifx_text_is_utf8(const char *s)
{
    if (s == NULL) {
        return 1;
    }
    return valid_utf8((const unsigned char *)s, strlen(s));
}

const char *ifx_text_to_utf8(const char *s, char **buf, size_t *cap)
{
    if (s == NULL) {
        return NULL;
    }
    const unsigned char *raw = (const unsigned char *)s;
    size_t n = strlen(s);
    if (valid_utf8(raw, n)) {
        return s;   /* the common path: nothing copied, nothing allocated */
    }

    size_t need = widened_size(raw, n);
    if (need > *cap) {
        char *nb = realloc(*buf, need);
        if (nb == NULL) {
            return NULL;
        }
        *buf = nb;
        *cap = need;
    }
    widen(raw, n, *buf);
    return *buf;
}

char *ifx_text_to_utf8_dup(const char *s)
{
    if (s == NULL) {
        return NULL;
    }
    const unsigned char *raw = (const unsigned char *)s;
    size_t n = strlen(s);

    if (valid_utf8(raw, n)) {
        char *copy = malloc(n + 1);
        if (copy != NULL) {
            memcpy(copy, s, n + 1);
        }
        return copy;
    }

    char *out = malloc(widened_size(raw, n));
    if (out != NULL) {
        widen(raw, n, out);
    }
    return out;
}

void ifx_text_fix_utf8_inplace(char *buf, size_t cap)
{
    if (buf == NULL || cap == 0) {
        return;
    }
    if (ifx_text_is_utf8(buf)) {
        return;
    }

    char *fixed = ifx_text_to_utf8_dup(buf);
    if (fixed == NULL) {
        /* Cannot widen; the text would still break the transport, so drop the
           bytes that cannot be represented rather than pass them on. */
        size_t keep = 0;
        while (buf[keep] != '\0' && (unsigned char)buf[keep] < 0x80) {
            keep++;
        }
        buf[keep] = '\0';
        return;
    }

    size_t n = strlen(fixed);
    if (n > cap - 1) {
        n = cap - 1;
        /* Do not cut a multi-byte sequence in half: that would leave exactly the
           invalid tail this function exists to remove. */
        while (n > 0 && ((unsigned char)fixed[n] & 0xC0) == 0x80) {
            n--;
        }
    }
    memcpy(buf, fixed, n);
    buf[n] = '\0';
    free(fixed);
}
