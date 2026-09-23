#ifndef QUAERO_INFORMIX_UTF16_H
#define QUAERO_INFORMIX_UTF16_H

#include <stddef.h>

/*
 * UTF-8 -> UTF-16 for statement text (issue #324).
 *
 * The Informix CSDK converts in one direction only: data coming back from the
 * server is converted to the client's CLIENT_LOCALE, but the text of the
 * statement going out is passed through byte for byte. So a UTF-8 statement sent
 * with the ANSI SQLExecDirect reaches a single-byte database as raw UTF-8 bytes:
 * `LIKE '%ñada%'` compares 0xC3 0xB1 against the stored 0xF1 and quietly matches
 * nothing, and an accented identifier is rejected outright. No locale keyword
 * changes this — it was measured with all of them.
 *
 * The documented way to be explicit about statement encoding is the wide entry
 * point (SQLExecDirectW), which takes UTF-16 and lets the driver convert to the
 * database's code set. That conversion is what this header provides.
 *
 * The element type is `unsigned short` rather than SQLWCHAR so this stays a pure
 * helper, buildable and unit-testable without any ODBC headers; the caller casts.
 * That matches SQLWCHAR on both Windows and unixODBC.
 */

/*
 * 1 when the statement `sql` should be executed through the wide entry point:
 * it holds at least one byte >= 0x80 and every one of them sits inside a
 * single-quoted literal.
 *
 * Both halves of that condition are load-bearing, and both were measured:
 *
 *   - A pure-ASCII statement — nearly all of them — gains nothing from the wide
 *     path, so it keeps the exact call it has always used and cannot regress.
 *   - A non-ASCII byte OUTSIDE a literal (an accented alias, a delimited
 *     identifier, a comment) makes the CSDK's SQLExecDirectW **segfault**. Inside a
 *     literal the same call works perfectly. Since we cannot fix the driver, those
 *     statements stay on the ANSI path, where the server rejects the identifier
 *     with a clean "illegal character" error — exactly what it did before, and
 *     infinitely better than taking the process down.
 *
 * Doubled quotes ('') inside a literal are handled as the escape they are. NULL
 * and pure ASCII return 0.
 */
int ifx_sql_wide_safe(const char *sql);

/*
 * NUL-terminated UTF-16 copy of the UTF-8 string `s`. On success returns a
 * malloc'd array (caller frees) and, when `out_len` is non-NULL, stores the length
 * in UTF-16 code units excluding the terminator. Characters outside the BMP become
 * a surrogate pair.
 *
 * Returns NULL when `s` is NULL, when allocation fails, or when `s` is not
 * well-formed UTF-8 — the caller then falls back to the ANSI path rather than
 * sending something it cannot vouch for.
 */
unsigned short *ifx_utf8_to_utf16(const char *s, size_t *out_len);

#endif /* QUAERO_INFORMIX_UTF16_H */
