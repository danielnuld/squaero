#include "txsql.h"

#include <ctype.h>
#include <string.h>

/* Skip blanks and -- / { } / C-style comments. */
static const char *skip_space(const char *p)
{
    for (;;) {
        while (*p && isspace((unsigned char)*p)) {
            p++;
        }
        if (p[0] == '-' && p[1] == '-') {
            while (*p && *p != '\n') {
                p++;
            }
        } else if (p[0] == '/' && p[1] == '*') {
            const char *e = strstr(p + 2, "*/");
            p = e ? e + 2 : p + strlen(p);
        } else if (p[0] == '{') {
            const char *e = strchr(p, '}');
            p = e ? e + 1 : p + strlen(p);
        } else {
            return p;
        }
    }
}

/* The word at p, case-insensitively; returns the text after it or NULL. */
static const char *word(const char *p, const char *w)
{
    size_t n = strlen(w), i;
    for (i = 0; i < n; i++) {
        if (tolower((unsigned char)p[i]) != w[i]) {
            return NULL;
        }
    }
    if (isalnum((unsigned char)p[n]) || p[n] == '_') {
        return NULL;
    }
    return p + n;
}

ifx_tx_stmt informix_tx_statement(const char *sql)
{
    static const struct {
        const char *w;
        ifx_tx_stmt kind;
    } kw[] = {
        {"begin", IFX_TX_BEGIN},
        {"commit", IFX_TX_COMMIT},
        {"rollback", IFX_TX_ROLLBACK},
    };
    const char *p;
    size_t i;
    if (sql == NULL) {
        return IFX_TX_NONE;
    }
    p = skip_space(sql);
    for (i = 0; i < sizeof kw / sizeof kw[0]; i++) {
        const char *q = word(p, kw[i].w), *r;
        if (q == NULL) {
            continue;
        }
        q = skip_space(q);
        if ((r = word(q, "work")) != NULL) {
            q = skip_space(r);
        }
        if (*q == ';') {
            q = skip_space(q + 1);
        }
        return *q == '\0' ? kw[i].kind : IFX_TX_NONE;
    }
    return IFX_TX_NONE;
}
