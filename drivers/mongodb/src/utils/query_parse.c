#include "query_parse.h"

#include <ctype.h>
#include <stdlib.h>
#include <string.h>

static void set_err(char *errbuf, size_t errlen, const char *msg)
{
    if (errbuf == NULL || errlen == 0) {
        return;
    }
    size_t n = strlen(msg);
    if (n >= errlen) {
        n = errlen - 1;
    }
    memcpy(errbuf, msg, n);
    errbuf[n] = '\0';
}

static const char *skip_ws(const char *p)
{
    while (*p != '\0' && isspace((unsigned char)*p)) {
        p++;
    }
    return p;
}

/* Return the pointer just past the last non-space char in [start, end). */
static const char *skip_ws_back(const char *start, const char *end)
{
    while (end > start && isspace((unsigned char)end[-1])) {
        end--;
    }
    return end;
}

/*
 * Given p pointing at an opening bracket (one of '(', '{', '['), return a
 * pointer to the matching closer, honoring nested brackets and skipping over
 * quoted strings (both '"' and '\'' with backslash escapes). Returns NULL if
 * the brackets are unbalanced or a string is unterminated.
 */
static const char *match_bracket(const char *p)
{
    /* A small explicit stack of expected closers. MongoDB queries are shallow;
       a fixed depth is plenty and avoids a heap allocation in the parser. */
    char stack[64];
    int depth = 0;

    for (;;) {
        char ch = *p;
        if (ch == '\0') {
            return NULL; /* ran off the end: unbalanced */
        }
        if (ch == '"' || ch == '\'') {
            char quote = ch;
            p++;
            while (*p != '\0' && *p != quote) {
                if (*p == '\\' && p[1] != '\0') {
                    p++; /* skip the escaped char */
                }
                p++;
            }
            if (*p == '\0') {
                return NULL; /* unterminated string */
            }
            p++; /* past the closing quote */
            continue;
        }
        if (ch == '(' || ch == '{' || ch == '[') {
            if (depth >= (int)sizeof(stack)) {
                return NULL; /* nesting too deep */
            }
            stack[depth++] = (ch == '(') ? ')' : (ch == '{') ? '}' : ']';
            p++;
            continue;
        }
        if (ch == ')' || ch == '}' || ch == ']') {
            if (depth == 0 || stack[depth - 1] != ch) {
                return NULL; /* mismatched closer */
            }
            depth--;
            if (depth == 0) {
                return p; /* matched the outermost bracket */
            }
            p++;
            continue;
        }
        p++;
    }
}

/* Duplicate [start, end) into a fresh NUL-terminated string, or NULL on OOM. */
static char *dup_range(const char *start, const char *end)
{
    size_t n = (size_t)(end - start);
    char *s = malloc(n + 1);
    if (s == NULL) {
        return NULL;
    }
    memcpy(s, start, n);
    s[n] = '\0';
    return s;
}

/* Owned copy of a whole C string, or NULL on OOM. */
static char *dup_cstr(const char *s)
{
    return dup_range(s, s + strlen(s));
}

/* Trim leading/trailing whitespace in place, returning the (possibly shifted)
   start; the string is mutated so the trailing space becomes a NUL. */
static char *trim(char *s)
{
    char *start = (char *)skip_ws(s);
    size_t n = strlen(start);
    while (n > 0 && isspace((unsigned char)start[n - 1])) {
        start[--n] = '\0';
    }
    return start;
}

/*
 * Split the raw text between an operation's parentheses into top-level,
 * comma-separated argument spans (respecting nested brackets/strings). Writes up
 * to max_args (start,end) pairs and returns the count, or -1 if there are more
 * than max_args arguments. An all-whitespace body yields 0 arguments.
 */
