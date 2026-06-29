#include "connstr.h"

#include <string.h>

/* True if value needs brace-quoting in an ODBC connection string. */
static int needs_braces(const char *value)
{
    for (const char *p = value; *p != '\0'; p++) {
        if (*p == ';' || *p == '=' || *p == '{' || *p == '}' ||
            *p == ' ' || *p == '\t') {
            return 1;
        }
    }
    return value[0] == '\0';  /* empty value: brace it to keep the pair valid */
}

/*
 * Append "key=value;" to buf at *pos (capacity buflen). Brace-quotes value when
 * needed, doubling any '}'. Returns 0 on success, -1 if it would overflow.
 */
static int append_pair(char *buf, size_t buflen, size_t *pos,
                       const char *key, const char *value)
{
    size_t i = *pos;

    /* key= */
    for (const char *k = key; *k != '\0'; k++) {
        if (i + 1 >= buflen) {
            return -1;
        }
        buf[i++] = *k;
    }
    if (i + 1 >= buflen) {
        return -1;
    }
    buf[i++] = '=';

    int brace = needs_braces(value);
    if (brace) {
        if (i + 1 >= buflen) {
            return -1;
        }
        buf[i++] = '{';
    }
    for (const char *v = value; *v != '\0'; v++) {
        if (brace && *v == '}') {
            /* Escape a literal '}' by doubling it. */
            if (i + 1 >= buflen) {
                return -1;
            }
            buf[i++] = '}';
        }
        if (i + 1 >= buflen) {
            return -1;
        }
        buf[i++] = *v;
    }
    if (brace) {
        if (i + 1 >= buflen) {
            return -1;
        }
        buf[i++] = '}';
    }

    if (i + 1 >= buflen) {
        return -1;
    }
    buf[i++] = ';';

    buf[i] = '\0';
    *pos = i;
    return 0;
}

/* Treat NULL or "" as absent. */
static int present(const char *s)
{
    return s != NULL && s[0] != '\0';
}

int informix_build_conn_str(const struct informix_conn_params *p,
                            char *buf, size_t buflen)
{
    if (p == NULL || buf == NULL || buflen == 0) {
        return -1;
    }
    buf[0] = '\0';
    size_t pos = 0;

    if (present(p->odbc_dsn)) {
        if (append_pair(buf, buflen, &pos, "DSN", p->odbc_dsn) != 0) {
            return -1;
        }
        if (present(p->user) &&
            append_pair(buf, buflen, &pos, "Uid", p->user) != 0) {
            return -1;
        }
        if (present(p->password) &&
            append_pair(buf, buflen, &pos, "Pwd", p->password) != 0) {
            return -1;
        }
        return (int)pos;
    }

    /* Driver-direct: host + service + server are all required. */
    if (!present(p->host) || !present(p->service) || !present(p->server)) {
        return -1;
    }

    const char *driver = present(p->driver) ? p->driver : "IBM INFORMIX ODBC DRIVER";
    const char *protocol = present(p->protocol) ? p->protocol : "onsoctcp";

    if (append_pair(buf, buflen, &pos, "DRIVER", driver) != 0 ||
        append_pair(buf, buflen, &pos, "Host", p->host) != 0 ||
        append_pair(buf, buflen, &pos, "Service", p->service) != 0 ||
        append_pair(buf, buflen, &pos, "Server", p->server) != 0 ||
        append_pair(buf, buflen, &pos, "Protocol", protocol) != 0) {
        return -1;
    }
    if (present(p->database) &&
        append_pair(buf, buflen, &pos, "Database", p->database) != 0) {
        return -1;
    }
    if (present(p->user) &&
        append_pair(buf, buflen, &pos, "Uid", p->user) != 0) {
        return -1;
    }
    if (present(p->password) &&
        append_pair(buf, buflen, &pos, "Pwd", p->password) != 0) {
        return -1;
    }
    return (int)pos;
}
