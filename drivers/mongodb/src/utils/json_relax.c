#include "json_relax.h"

#include <ctype.h>
#include <stdlib.h>
#include <string.h>

/* A small growable output buffer. */
typedef struct {
    char  *data;
    size_t len;
    size_t cap;
    int    oom;
} sbuf;

static void sb_putc(sbuf *b, char ch)
{
    if (b->oom) {
        return;
    }
    if (b->len + 1 >= b->cap) {
        size_t cap = b->cap == 0 ? 64 : b->cap * 2;
        char *grown = realloc(b->data, cap);
        if (grown == NULL) {
            b->oom = 1;
            return;
        }
        b->data = grown;
        b->cap = cap;
    }
    b->data[b->len++] = ch;
}

static int is_ident_start(char ch)
{
    return isalpha((unsigned char)ch) || ch == '_' || ch == '$';
}

static int is_ident_char(char ch)
{
    return isalnum((unsigned char)ch) || ch == '_' || ch == '$' || ch == '.';
}

/* Copy a double-quoted string starting at in[*i] (in[*i] == '"') verbatim,
   honoring backslash escapes, advancing *i past the closing quote. */
static void copy_dquote(sbuf *b, const char *in, size_t *i)
{
    sb_putc(b, in[(*i)++]); /* opening quote */
    while (in[*i] != '\0') {
        char ch = in[*i];
        if (ch == '\\' && in[*i + 1] != '\0') {
            sb_putc(b, ch);
            sb_putc(b, in[*i + 1]);
            *i += 2;
            continue;
        }
        sb_putc(b, ch);
        (*i)++;
        if (ch == '"') {
            return;
        }
    }
}

/* Rewrite a single-quoted string starting at in[*i] (in[*i] == '\'') as a
   double-quoted JSON string, advancing *i past the closing quote. */
static void rewrite_squote(sbuf *b, const char *in, size_t *i)
{
    (*i)++; /* skip opening ' */
    sb_putc(b, '"');
    while (in[*i] != '\0') {
        char ch = in[*i];
        if (ch == '\\' && in[*i + 1] != '\0') {
            char nx = in[*i + 1];
            if (nx == '\'') {
                sb_putc(b, '\''); /* \' -> ' (a bare ' is fine in JSON) */
            } else {
                sb_putc(b, '\\');
                sb_putc(b, nx);
            }
            *i += 2;
            continue;
        }
        if (ch == '\'') {
            (*i)++;
            sb_putc(b, '"');
            return;
        }
        if (ch == '"') {
            sb_putc(b, '\\'); /* escape a literal " inside the JSON string */
            sb_putc(b, '"');
            (*i)++;
            continue;
        }
        sb_putc(b, ch);
        (*i)++;
    }
    sb_putc(b, '"'); /* unterminated: close it so bson reports a clean error */
}

char *mongo_json_relax(const char *input)
{
    if (input == NULL) {
        return NULL;
    }

    sbuf b = {0};
    size_t i = 0;
    char prev = 0; /* last significant (non-space) source char emitted */

    while (input[i] != '\0') {
        char ch = input[i];

        if (isspace((unsigned char)ch)) {
            sb_putc(&b, ch);
            i++;
            continue;
        }
        if (ch == '"') {
            copy_dquote(&b, input, &i);
            prev = '"';
            continue;
        }
        if (ch == '\'') {
            rewrite_squote(&b, input, &i);
            prev = '"';
            continue;
        }
        /* A bare key: an identifier appearing right after '{' or ',' (i.e. in
           key position). Wrap it in double quotes. Identifiers elsewhere (JSON
           literals true/false/null, values) are left untouched. */
        if (is_ident_start(ch) && (prev == '{' || prev == ',')) {
            sb_putc(&b, '"');
            while (input[i] != '\0' && is_ident_char(input[i])) {
                sb_putc(&b, input[i]);
                i++;
            }
            sb_putc(&b, '"');
            prev = '"';
            continue;
        }

        sb_putc(&b, ch);
        prev = ch;
        i++;
    }

    if (b.oom) {
        free(b.data);
        return NULL;
    }
    sb_putc(&b, '\0');
    if (b.oom) {
        free(b.data);
        return NULL;
    }
    return b.data;
}
