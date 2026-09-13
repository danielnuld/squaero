#ifndef QUAERO_MYSQL_SSL_H
#define QUAERO_MYSQL_SSL_H

/*
 * Pure SSL-mode parsing for the MySQL/MariaDB driver DSN. Deliberately free of
 * mysql.h so it is unit-tested without the client library (like types.c). The
 * connection code translates this neutral mode to the client's SSL_MODE_* enum
 * / ssl options before connecting.
 */

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    MYSQL_SSL_UNSET = 0,      /* no ssl_mode in the DSN: client default */
    MYSQL_SSL_DISABLED,       /* never use TLS */
    MYSQL_SSL_REQUIRED,       /* encrypt, but do not verify the server cert */
    MYSQL_SSL_VERIFY_CA,      /* encrypt + verify the cert chains to a CA */
    MYSQL_SSL_VERIFY_IDENTITY /* verify_ca + the host matches the cert */
} mysql_ssl_mode;

/*
 * Parse an ssl_mode string into *out.
 *
 * Returns 1 (success) and sets *out to:
 *   - MYSQL_SSL_UNSET when s is NULL or empty (no explicit mode),
 *   - the matching mode for "disabled" / "required" / "verify_ca" /
 *     "verify_identity" (case-sensitive, the documented DSN spelling).
 * Returns 0 for any other (unrecognized) value, leaving *out = MYSQL_SSL_UNSET.
 */
int mysql_ssl_mode_parse(const char *s, mysql_ssl_mode *out);

/*
 * Whether an open connection honours what `mode` asked for (issue #144).
 *
 * `cipher` is the negotiated TLS cipher (mysql_get_ssl_cipher), NULL or empty
 * when the session is plaintext. Returns 0 when the mode demands encryption
 * (required / verify_ca / verify_identity) but none was negotiated, else 1.
 *
 * Needed because the client does not always refuse by itself: a connector built
 * without TLS accepts ssl_mode=required and quietly connects in plaintext.
 */
int mysql_tls_satisfied(mysql_ssl_mode mode, const char *cipher);

/*
 * Whether `mode` can be honoured with the given CA file (issue #144). Returns 0
 * for verify_ca / verify_identity with no ssl_ca, else 1.
 *
 * Measured: MariaDB Connector/C given verify_ca and no CA does not refuse — it
 * connects without verifying anything, so the certificate check the user chose
 * silently never happens. Requiring the CA makes that choice mean what it says.
 */
int mysql_ssl_ca_sufficient(mysql_ssl_mode mode, const char *ca);

#ifdef __cplusplus
}
#endif

#endif /* QUAERO_MYSQL_SSL_H */
