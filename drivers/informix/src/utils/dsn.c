#include "dsn.h"

#include "cJSON.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Borrowed string field of root, or NULL when absent or empty. */
static const char *str_field(const cJSON *root, const char *key)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
    if (!cJSON_IsString(item) || item->valuestring == NULL || item->valuestring[0] == '\0') {
        return NULL;
    }
    return item->valuestring;
}

/* Copy s into dst[cap]; -1 when it does not fit. */
static int put(char *dst, size_t cap, const char *s)
{
    size_t n = s ? strlen(s) : 0;
    if (n >= cap) {
        return -1;
    }
    memcpy(dst, s ? s : "", n + 1);
    return 0;
}

static int parse_port(const cJSON *root, int *port)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(root, "port");
    if (item == NULL || cJSON_IsNull(item)) {
        *port = IFX_DEFAULT_PORT;
        return 0;
    }
    if (cJSON_IsNumber(item)) {
        *port = item->valueint;
    } else if (cJSON_IsString(item) && item->valuestring != NULL) {
        const char *s = item->valuestring;
        char *end;
        long v;
        if (*s == '\0') {
            *port = IFX_DEFAULT_PORT;
            return 0;
        }
        v = strtol(s, &end, 10);
        if (*end != '\0') {
            return -1; /* a service name: DRDA takes a number */
        }
        *port = (int)v;
    } else {
        return -1;
    }
    return *port > 0 && *port <= 65535 ? 0 : -1;
}

static int parse_tls(const char *s, int *tls)
{
    if (s == NULL || strcmp(s, "off") == 0 || strcmp(s, "disable") == 0) {
        *tls = IFX_TLS_OFF;
    } else if (strcmp(s, "require") == 0) {
        *tls = IFX_TLS_REQUIRE;
    } else if (strcmp(s, "verify-ca") == 0) {
        *tls = IFX_TLS_VERIFY_CA;
    } else if (strcmp(s, "verify-full") == 0) {
        *tls = IFX_TLS_VERIFY_FULL;
    } else {
        return -1;
    }
    return 0;
}

int informix_dsn_parse(const char *json, struct ifx_dsn *d, char *err, size_t errlen)
{
    cJSON *root = json != NULL ? cJSON_Parse(json) : NULL;
    const char *protocol, *msg = NULL;
    memset(d, 0, sizeof *d);
    if (root == NULL || !cJSON_IsObject(root)) {
        msg = "dsn must be a JSON object";
    } else if (str_field(root, "odbc_dsn") != NULL) {
        msg = "ODBC data sources are no longer supported: give host and port instead";
    } else if ((protocol = str_field(root, "protocol")) != NULL &&
               strcmp(protocol, "onsocssl") == 0 && str_field(root, "tls") == NULL) {
        msg = "protocol onsocssl is no longer used: set tls, on the port of a drsocssl listener";
    } else if (str_field(root, "host") == NULL) {
        msg = "dsn needs a host";
    } else if (str_field(root, "user") == NULL) {
        msg = "dsn needs a user";
    } else if (parse_port(root, &d->port) != 0) {
        msg = "port must be a number between 1 and 65535 (the DRDA listener, usually 9089)";
    } else if (parse_tls(str_field(root, "tls"), &d->tls) != 0) {
        msg = "tls must be empty, require, verify-ca or verify-full";
    } else if (put(d->host, sizeof d->host, str_field(root, "host")) != 0 ||
               put(d->database, sizeof d->database,
                   str_field(root, "database") ? str_field(root, "database") : "sysmaster") != 0 ||
               put(d->user, sizeof d->user, str_field(root, "user")) != 0 ||
               put(d->password, sizeof d->password, str_field(root, "password")) != 0 ||
               put(d->tls_ca, sizeof d->tls_ca, str_field(root, "tls_ca")) != 0 ||
               put(d->sqli_server, sizeof d->sqli_server, str_field(root, "sqli_server")) != 0) {
        msg = "a dsn value is too long";
    }
    cJSON_Delete(root);
    if (msg != NULL) {
        if (err != NULL && errlen > 0) {
            snprintf(err, errlen, "%s", msg);
        }
        return -1;
    }
    return 0;
}
