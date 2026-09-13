#include "ssl.h"

#include <stdio.h>

static int failures = 0;
#define EXPECT(cond, msg)                              \
    do {                                               \
        if (!(cond)) {                                 \
            fprintf(stderr, "FAIL: %s\n", (msg));      \
            failures++;                                \
        }                                              \
    } while (0)

static mysql_ssl_mode parse_ok(const char *s)
{
    mysql_ssl_mode m = (mysql_ssl_mode)-1;
    int rc = mysql_ssl_mode_parse(s, &m);
    EXPECT(rc == 1, s ? s : "(null)");
    return m;
}

int main(void)
{
    /* absent => UNSET */
    EXPECT(parse_ok(NULL) == MYSQL_SSL_UNSET, "NULL is unset");
    EXPECT(parse_ok("") == MYSQL_SSL_UNSET, "empty is unset");

    /* the four documented modes */
    EXPECT(parse_ok("disabled") == MYSQL_SSL_DISABLED, "disabled");
    EXPECT(parse_ok("required") == MYSQL_SSL_REQUIRED, "required");
    EXPECT(parse_ok("verify_ca") == MYSQL_SSL_VERIFY_CA, "verify_ca");
    EXPECT(parse_ok("verify_identity") == MYSQL_SSL_VERIFY_IDENTITY, "verify_identity");

    /* unknown => 0, out left UNSET */
    {
        mysql_ssl_mode m = MYSQL_SSL_REQUIRED; /* poison */
        EXPECT(mysql_ssl_mode_parse("preferred", &m) == 0, "unknown rejected");
        EXPECT(m == MYSQL_SSL_UNSET, "unknown leaves out unset");
        EXPECT(mysql_ssl_mode_parse("REQUIRED", &m) == 0, "case-sensitive");
        EXPECT(mysql_ssl_mode_parse("verifyca", &m) == 0, "no fuzzy match");
    }

    /* A mode that demands TLS is only satisfied by a negotiated cipher. */
    EXPECT(mysql_tls_satisfied(MYSQL_SSL_REQUIRED, "TLS_AES_128_GCM_SHA256"), "required + cipher");
    EXPECT(!mysql_tls_satisfied(MYSQL_SSL_REQUIRED, NULL), "required + plaintext (NULL)");
    EXPECT(!mysql_tls_satisfied(MYSQL_SSL_REQUIRED, ""), "required + plaintext (empty)");
    EXPECT(!mysql_tls_satisfied(MYSQL_SSL_VERIFY_CA, ""), "verify_ca + plaintext");
    EXPECT(!mysql_tls_satisfied(MYSQL_SSL_VERIFY_IDENTITY, NULL), "verify_identity + plaintext");
    /* Modes that do not demand it are satisfied either way. */
    EXPECT(mysql_tls_satisfied(MYSQL_SSL_UNSET, NULL), "unset + plaintext");
    EXPECT(mysql_tls_satisfied(MYSQL_SSL_DISABLED, NULL), "disabled + plaintext");
    EXPECT(mysql_tls_satisfied(MYSQL_SSL_UNSET, "TLS_AES_128_GCM_SHA256"), "unset + cipher");

    /* Verifying modes need a CA to verify against; the others do not. */
    EXPECT(!mysql_ssl_ca_sufficient(MYSQL_SSL_VERIFY_CA, NULL), "verify_ca without CA");
    EXPECT(!mysql_ssl_ca_sufficient(MYSQL_SSL_VERIFY_IDENTITY, ""), "verify_identity empty CA");
    EXPECT(mysql_ssl_ca_sufficient(MYSQL_SSL_VERIFY_CA, "ca.pem"), "verify_ca with CA");
    EXPECT(mysql_ssl_ca_sufficient(MYSQL_SSL_REQUIRED, NULL), "required needs no CA");
    EXPECT(mysql_ssl_ca_sufficient(MYSQL_SSL_UNSET, NULL), "unset needs no CA");

    if (failures == 0) {
        printf("OK: mysql ssl_mode parse + tls guard (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
