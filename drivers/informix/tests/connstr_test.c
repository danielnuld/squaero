#include "connstr.h"

#include <stdio.h>
#include <string.h>

/* Unit tests for the pure ODBC connection-string builder. */

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

static int build(const struct informix_conn_params *p, char *buf, size_t n)
{
    return informix_build_conn_str(p, buf, n);
}

int main(void)
{
    char buf[2048];

    /* Driver-direct: defaults for driver + protocol; numeric service passed
       through by the caller as a string. */
    {
        struct informix_conn_params p = {
            .host = "10.0.0.5", .service = "1526", .server = "ol_inf",
            .database = "stores", .user = "informix", .password = "secret",
        };
        int len = build(&p, buf, sizeof buf);
        EXPECT(len > 0, "direct: builds");
        EXPECT(strcmp(buf,
                      "DRIVER={IBM INFORMIX ODBC DRIVER};Host=10.0.0.5;"
                      "Service=1526;Server=ol_inf;Protocol=onsoctcp;"
                      "Database=stores;Uid=informix;Pwd=secret;") == 0,
               "direct: exact connection string");
        EXPECT(len == (int)strlen(buf), "direct: returns length");
    }

    /* Driver-direct: explicit driver + protocol overrides. */
    {
        struct informix_conn_params p = {
            .driver = "My Driver", .protocol = "olsoctcp",
            .host = "h", .service = "svc", .server = "s",
        };
        EXPECT(build(&p, buf, sizeof buf) > 0, "override: builds");
        EXPECT(strstr(buf, "DRIVER={My Driver};") != NULL,
               "override: braces driver with space");
        EXPECT(strstr(buf, "Protocol=olsoctcp;") != NULL, "override: protocol");
    }

    /* ODBC DSN form ignores host/driver and emits DSN/Uid/Pwd. */
    {
        struct informix_conn_params p = {
            .odbc_dsn = "stores_demo", .user = "u", .password = "p",
            .host = "ignored", .server = "ignored",
        };
        EXPECT(build(&p, buf, sizeof buf) > 0, "dsn: builds");
        EXPECT(strcmp(buf, "DSN=stores_demo;Uid=u;Pwd=p;") == 0,
               "dsn: exact string");
    }

    /* Password with special characters is brace-quoted; a literal '}' doubles. */
    {
        struct informix_conn_params p = {
            .host = "h", .service = "s", .server = "srv",
            .password = "a;b=c}d",
        };
        EXPECT(build(&p, buf, sizeof buf) > 0, "special: builds");
        EXPECT(strstr(buf, "Pwd={a;b=c}}d};") != NULL,
               "special: braced + doubled brace");
    }

    /* Insufficient params: neither odbc_dsn nor host+service+server. */
    {
        struct informix_conn_params p = { .host = "h", .server = "s" }; /* no service */
        EXPECT(build(&p, buf, sizeof buf) == -1, "missing service -> error");

        struct informix_conn_params empty = { 0 };
        EXPECT(build(&empty, buf, sizeof buf) == -1, "empty params -> error");
    }

    /* Too-small buffer reports overflow rather than truncating silently. */
    {
        struct informix_conn_params p = {
            .host = "10.0.0.5", .service = "1526", .server = "ol_inf",
        };
        char small[16];
        EXPECT(build(&p, small, sizeof small) == -1, "overflow -> error");
    }

    /* NULL guards. */
    EXPECT(build(NULL, buf, sizeof buf) == -1, "NULL params -> error");
    {
        struct informix_conn_params p = { .odbc_dsn = "x" };
        EXPECT(informix_build_conn_str(&p, NULL, 10) == -1, "NULL buf -> error");
    }

    if (failures == 0) {
        printf("OK: informix connection-string builder (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
