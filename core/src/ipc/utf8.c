#include "utf8.h"

#include <stdlib.h>
#include <string.h>

/*
 * Length of the well-formed UTF-8 sequence starting at s (with `n` bytes left),
 * or 0 when the bytes there are not one. The lead-byte ranges below are the
 * table from Unicode 15.0 §3.9 (Table 3-7), which excludes by construction the
 * three families a naive "count the high bits" check lets through:
 *
 *   - overlong forms      (C0/C1 ..; E0 80..9F ..; F0 80..8F ..)
 *   - UTF-16 surrogates   (ED A0..BF ..)  — never valid in UTF-8
 *   - beyond U+10FFFF     (F4 90.. ..; F5..FF)
 */
static size_t seq_len(const unsigned char *s, size_t n)
{
    unsigned char c = s[0];

    if (c < 0x80) {
        return 1;
    }

    size_t len;
    unsigned char min2, max2;   /* allowed range of the FIRST continuation byte */
    if (c >= 0xC2 && c <= 0xDF) {
        len = 2; min2 = 0x80; max2 = 0xBF;
    } else if (c == 0xE0) {
        len = 3; min2 = 0xA0; max2 = 0xBF;   /* E0 80..9F would be overlong */
    } else if (c == 0xED) {
        len = 3; min2 = 0x80; max2 = 0x9F;   /* ED A0..BF is a surrogate */
    } else if ((c >= 0xE1 && c <= 0xEC) || c == 0xEE || c == 0xEF) {
        len = 3; min2 = 0x80; max2 = 0xBF;
    } else if (c == 0xF0) {
        len = 4; min2 = 0x90; max2 = 0xBF;   /* F0 80..8F would be overlong */
    } else if (c >= 0xF1 && c <= 0xF3) {
        len = 4; min2 = 0x80; max2 = 0xBF;
    } else if (c == 0xF4) {
        len = 4; min2 = 0x80; max2 = 0x8F;   /* above that is > U+10FFFF */
    } else {
        return 0;   /* 0x80-0xBF (stray continuation), 0xC0, 0xC1, 0xF5-0xFF */
    }

    if (n < len) {
        return 0;   /* truncated at the end of the input */
    }
    if (s[1] < min2 || s[1] > max2) {
        return 0;
    }
    for (size_t k = 2; k < len; k++) {
        if ((s[k] & 0xC0) != 0x80) {
            return 0;
        }
    }
    return len;
}

int ipc_utf8_valid(const char *s)
{
    if (s == NULL) {
        return 1;
    }
    const unsigned char *p = (const unsigned char *)s;
    size_t n = strlen(s);
    size_t i = 0;
    while (i < n) {
        size_t len = seq_len(p + i, n - i);
        if (len == 0) {
            return 0;
        }
        i += len;
    }
    return 1;
}

char *ipc_utf8_repair(const char *s)
{
    if (s == NULL) {
        return NULL;
    }
    const unsigned char *p = (const unsigned char *)s;
    size_t n = strlen(s);

    /* Worst case every byte is ill-formed and becomes a 3-byte U+FFFD. */
    char *out = malloc(n * 3 + 1);
    if (out == NULL) {
        return NULL;
    }

    size_t i = 0, o = 0;
    while (i < n) {
        size_t len = seq_len(p + i, n - i);
        if (len > 0) {
            memcpy(out + o, p + i, len);
            o += len;
            i += len;
        } else {
            /* One replacement character per undecodable byte, so the damage
               stays proportional to the damage in the input. Written as a string
               literal because casting the constant bytes to a (signed) char is a
               truncation MSVC rejects under -Werror. */
            memcpy(out + o, "\xEF\xBF\xBD", 3);
            o += 3;
            i++;
        }
    }
    out[o] = '\0';
    return out;
}

cJSON *ipc_utf8_string(const char *s)
{
    if (s == NULL) {
        return cJSON_CreateString("");
    }
    /* Fast path: valid text is handed to cJSON untouched, no allocation of ours.
       This runs for every cell of every result, so it must stay a single pass. */
    if (ipc_utf8_valid(s)) {
        return cJSON_CreateString(s);
    }
    char *fixed = ipc_utf8_repair(s);
    if (fixed == NULL) {
        return NULL;
    }
    cJSON *item = cJSON_CreateString(fixed);
    free(fixed);
    return item;
}

cJSON *ipc_utf8_add_string(cJSON *obj, const char *key, const char *s)
{
    cJSON *item = ipc_utf8_string(s);
    if (item == NULL) {
        return NULL;
    }
    if (!cJSON_AddItemToObject(obj, key, item)) {
        cJSON_Delete(item);
        return NULL;
    }
    return item;
}