static int split_args(const char *body, const char *body_end,
                      const char **starts, const char **ends, int max_args)
{
    const char *p = skip_ws(body);
    if (p >= body_end) {
        return 0; /* empty argument list */
    }
    int n = 0;
    const char *arg_start = p;
    while (p < body_end) {
        char ch = *p;
        if (ch == '(' || ch == '{' || ch == '[') {
            const char *close = match_bracket(p);
            if (close == NULL || close >= body_end) {
                return -1;
            }
            p = close + 1;
            continue;
        }
        if (ch == '"' || ch == '\'') {
            char quote = ch;
            p++;
            while (p < body_end && *p != quote) {
                if (*p == '\\' && p + 1 < body_end) {
                    p++;
                }
                p++;
            }
            if (p >= body_end) {
                return -1;
            }
            p++;
            continue;
        }
        if (ch == ',') {
            if (n >= max_args) {
                return -1;
            }
            starts[n] = arg_start;
            ends[n] = p;
            n++;
            p = skip_ws(p + 1);
            arg_start = p;
            continue;
        }
        p++;
    }
    if (n >= max_args) {
        return -1;
    }
    starts[n] = arg_start;
    ends[n] = body_end;
    n++;
    return n;
}

/* Parse a chained .sort()/.skip()/.limit() suffix (find only). p points just
   past the operation's closing ')'. Returns 0 on success, non-zero on error. */
static int parse_chain(const char *p, mongo_query *out, char *errbuf, size_t errlen)
{
    for (;;) {
        p = skip_ws(p);
        if (*p == '\0' || *p == ';') {
            return 0;
        }
        if (*p != '.') {
            set_err(errbuf, errlen, "unexpected trailing characters after the query");
            return 1;
        }
        p = skip_ws(p + 1);
        const char *name = p;
        while (isalpha((unsigned char)*p)) {
            p++;
        }
        size_t namelen = (size_t)(p - name);
        p = skip_ws(p);
        if (*p != '(') {
            set_err(errbuf, errlen, "expected '(' after chained method");
            return 1;
        }
        const char *close = match_bracket(p);
        if (close == NULL) {
            set_err(errbuf, errlen, "unbalanced parentheses in chained method");
            return 1;
        }
        char *raw = dup_range(p + 1, close);
        if (raw == NULL) {
            set_err(errbuf, errlen, "out of memory");
            return 1;
        }
        char *arg = trim(raw);

        if (namelen == 4 && strncmp(name, "sort", 4) == 0) {
            free(out->sort);
            out->sort = dup_cstr(arg);
            if (out->sort == NULL) {
                free(raw);
                set_err(errbuf, errlen, "out of memory");
                return 1;
            }
            free(raw);
        } else if ((namelen == 5 && strncmp(name, "limit", 5) == 0) ||
                   (namelen == 4 && strncmp(name, "skip", 4) == 0)) {
            char *endp = NULL;
            long v = strtol(arg, &endp, 10);
            endp = (char *)skip_ws(endp);
            if (arg[0] == '\0' || *endp != '\0' || v < 0) {
                free(raw);
                set_err(errbuf, errlen,
                        "limit()/skip() take a non-negative integer");
                return 1;
            }
            if (namelen == 5) {
                out->limit = v;
            } else {
                out->skip = v;
            }
            free(raw);
        } else {
            free(raw);
            set_err(errbuf, errlen,
                    "unsupported chained method (only sort/skip/limit)");
            return 1;
        }
        p = close + 1;
    }
}

void mongo_query_free(mongo_query *q)
{
    if (q == NULL) {
        return;
    }
    free(q->collection);
    free(q->filter);
    free(q->projection);
    free(q->sort);
    q->collection = q->filter = q->projection = q->sort = NULL;
}

