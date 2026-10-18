#include "json_check.h"

#include <ctype.h>
#include <string.h>

#define MAX_DEPTH 64

static const char *ws(const char *p)
{
    while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') {
        p++;
    }
    return p;
}

/* Scan a number at p; returns the pointer past it or NULL. */
static const char *scan_number(const char *p, int *is_int)
{
    int integer = 1;
    if (*p == '-') {
        p++;
    }
    if (*p == '0') {
        p++;
    } else if (*p >= '1' && *p <= '9') {
        while (isdigit((unsigned char)*p)) {
            p++;
        }
    } else {
        return NULL;
    }
    if (*p == '.') {
        integer = 0;
        p++;
        if (!isdigit((unsigned char)*p)) {
            return NULL;
        }
        while (isdigit((unsigned char)*p)) {
            p++;
        }
    }
    if (*p == 'e' || *p == 'E') {
        integer = 0;
        p++;
        if (*p == '+' || *p == '-') {
            p++;
        }
        if (!isdigit((unsigned char)*p)) {
            return NULL;
        }
        while (isdigit((unsigned char)*p)) {
            p++;
        }
    }
    if (is_int != NULL) {
        *is_int = integer;
    }
    return p;
}

static const char *scan_string(const char *p)
{
    if (*p != '"') {
        return NULL;
    }
    p++;
    while (*p != '"') {
        unsigned char ch = (unsigned char)*p;
        if (ch == '\0' || ch < 0x20) {
            return NULL;
        }
        if (ch == '\\') {
            p++;
            if (*p == 'u') {
                for (int i = 1; i <= 4; i++) {
                    if (!isxdigit((unsigned char)p[i])) {
                        return NULL;
                    }
                }
                p += 4;
            } else if (strchr("\"\\/bfnrt", *p) == NULL || *p == '\0') {
                return NULL;
            }
        }
        p++;
    }
    return p + 1;
}

static const char *scan_value(const char *p, int depth)
{
    if (depth > MAX_DEPTH) {
        return NULL;
    }
    p = ws(p);
    switch (*p) {
    case '{': {
        p = ws(p + 1);
        if (*p == '}') {
            return p + 1;
        }
        for (;;) {
            p = scan_string(ws(p));
            if (p == NULL) {
                return NULL;
            }
            p = ws(p);
            if (*p != ':') {
                return NULL;
            }
            p = scan_value(p + 1, depth + 1);
            if (p == NULL) {
                return NULL;
            }
            p = ws(p);
            if (*p == ',') {
                p++;
                continue;
            }
            return *p == '}' ? p + 1 : NULL;
        }
    }
    case '[': {
        p = ws(p + 1);
        if (*p == ']') {
            return p + 1;
        }
        for (;;) {
            p = scan_value(p, depth + 1);
            if (p == NULL) {
                return NULL;
            }
            p = ws(p);
            if (*p == ',') {
                p++;
                continue;
            }
            return *p == ']' ? p + 1 : NULL;
        }
    }
    case '"':
        return scan_string(p);
    case 't':
        return strncmp(p, "true", 4) == 0 ? p + 4 : NULL;
    case 'f':
        return strncmp(p, "false", 5) == 0 ? p + 5 : NULL;
    case 'n':
        return strncmp(p, "null", 4) == 0 ? p + 4 : NULL;
    default:
        return scan_number(p, NULL);
    }
}

int mongo_json_valid(const char *text)
{
    if (text == NULL) {
        return 0;
    }
    const char *end = scan_value(text, 0);
    return end != NULL && *ws(end) == '\0';
}

int mongo_json_is_number(const char *text, int *is_int)
{
    if (text == NULL) {
        return 0;
    }
    const char *end = scan_number(text, is_int);
    return end != NULL && *end == '\0';
}
