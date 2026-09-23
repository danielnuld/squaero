#include "dsn.h"

#include <stdio.h>
#include <string.h>

/* The JSON DSN of the DRDA driver (issue #557): defaults, TLS modes, and the
   keys of the old ODBC driver that must not be silently ignored. */

static int failures = 0;
#define EXPECT(cond, msg)                         \
    do {                                          \
        if (!(cond)) {                            \
            fprintf(stderr, "FAIL: %s\n", (msg)); \
            failures++;                           \
        }                                         \
    } while (0)

static int parse(const char *json, struct ifx_dsn *d, char *err)
{
    return informix_dsn_parse(json, d, err, 256);
}

int main(void)
{
    struct ifx_dsn d;
    char err[256];

    /* Nominal: everything given, port as the string the frontend sends. */
    EXPECT(parse("{\"host\":\"10.0.0.5\",\"port\":\"9189\",\"database\":\"stores\","
                 "\"user\":\"informix\",\"password\":\"s3cret\",\"tls\":\"verify-full\","
                 "\"tls_ca\":\"C:/ca.pem\"}", &d, err) == 0, "full dsn parses");
    EXPECT(strcmp(d.host, "10.0.0.5") == 0 && d.port == 9189, "host and port");
    EXPECT(strcmp(d.database, "stores") == 0 && strcmp(d.user, "informix") == 0 &&
           strcmp(d.password, "s3cret") == 0, "database, user, password");
    EXPECT(d.tls == IFX_TLS_VERIFY_FULL && strcmp(d.tls_ca, "C:/ca.pem") == 0, "tls and ca");
    EXPECT(d.sqli_server[0] == '\0', "no sqli_server unless given");

    /* The SQLI fallback's server name. */
    EXPECT(parse("{\"host\":\"h\",\"user\":\"u\",\"port\":\"9088\","
                 "\"sqli_server\":\"ol_informix1170\"}", &d, err) == 0 &&
           strcmp(d.sqli_server, "ol_informix1170") == 0 && d.port == 9088, "sqli_server");

    /* Defaults: the DRDA port, sysmaster, no TLS. */
    EXPECT(parse("{\"host\":\"h\",\"user\":\"u\"}", &d, err) == 0, "minimal dsn parses");
    EXPECT(d.port == IFX_DEFAULT_PORT && d.port == 9089, "default port 9089");
    EXPECT(strcmp(d.database, "sysmaster") == 0, "default database sysmaster");
    EXPECT(d.tls == IFX_TLS_OFF && d.tls_ca[0] == '\0' && d.password[0] == '\0', "no tls");
    EXPECT(parse("{\"host\":\"h\",\"user\":\"u\",\"port\":\"\"}", &d, err) == 0 &&
           d.port == 9089, "empty port string is the default");
    EXPECT(parse("{\"host\":\"h\",\"user\":\"u\",\"port\":9090}", &d, err) == 0 &&
           d.port == 9090, "numeric port");

    /* TLS modes. */
    EXPECT(parse("{\"host\":\"h\",\"user\":\"u\",\"tls\":\"require\"}", &d, err) == 0 &&
           d.tls == IFX_TLS_REQUIRE, "tls require");
    EXPECT(parse("{\"host\":\"h\",\"user\":\"u\",\"tls\":\"verify-ca\"}", &d, err) == 0 &&
           d.tls == IFX_TLS_VERIFY_CA, "tls verify-ca");
    EXPECT(parse("{\"host\":\"h\",\"user\":\"u\",\"tls\":\"yes\"}", &d, err) < 0 &&
           strstr(err, "tls") != NULL, "unknown tls mode refused");

    /* Keys of the old driver: ignored when harmless, refused when not. */
    EXPECT(parse("{\"host\":\"h\",\"user\":\"u\",\"server\":\"ol_informix1170\","
                 "\"client_locale\":\"en_us.819\",\"protocol\":\"\"}", &d, err) == 0,
           "server, client_locale and a plain protocol are ignored");
    EXPECT(parse("{\"host\":\"h\",\"user\":\"u\",\"protocol\":\"onsocssl\"}", &d, err) < 0 &&
           strstr(err, "tls") != NULL, "onsocssl without tls is refused");
    EXPECT(parse("{\"host\":\"h\",\"user\":\"u\",\"protocol\":\"onsocssl\",\"tls\":\"require\"}",
                 &d, err) == 0, "onsocssl with tls set is fine");
    EXPECT(parse("{\"odbc_dsn\":\"stores_demo\",\"user\":\"u\"}", &d, err) < 0 &&
           strstr(err, "ODBC") != NULL, "odbc_dsn refused");

    /* Invalid input. */
    EXPECT(parse("{\"host\":\"h\",\"user\":\"u\",\"port\":\"sqlexec\"}", &d, err) < 0 &&
           strstr(err, "9089") != NULL, "a service name is refused, with the usual port");
    EXPECT(parse("{\"host\":\"h\",\"user\":\"u\",\"port\":\"70000\"}", &d, err) < 0,
           "port out of range");
    EXPECT(parse("{\"user\":\"u\"}", &d, err) < 0 && strstr(err, "host") != NULL, "host needed");
    EXPECT(parse("{\"host\":\"h\"}", &d, err) < 0 && strstr(err, "user") != NULL, "user needed");
    EXPECT(parse("not json", &d, err) < 0, "not JSON");
    EXPECT(parse(NULL, &d, err) < 0, "NULL dsn");
    EXPECT(parse("[1]", &d, err) < 0, "not an object");

    if (failures == 0) {
        printf("OK: informix dsn\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
