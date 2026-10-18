#include "query_parse.h"

#include <ctype.h>
#include <stdio.h>
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
    for (int i = 0; i < MONGO_MAX_ARGS; i++) {
        free(q->args[i]);
        q->args[i] = NULL;
    }
    q->nargs = 0;
}

/* Write the UTF-8 encoding of code point cp to out; returns bytes written. */
static size_t put_utf8(char *out, unsigned long cp)
{
    if (cp < 0x80) {
        out[0] = (char)cp;
        return 1;
    }
    if (cp < 0x800) {
        out[0] = (char)(0xC0 | (cp >> 6));
        out[1] = (char)(0x80 | (cp & 0x3F));
        return 2;
    }
    if (cp < 0x10000) {
        out[0] = (char)(0xE0 | (cp >> 12));
        out[1] = (char)(0x80 | ((cp >> 6) & 0x3F));
        out[2] = (char)(0x80 | (cp & 0x3F));
        return 3;
    }
    out[0] = (char)(0xF0 | (cp >> 18));
    out[1] = (char)(0x80 | ((cp >> 12) & 0x3F));
    out[2] = (char)(0x80 | ((cp >> 6) & 0x3F));
    out[3] = (char)(0x80 | (cp & 0x3F));
    return 4;
}

/* Parse 4 hex digits at p into *cp; 0 on a malformed escape. */
static int hex4(const char *p, unsigned long *cp)
{
    unsigned long v = 0;
    for (int i = 0; i < 4; i++) {
        char ch = p[i];
        v <<= 4;
        if (ch >= '0' && ch <= '9') {
            v |= (unsigned long)(ch - '0');
        } else if (ch >= 'a' && ch <= 'f') {
            v |= (unsigned long)(ch - 'a' + 10);
        } else if (ch >= 'A' && ch <= 'F') {
            v |= (unsigned long)(ch - 'A' + 10);
        } else {
            return 0;
        }
    }
    *cp = v;
    return 1;
}

char *mongo_unquote(const char *lit)
{
    if (lit == NULL) {
        return NULL;
    }
    lit = skip_ws(lit);
    char quote = lit[0];
    if (quote != '"' && quote != '\'') {
        return NULL;
    }
    /* The decoded form is never longer than the source. */
    char *out = malloc(strlen(lit) + 1);
    if (out == NULL) {
        return NULL;
    }
    size_t n = 0;
    const char *p = lit + 1;
    while (*p != '\0' && *p != quote) {
        if (*p != '\\') {
            out[n++] = *p++;
            continue;
        }
        p++;
        switch (*p) {
        case 'n': out[n++] = '\n'; p++; break;
        case 'r': out[n++] = '\r'; p++; break;
        case 't': out[n++] = '\t'; p++; break;
        case 'b': out[n++] = '\b'; p++; break;
        case 'f': out[n++] = '\f'; p++; break;
        case 'u': {
            unsigned long cp = 0, lo = 0;
            if (!hex4(p + 1, &cp)) {
                free(out);
                return NULL;
            }
            p += 5;
            if (cp >= 0xD800 && cp <= 0xDBFF && p[0] == '\\' && p[1] == 'u' &&
                hex4(p + 2, &lo) && lo >= 0xDC00 && lo <= 0xDFFF) {
                cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                p += 6;
            }
            n += put_utf8(out + n, cp);
            break;
        }
        case '\0':
            free(out);
            return NULL;
        default: /* \\ \" \' \/ and any other escaped char: the char itself */
            out[n++] = *p++;
            break;
        }
    }
    if (*p != quote || *skip_ws(p + 1) != '\0') {
        free(out);
        return NULL; /* unterminated, or trailing text after the literal */
    }
    out[n] = '\0';
    return out;
}

/*
 * The methods the driver runs besides find/findOne/aggregate. `shapes` gives the
 * expected first character of each argument: 'd' a document {..}, 'a' an array
 * [..], 'u' an update (document or pipeline array), 's' a string literal, 'x' a
 * document or a string. min_args..strlen(shapes) is the accepted arity.
 */