int mongo_query_parse(const char *input, mongo_query *out, char *errbuf, size_t errlen)
{
    if (out == NULL) {
        return 1;
    }
    memset(out, 0, sizeof(*out));
    out->limit = -1;
    out->skip = -1;

    if (input == NULL) {
        set_err(errbuf, errlen, "empty query");
        return 1;
    }

    const char *p = skip_ws(input);
    if (strncmp(p, "db.", 3) != 0) {
        set_err(errbuf, errlen, "query must start with 'db.<collection>.'");
        return 1;
    }
    const char *coll_start = p + 3;

    /* The operation is the identifier immediately before the first '('. The
       collection name is everything between "db." and the '.' that precedes
       that identifier — this tolerates dotted collection names (system.profile). */
    const char *open = strchr(coll_start, '(');
    if (open == NULL) {
        set_err(errbuf, errlen, "expected 'find(...)' or 'aggregate(...)'");
        return 1;
    }
    const char *method_end = (const char *)skip_ws_back(coll_start, open);
    /* method identifier runs backwards from method_end over [A-Za-z] */
    const char *m = method_end;
    while (m > coll_start && isalpha((unsigned char)m[-1])) {
        m--;
    }
    const char *method = m;
    size_t method_len = (size_t)(method_end - method);
    if (method_len == 0 || m == coll_start || m[-1] != '.') {
        set_err(errbuf, errlen, "expected 'db.<collection>.find/aggregate(...)'");
        return 1;
    }
    const char *coll_end = m - 1; /* the '.' before the method */
    if (coll_end <= coll_start) {
        set_err(errbuf, errlen, "missing collection name");
        return 1;
    }

    if (method_len == 4 && strncmp(method, "find", 4) == 0) {
        out->op = MONGO_OP_FIND;
    } else if (method_len == 9 && strncmp(method, "aggregate", 9) == 0) {
        out->op = MONGO_OP_AGGREGATE;
    } else {
        set_err(errbuf, errlen, "unsupported operation (only find and aggregate)");
        return 1;
    }

    out->collection = dup_range(coll_start, coll_end);
    if (out->collection == NULL) {
        set_err(errbuf, errlen, "out of memory");
        goto fail;
    }

    const char *close = match_bracket(open);
    if (close == NULL) {
        set_err(errbuf, errlen, "unbalanced parentheses");
        goto fail;
    }

    const char *starts[3];
    const char *ends[3];
    int argc = split_args(open + 1, close, starts, ends, 3);

    if (out->op == MONGO_OP_AGGREGATE) {
        if (argc < 0 || argc > 1) {
            set_err(errbuf, errlen, "aggregate() takes a single pipeline array");
            goto fail;
        }
        if (argc == 0) {
            out->filter = dup_cstr("[]");
        } else {
            char *raw = dup_range(starts[0], ends[0]);
            if (raw == NULL) { set_err(errbuf, errlen, "out of memory"); goto fail; }
            out->filter = dup_cstr(trim(raw));
            free(raw);
        }
        if (out->filter == NULL) { set_err(errbuf, errlen, "out of memory"); goto fail; }
        /* No chained modifiers on aggregate (they would be pipeline stages). */
        const char *rest = skip_ws(close + 1);
        if (*rest != '\0' && *rest != ';') {
            set_err(errbuf, errlen, "unexpected characters after aggregate()");
            goto fail;
        }
        return 0;
    }

    /* find(): 0..2 args -> filter [, projection]. */
    if (argc < 0 || argc > 2) {
        set_err(errbuf, errlen, "find() takes at most a filter and a projection");
        goto fail;
    }
    if (argc == 0) {
        out->filter = dup_cstr("{}");
    } else {
        char *raw = dup_range(starts[0], ends[0]);
        if (raw == NULL) { set_err(errbuf, errlen, "out of memory"); goto fail; }
        out->filter = dup_cstr(trim(raw));
        free(raw);
    }
    if (out->filter == NULL) { set_err(errbuf, errlen, "out of memory"); goto fail; }
    if (out->filter[0] == '\0') {
        free(out->filter);
        out->filter = dup_cstr("{}");
        if (out->filter == NULL) { set_err(errbuf, errlen, "out of memory"); goto fail; }
    }
    if (argc == 2) {
        char *raw = dup_range(starts[1], ends[1]);
        if (raw == NULL) { set_err(errbuf, errlen, "out of memory"); goto fail; }
        char *t = trim(raw);
        if (t[0] != '\0') {
            out->projection = dup_cstr(t);
        }
        free(raw);
        if (t[0] != '\0' && out->projection == NULL) {
            set_err(errbuf, errlen, "out of memory");
            goto fail;
        }
    }

    if (parse_chain(close + 1, out, errbuf, errlen) != 0) {
        goto fail;
    }
    return 0;

fail:
    mongo_query_free(out);
    return 1;
}
