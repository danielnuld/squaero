#ifndef QUAERO_INFORMIX_TEXT_H
#define QUAERO_INFORMIX_TEXT_H

#include <stddef.h>

/*
 * UTF-8 safety net for text coming back from Informix.
 *
 * The driver asks the CSDK for UTF-8 on every connection (CLIENT_LOCALE, see
 * utils/connstr.h), so in normal operation everything here is a no-op: the bytes
 * arrive already converted and are passed through untouched. This exists for the
 * cases where that does not hold — a connection whose client_locale was overridden
 * to a single-byte code set, or a server that ignored the request — because the
 * neutral contract and the JSON transport require valid UTF-8, and invalid bytes
 * used to leave the grid loading forever (issue #315).
 *
 * The fallback code set is Latin-1, which is what the driver has always assumed.
 * It cannot be inferred from the bytes: 0xC3 0xB1 is a valid UTF-8 "ñ" and an
 * equally valid Latin-1 "Ã±", and only the database knows which it meant. That is
 * why asking the engine to convert is the real fix and this is only the net.
 *
 * Every function treats its input as a NUL-terminated string.
 */

/* 1 when `s` is well-formed UTF-8. NULL and "" count as valid. */
int ifx_text_is_utf8(const char *s);

/*
 * `s` as UTF-8, reusing a caller-owned buffer grown on demand.
 *
 * Returns `s` itself when it is already valid UTF-8, so the common path copies
 * nothing; otherwise widens from Latin-1 into *buf (reallocating as needed) and
 * returns *buf. Returns NULL only when the allocation fails. `*buf` must start as
 * NULL with `*cap` 0, and belongs to the caller to free.
 *
 * This shape exists for cell values, which must hand back a stable pointer that
 * stays valid until the next fetch without allocating per row.
 */
const char *ifx_text_to_utf8(const char *s, char **buf, size_t *cap);

/* `s` as UTF-8 in a freshly allocated string, whether or not conversion was
   needed. NULL when `s` is NULL or allocation fails. Caller frees. */
char *ifx_text_to_utf8_dup(const char *s);

/* Convert `buf` in place to valid UTF-8, truncating to fit its `cap` bytes
   (including the NUL). Used for the fixed-size connection error buffer: widening
   can grow the text, and losing the tail of a message is better than shipping
   bytes that break the transport. A no-op when `buf` is already valid UTF-8. */
void ifx_text_fix_utf8_inplace(char *buf, size_t cap);

#endif /* QUAERO_INFORMIX_TEXT_H */