typedef struct {
    const char *name;
    mongo_op    op;
    int         needs_coll;  /* 1: db.<coll>.m(), 0: db.m() */
    int         min_args;
    const char *shapes;
} method_def;

static const method_def k_methods[] = {
    {"insertOne",        MONGO_OP_INSERT_ONE,        1, 1, "dd"},
    {"insertMany",       MONGO_OP_INSERT_MANY,       1, 1, "ad"},
    {"updateOne",        MONGO_OP_UPDATE_ONE,        1, 2, "dud"},
    {"updateMany",       MONGO_OP_UPDATE_MANY,       1, 2, "dud"},
    {"replaceOne",       MONGO_OP_REPLACE_ONE,       1, 2, "ddd"},
    {"deleteOne",        MONGO_OP_DELETE_ONE,        1, 1, "dd"},
    {"deleteMany",       MONGO_OP_DELETE_MANY,       1, 1, "dd"},
    {"countDocuments",   MONGO_OP_COUNT,             1, 0, "dd"},
    {"distinct",         MONGO_OP_DISTINCT,          1, 1, "sdd"},
    {"createIndex",      MONGO_OP_CREATE_INDEX,      1, 1, "dd"},
    {"dropIndex",        MONGO_OP_DROP_INDEX,        1, 1, "x"},
    {"getIndexes",       MONGO_OP_GET_INDEXES,       1, 0, ""},
    {"drop",             MONGO_OP_DROP,              1, 0, "d"},
    {"createCollection", MONGO_OP_CREATE_COLLECTION, 0, 1, "sd"},
    {"runCommand",       MONGO_OP_RUN_COMMAND,       0, 1, "xd"},
    {"createView",       MONGO_OP_CREATE_VIEW,       0, 3, "ssad"},
};

static const method_def *find_method(const char *name, size_t len)
{
    for (size_t i = 0; i < sizeof k_methods / sizeof k_methods[0]; i++) {
        if (strlen(k_methods[i].name) == len &&
            strncmp(k_methods[i].name, name, len) == 0) {
            return &k_methods[i];
        }
    }
    return NULL;
}

static int shape_ok(char shape, const char *text)
{
    char ch = text[0];
    switch (shape) {
    case 'd': return ch == '{';
    case 'a': return ch == '[';
    case 'u': return ch == '{' || ch == '[';
    case 's': return ch == '"' || ch == '\'';
    default:  return ch == '{' || ch == '"' || ch == '\''; /* 'x' */
    }
}

static const char *shape_name(char shape)
{
    switch (shape) {
    case 'd': return "a document";
    case 'a': return "an array";
    case 'u': return "an update document or pipeline";
    case 's': return "a string";
    default:  return "a document or a string";
    }
}

/* Slice + trim [start, end) into an owned string. */
static char *arg_dup(const char *start, const char *end)
{
    char *raw = dup_range(start, end);
    if (raw == NULL) {
        return NULL;
    }
    char *out = dup_cstr(trim(raw));
    free(raw);
    return out;
}

/* Fill out->args from the split arguments of a generic method. */
static int parse_generic(const method_def *m, const char **starts, const char **ends,
                         int argc, mongo_query *out, char *errbuf, size_t errlen)
{
    int max_args = (int)strlen(m->shapes);
    char msg[160];
    if (argc < 0 || argc > max_args) {
        snprintf(msg, sizeof msg, "%s() takes at most %d argument%s", m->name,
                 max_args, max_args == 1 ? "" : "s");
        set_err(errbuf, errlen, msg);
        return MONGO_PARSE_SYNTAX;
    }
    if (argc < m->min_args) {
        snprintf(msg, sizeof msg, "%s() needs at least %d argument%s", m->name,
                 m->min_args, m->min_args == 1 ? "" : "s");
        set_err(errbuf, errlen, msg);
        return MONGO_PARSE_SYNTAX;
    }
    for (int i = 0; i < argc; i++) {
        out->args[i] = arg_dup(starts[i], ends[i]);
        if (out->args[i] == NULL) {
            set_err(errbuf, errlen, "out of memory");
            return MONGO_PARSE_SYNTAX;
        }
        out->nargs = i + 1;
        if (!shape_ok(m->shapes[i], out->args[i])) {
            snprintf(msg, sizeof msg, "argument %d of %s() must be %s", i + 1,
                     m->name, shape_name(m->shapes[i]));
            set_err(errbuf, errlen, msg);
            return MONGO_PARSE_SYNTAX;
        }
    }
    return MONGO_PARSE_OK;
}

