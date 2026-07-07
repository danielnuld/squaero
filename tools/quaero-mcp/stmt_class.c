#include "stmt_class.h"

#include <ctype.h>
#include <stdlib.h>
#include <string.h>

/* Leading keywords that begin a provably read-only statement. Anything else is
   treated as a write (fail-closed). `WITH` is handled separately because a CTE
   can wrap a data-modifying statement. */
static const char *const READ_LEADERS[] = {
    "SELECT", "EXPLAIN", "SHOW", "DESCRIBE", "DESC", "VALUES", "TABLE",
};

/* Whole-word tokens that, if present anywhere in a `WITH` statement, mark it as
   a write (PostgreSQL allows data-modifying CTEs). Fail-closed: a superset. */
static const char *const WRITE_TOKENS[] = {
    "INSERT",  "UPDATE",  "DELETE",   "MERGE",    "CREATE",   "DROP",
    "ALTER",   "TRUNCATE","REPLACE",  "GRANT",    "REVOKE",   "CALL",
    "EXEC",    "EXECUTE", "SET",      "LOCK",     "UNLOCK",   "RENAME",
    "COMMENT", "ATTACH",  "DETACH",   "VACUUM",   "REINDEX",  "COPY",
    "LOAD",    "PRAGMA",  "UPSERT",   "IMPORT",
};

static int iequal(const char *a, const char *b, size_t n)
{
    for (size_t i = 0; i < n; i++) {
        if (toupper((unsigned char)a[i]) != toupper((unsigned char)b[i])) {
            return 0;
        }
    }
    return 1;
}

/* True when [tok, tok+len) equals `word` (case-insensitive, exact length). */
static int word_is(const char *tok, size_t len, const char *word)
{
    return len == strlen(word) && iequal(tok, word, len);
}

/*
 * Copy `sql` into `out` while neutralizing everything that could hide a
 * keyword or a statement separator: line/block comments become spaces, and the
 * *contents* of quoted strings/identifiers become spaces (the delimiters are
 * kept so structure is preserved). `backslash_escapes` selects whether a
 * backslash inside a string escapes the next character (MySQL default) or is an
 * ordinary character (ANSI). Both interpretations are classified by the caller
 * and combined fail-closed, so a quote-escaping trick cannot smuggle a write
 * past the gate.
 */
static void normalize(const char *sql, char *out, int backslash_escapes)
{
    size_t o = 0;
    for (size_t i = 0; sql[i] != '\0';) {
        char c = sql[i];
        /* Comments (outside strings). */
        if (c == '-' && sql[i + 1] == '-') {
            while (sql[i] != '\0' && sql[i] != '\n') {
                out[o++] = ' ';
                i++;
            }
            continue;
        }
        if (c == '/' && sql[i + 1] == '*') {
            out[o++] = ' ';
            out[o++] = ' ';
            i += 2;
            while (sql[i] != '\0' && !(sql[i] == '*' && sql[i + 1] == '/')) {
                out[o++] = ' ';
                i++;
            }
            if (sql[i] != '\0') {
                out[o++] = ' ';
                out[o++] = ' ';
                i += 2;
            }
            continue;
        }
        /* String / quoted-identifier literal. */
        if (c == '\'' || c == '"' || c == '`') {
            char q = c;
            out[o++] = c; /* keep the opening delimiter */
            i++;
            while (sql[i] != '\0') {
                if (backslash_escapes && sql[i] == '\\' && sql[i + 1] != '\0') {
                    out[o++] = ' ';
                    out[o++] = ' ';
                    i += 2;
                    continue;
                }
                if (sql[i] == q) {
                    if (sql[i + 1] == q) { /* doubled => escaped delimiter */
                        out[o++] = ' ';
                        out[o++] = ' ';
                        i += 2;
                        continue;
                    }
                    out[o++] = q; /* closing delimiter */
                    i++;
                    break;
                }
                out[o++] = ' ';
                i++;
            }
            continue;
        }
        out[o++] = c;
        i++;
    }
    out[o] = '\0';
}

/* Classify one already-normalized statement (no comments, blanked strings). */
static stmt_class_t classify_statement(const char *s, size_t len)
{
    /* Skip leading whitespace and stray opening parens (e.g. "(SELECT ...)"). */
    size_t i = 0;
    while (i < len && (isspace((unsigned char)s[i]) || s[i] == '(')) {
        i++;
    }
    if (i >= len) {
        return STMT_EMPTY;
    }
    /* First keyword token. */
    size_t start = i;
    while (i < len && (isalpha((unsigned char)s[i]) || s[i] == '_')) {
        i++;
    }
    size_t wlen = i - start;
    if (wlen == 0) {
        return STMT_WRITE; /* starts with something non-alphabetic => not proven read */
    }
    const char *tok = s + start;

    if (word_is(tok, wlen, "WITH")) {
        /* A CTE is read-only only if it contains no write token anywhere. */
        for (size_t j = 0; j < len;) {
            if (isalpha((unsigned char)s[j]) || s[j] == '_') {
                size_t ts = j;
                while (j < len && (isalpha((unsigned char)s[j]) || s[j] == '_')) {
                    j++;
                }
                for (size_t k = 0; k < sizeof WRITE_TOKENS / sizeof *WRITE_TOKENS;
                     k++) {
                    if (word_is(s + ts, j - ts, WRITE_TOKENS[k])) {
                        return STMT_WRITE;
                    }
                }
            } else {
                j++;
            }
        }
        return STMT_READ;
    }

    for (size_t k = 0; k < sizeof READ_LEADERS / sizeof *READ_LEADERS; k++) {
        if (word_is(tok, wlen, READ_LEADERS[k])) {
            return STMT_READ;
        }
    }
    return STMT_WRITE;
}

/* Split `norm` on top-level ';' and combine per-statement verdicts. */
static stmt_class_t classify_normalized(const char *norm)
{
    stmt_class_t overall = STMT_EMPTY;
    size_t start = 0;
    for (size_t i = 0;; i++) {
        if (norm[i] == ';' || norm[i] == '\0') {
            stmt_class_t c = classify_statement(norm + start, i - start);
            if (c == STMT_WRITE) {
                return STMT_WRITE; /* fail-closed: any write taints the batch */
            }
            if (c == STMT_READ) {
                overall = STMT_READ;
            }
            start = i + 1;
            if (norm[i] == '\0') {
                break;
            }
        }
    }
    return overall;
}

stmt_class_t stmt_classify(const char *sql)
{
    if (sql == NULL || sql[0] == '\0') {
        return STMT_EMPTY;
    }
    size_t n = strlen(sql);
    char *buf = (char *)malloc(n + 1);
    if (buf == NULL) {
        return STMT_WRITE; /* fail-closed on OOM */
    }

    /* Classify under both escape conventions; only READ if both agree READ. */
    stmt_class_t combined = STMT_EMPTY;
    for (int mode = 0; mode < 2; mode++) {
        normalize(sql, buf, mode);
        stmt_class_t c = classify_normalized(buf);
        if (c == STMT_WRITE) {
            combined = STMT_WRITE;
            break;
        }
        if (c == STMT_READ) {
            combined = STMT_READ;
        }
    }
    free(buf);
    return combined;
}
