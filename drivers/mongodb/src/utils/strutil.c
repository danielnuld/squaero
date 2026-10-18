#include "strutil.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int reserve(mongo_sb *b, size_t extra)
{
    if (b->oom) {
        return 0;
    }
    if (b->len + extra + 1 <= b->cap) {
        return 1;
    }
    size_t cap = b->cap == 0 ? 64 : b->cap;
    while (cap < b->len + extra + 1) {
        cap *= 2;
    }
    char *grown = realloc(b->data, cap);
    if (grown == NULL) {
        b->oom = 1;
        return 0;
    }
    b->data = grown;
    b->cap = cap;
    return 1;
}

void mongo_sb_putn(mongo_sb *b, const char *s, size_t n)
{
    if (n == 0 || !reserve(b, n)) {
        return;
    }
    memcpy(b->data + b->len, s, n);
    b->len += n;
}

void mongo_sb_putc(mongo_sb *b, char ch)
{
    mongo_sb_putn(b, &ch, 1);
}

void mongo_sb_puts(mongo_sb *b, const char *s)
{
    if (s != NULL) {
        mongo_sb_putn(b, s, strlen(s));
    }
}

char *mongo_sb_take(mongo_sb *b)
{
    char *out = NULL;
    if (!b->oom && reserve(b, 0)) {
        b->data[b->len] = '\0';
        out = b->data;
        b->data = NULL;
    }
    mongo_sb_free(b);
    return out;
}

void mongo_sb_free(mongo_sb *b)
{
    free(b->data);
    b->data = NULL;
    b->len = b->cap = 0;
    b->oom = 0;
}

void mongo_sb_js_string(mongo_sb *b, const char *s)
{
    mongo_sb_putc(b, '"');
    for (const char *p = s != NULL ? s : ""; *p != '\0'; p++) {
        unsigned char ch = (unsigned char)*p;
        switch (ch) {
        case '"':  mongo_sb_puts(b, "\\\""); break;
        case '\\': mongo_sb_puts(b, "\\\\"); break;
        case '\n': mongo_sb_puts(b, "\\n"); break;
        case '\r': mongo_sb_puts(b, "\\r"); break;
        case '\t': mongo_sb_puts(b, "\\t"); break;
        default:
            if (ch < 0x20) {
                char esc[8];
                snprintf(esc, sizeof esc, "\\u%04x", (unsigned)ch);
                mongo_sb_puts(b, esc);
            } else {
                mongo_sb_putc(b, (char)ch);
            }
        }
    }
    mongo_sb_putc(b, '"');
}

int mongo_name_is_simple(const char *name)
{
    if (name == NULL || name[0] == '\0') {
        return 0;
    }
    int seg_start = 1;  /* at the first char of a dot-separated segment */
    for (const char *p = name; *p != '\0'; p++) {
        char ch = *p;
        int alpha = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch == '_';
        int digit = (ch >= '0' && ch <= '9');
        if (ch == '.') {
            if (seg_start) {
                return 0;  /* leading dot or empty segment */
            }
            seg_start = 1;
            continue;
        }
        if (!(alpha || (digit && !seg_start))) {
            return 0;
        }
        seg_start = 0;
    }
    return !seg_start;  /* no trailing dot */
}

void mongo_sb_coll_ref(mongo_sb *b, const char *name)
{
    if (mongo_name_is_simple(name)) {
        mongo_sb_puts(b, "db.");
        mongo_sb_puts(b, name);
        return;
    }
    mongo_sb_puts(b, "db.getCollection(");
    mongo_sb_js_string(b, name);
    mongo_sb_putc(b, ')');
}