int mongo_query_parse(const char *input, mongo_query *out, char *errbuf, size_t errlen)
{
    if (out == NULL) {
        return MONGO_PARSE_SYNTAX;
    }
    memset(out, 0, sizeof(*out));
    out->limit = -1;
    out->skip = -1;
    int rc = MONGO_PARSE_SYNTAX;

    if (input == NULL) {
        set_err(errbuf, errlen, "empty query");
        return rc;
    }

    const char *p = skip_ws(input);
    if (strncmp(p, "db.", 3) != 0) {
        set_err(errbuf, errlen, "query must start with 'db.<collection>.' or 'db.'");
        return rc;
    }
    const char *coll_start = p + 3;

    /* db.getCollection("name").method(...): the name is a string literal, so any
       collection name (dashes, spaces, a name that collides with a db method)
       can be addressed. The method then follows the closing parenthesis. */
    char *named = NULL;
    if (strncmp(coll_start, "getCollection", 13) == 0 && *skip_ws(coll_start + 13) == '(') {
        const char *gopen = skip_ws(coll_start + 13);
        const char *gclose = match_bracket(gopen);
        const char *after = (gclose != NULL) ? skip_ws(gclose + 1) : NULL;
        char *lit = (gclose != NULL) ? dup_range(gopen + 1, gclose) : NULL;
        named = (lit != NULL) ? mongo_unquote(lit) : NULL;
        free(lit);
        if (named == NULL || named[0] == '\0' || after == NULL || *after != '.') {
            free(named);
            set_err(errbuf, errlen,
                    "expected db.getCollection(\"name\").<method>(...)");
            return rc;
        }
        coll_start = skip_ws(after + 1);
    }

    /* The operation is the identifier immediately before the first '('. The
       collection name is everything between "db." and the '.' that precedes
       that identifier — this tolerates dotted collection names (system.profile).
       With nothing between "db." and the identifier it is a db-level method. */
    const char *open = strchr(coll_start, '(');
    if (open == NULL) {
        free(named);
        set_err(errbuf, errlen, "expected a call such as 'db.<collection>.find(...)'");
        return rc;
    }
    const char *method_end = skip_ws_back(coll_start, open);
    const char *m = method_end;
    while (m > coll_start && isalpha((unsigned char)m[-1])) {
        m--;
    }
    const char *method = m;
    size_t method_len = (size_t)(method_end - method);
    int db_level = (named == NULL && m == coll_start);
    if (method_len == 0 || (named != NULL ? m != coll_start
                                          : (!db_level && m[-1] != '.'))) {
        free(named);
        set_err(errbuf, errlen, "expected 'db.<collection>.<method>(...)'");
        return rc;
    }
    const char *coll_end = m - 1; /* the '.' before the method */
    if (named == NULL && !db_level && coll_end <= coll_start) {
        set_err(errbuf, errlen, "missing collection name");
        return rc;
    }

    int is_find = (method_len == 4 && strncmp(method, "find", 4) == 0);
    int is_find_one = (method_len == 7 && strncmp(method, "findOne", 7) == 0);
    int is_aggregate = (method_len == 9 && strncmp(method, "aggregate", 9) == 0);
    const method_def *def = NULL;
    if (is_find || is_find_one || is_aggregate) {
        out->op = is_aggregate ? MONGO_OP_AGGREGATE : MONGO_OP_FIND;
        if (db_level) {
            free(named);
            set_err(errbuf, errlen, "expected 'db.<collection>.find/aggregate(...)'");
            return rc;
        }
    } else {
        def = find_method(method, method_len);
        if (def == NULL) {
            char msg[256];
            snprintf(msg, sizeof msg,
                     "unsupported operation '%.*s' (supported: find, findOne, aggregate, "
                     "countDocuments, distinct, insertOne/Many, updateOne/Many, replaceOne, "
                     "deleteOne/Many, createIndex, dropIndex, getIndexes, drop, "
                     "createCollection, createView, runCommand)",
                     (int)method_len, method);
            free(named);
            set_err(errbuf, errlen, msg);
            return MONGO_PARSE_UNSUPPORTED;
        }
        if ((def->needs_coll != 0) == db_level) {
            char msg[160];
            snprintf(msg, sizeof msg, def->needs_coll
                         ? "%s() runs on a collection: db.<collection>.%s(...)"
                         : "%s() runs on the database: db.%s(...)",
                     def->name, def->name);
            free(named);
            set_err(errbuf, errlen, msg);
            return rc;
        }
        out->op = def->op;
    }

    if (!db_level) {
        out->collection = (named != NULL) ? named : dup_range(coll_start, coll_end);
        named = NULL;
        if (out->collection == NULL) {
            set_err(errbuf, errlen, "out of memory");
            goto fail;
        }
    }

    const char *close = match_bracket(open);
    if (close == NULL) {
        set_err(errbuf, errlen, "unbalanced parentheses");
        goto fail;
    }

    const char *starts[MONGO_MAX_ARGS];
    const char *ends[MONGO_MAX_ARGS];
    int argc = split_args(open + 1, close, starts, ends, MONGO_MAX_ARGS);

    if (def != NULL) {
        rc = parse_generic(def, starts, ends, argc, out, errbuf, errlen);
        if (rc != MONGO_PARSE_OK) {
            goto fail;
        }
        const char *rest = skip_ws(close + 1);
        if (*rest != '\0' && *rest != ';') {
            set_err(errbuf, errlen, "unexpected characters after the call");
            rc = MONGO_PARSE_SYNTAX;
            goto fail;
        }
        return MONGO_PARSE_OK;
    }

    if (out->op == MONGO_OP_AGGREGATE) {
        if (argc < 0 || argc > 1) {
            set_err(errbuf, errlen, "aggregate() takes a single pipeline array");
            goto fail;
        }
        out->filter = (argc == 0) ? dup_cstr("[]") : arg_dup(starts[0], ends[0]);
        if (out->filter == NULL) {
            set_err(errbuf, errlen, "out of memory");
            goto fail;
        }
        /* No chained modifiers on aggregate (they would be pipeline stages). */
        const char *rest = skip_ws(close + 1);
        if (*rest != '\0' && *rest != ';') {
            set_err(errbuf, errlen, "unexpected characters after aggregate()");
            goto fail;
        }
        return MONGO_PARSE_OK;
    }

    /* find() / findOne(): 0..2 args -> filter [, projection]. */
    if (argc < 0 || argc > 2) {
        set_err(errbuf, errlen, is_find_one
                    ? "findOne() takes at most a filter and a projection"
                    : "find() takes at most a filter and a projection");
        goto fail;
    }
    out->filter = (argc == 0) ? dup_cstr("{}") : arg_dup(starts[0], ends[0]);
    if (out->filter != NULL && out->filter[0] == '\0') {
        free(out->filter);
        out->filter = dup_cstr("{}");
    }
    if (out->filter == NULL) {
        set_err(errbuf, errlen, "out of memory");
        goto fail;
    }
    if (argc == 2) {
        char *t = arg_dup(starts[1], ends[1]);
        if (t == NULL) {
            set_err(errbuf, errlen, "out of memory");
            goto fail;
        }
        if (t[0] != '\0') {
            out->projection = t;
        } else {
            free(t);
        }
    }

    if (is_find_one) {
        out->limit = 1;
        const char *rest = skip_ws(close + 1);
        if (*rest != '\0' && *rest != ';') {
            set_err(errbuf, errlen, "unexpected characters after findOne()");
            goto fail;
        }
        return MONGO_PARSE_OK;
    }
    if (parse_chain(close + 1, out, errbuf, errlen) != 0) {
        goto fail;
    }
    return MONGO_PARSE_OK;

fail:
    mongo_query_free(out);
    return rc;
}
