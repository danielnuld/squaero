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

static void sb_puts(sbuf *b, const char *s)
{
    while (*s != '\0') {
        sb_putc(b, *s++);
    }
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

/* The mongosh value constructors rewritten to their Extended-JSON form. */
static const struct {
    const char *name;
    const char *key;   /* the wrapper key, e.g. "$oid" */
} k_ctors[] = {
    {"ObjectId", "$oid"},
    {"ISODate", "$date"},
    {"Date", "$date"},
    {"NumberLong", "$numberLong"},
    {"NumberInt", "$numberInt"},
    {"NumberDecimal", "$numberDecimal"},
};

static const char *skip_sp(const char *p)
{
    while (*p != '\0' && isspace((unsigned char)*p)) {
        p++;
    }
    return p;
}

/*
 * Try to rewrite  Ctor("text")  /  Ctor('text')  /  Ctor(123)  at in[*i] (the
 * identifier start) as  {"$key":"text"}.  Returns 1 and advances *i past the
 * closing ')' on success; 0 (nothing consumed) when the text is not one of the
 * known constructors with a single string/number argument.
 */
static int rewrite_ctor(sbuf *b, const char *in, size_t *i)
{
    size_t len = 0;
    while (is_ident_char(in[*i + len])) {
        len++;
    }
    const char *key = NULL;
    for (size_t k = 0; k < sizeof k_ctors / sizeof k_ctors[0]; k++) {
        if (strlen(k_ctors[k].name) == len &&
            strncmp(k_ctors[k].name, in + *i, len) == 0) {
            key = k_ctors[k].key;
            break;
        }
    }
    if (key == NULL) {
        return 0;
    }
    const char *p = skip_sp(in + *i + len);
    if (*p != '(') {
        return 0;
    }
    p = skip_sp(p + 1);

    sbuf arg = {0};
    if (*p == '"' || *p == '\'') {
        size_t j = (size_t)(p - in);
        if (*p == '"') {
            copy_dquote(&arg, in, &j);
        } else {
            rewrite_squote(&arg, in, &j);
        }
        p = in + j;
    } else if (*p == '-' || *p == '+' || isdigit((unsigned char)*p)) {
        sb_putc(&arg, '"');
        while (*p == '-' || *p == '+' || *p == '.' || *p == 'e' || *p == 'E' ||
               isdigit((unsigned char)*p)) {
            sb_putc(&arg, *p++);
        }
        sb_putc(&arg, '"');
    } else {
        free(arg.data);
        return 0;
    }
    p = skip_sp(p);
    if (arg.oom || *p != ')') {
        free(arg.data);
        return 0;
    }
    sb_putc(&arg, '\0');
    sb_putc(b, '{');
    sb_putc(b, '"');
    sb_puts(b, key);
    sb_putc(b, '"');
    sb_putc(b, ':');
    if (!arg.oom) {
        sb_puts(b, arg.data);
    }
    sb_putc(b, '}');
    free(arg.data);
    *i = (size_t)(p - in) + 1;
    return 1;
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
        if (is_ident_start(ch)) {
            /* A bare key: an identifier in key position (right after '{' or ',')
               and followed by ':'. Wrap it in double quotes. An identifier
               elsewhere (the literals true/false/null, a value) is left alone. */
            size_t len = 0;
            while (is_ident_char(input[i + len])) {
                len++;
            }
            if ((prev == '{' || prev == ',') && *skip_sp(input + i + len) == ':') {
                sb_putc(&b, '"');
                for (size_t k = 0; k < len; k++) {
                    sb_putc(&b, input[i + k]);
                }
                sb_putc(&b, '"');
                i += len;
                prev = '"';
                continue;
            }
            /* mongosh "new Date(..)": the keyword adds nothing to Extended JSON. */
            if (len == 3 && strncmp(input + i, "new", 3) == 0 &&
                isspace((unsigned char)input[i + 3])) {
                i = (size_t)(skip_sp(input + i + 3) - input);
                continue;
            }
            if (rewrite_ctor(&b, input, &i)) {
                prev = '}';
                continue;
            }
            for (size_t k = 0; k < len; k++) {
                sb_putc(&b, input[i + k]);
            }
            i += len;
            prev = input[i - 1];
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
