#include "connstr.h"

#include <stdio.h>
#include <string.h>

/* Unit tests for the pure connection-string builder of the SQLI fallback. */

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

    /* Nominal: no DRIVER= (the CSDK is loaded directly), onsoctcp, UTF-8. */
    {
        struct informix_conn_params p = {
            .host = "10.0.0.5", .service = "9088", .server = "ol_inf",
            .database = "stores", .user = "informix", .password = "secret",
        };
        int len = build(&p, buf, sizeof buf);
        EXPECT(len > 0, "nominal: builds");
        EXPECT(strcmp(buf,
                      "Host=10.0.0.5;Service=9088;Server=ol_inf;"
                      "Protocol=onsoctcp;Database=stores;Uid=informix;"
                      "Pwd=secret;CLIENT_LOCALE=en_us.utf8;") == 0,
               "nominal: exact connection string");
        EXPECT(len == (int)strlen(buf), "nominal: returns length");
    }

    /* Optional values left out are omitted, not sent empty. */
    {
        struct informix_conn_params p = {
            .host = "h", .service = "9088", .server = "s", .password = "",
        };
        EXPECT(build(&p, buf, sizeof buf) > 0, "optional: builds");
        EXPECT(strstr(buf, "Database") == NULL, "optional: no Database");
        EXPECT(strstr(buf, "Uid") == NULL, "optional: no Uid");
        EXPECT(strstr(buf, "Pwd") == NULL, "optional: empty password omitted");
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

    /* host, service and server are all required. */
    {
        struct informix_conn_params p = { .host = "h", .server = "s" };
        EXPECT(build(&p, buf, sizeof buf) == -1, "missing service -> error");
        struct informix_conn_params q = { .host = "h", .service = "9088" };
        EXPECT(build(&q, buf, sizeof buf) == -1, "missing server -> error");
        struct informix_conn_params empty = { 0 };
        EXPECT(build(&empty, buf, sizeof buf) == -1, "empty params -> error");
    }

    /* Too-small buffer reports overflow rather than truncating silently. */
    {
        struct informix_conn_params p = {
            .host = "10.0.0.5", .service = "9088", .server = "ol_inf",
        };
        char small[16];
        EXPECT(build(&p, small, sizeof small) == -1, "overflow -> error");
    }

    /* NULL guards. */
    EXPECT(build(NULL, buf, sizeof buf) == -1, "NULL params -> error");
    {
        struct informix_conn_params p = { .host = "h", .service = "1", .server = "s" };
        EXPECT(informix_build_conn_str(&p, NULL, 10) == -1, "NULL buf -> error");
    }

    if (failures == 0) {
        printf("OK: informix connection-string builder (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
