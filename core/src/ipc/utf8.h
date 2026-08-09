/*
 * UTF-8 guard for the IPC boundary.
 *
 * Every string a driver hands the core — cell values, column names, error text —
 * ends up inside a JSON frame. cJSON does NOT validate UTF-8: it copies the bytes
 * it is given. A single malformed byte therefore produces a frame the webview
 * bridge cannot decode, the response never arrives, and the UI waits forever
 * (issue #315). This module is the net that makes that impossible, applied where
 * every path converges: result_json.c and ipc_response_error.
 *
 * It is a net, not the conversion layer. A driver that knows its text's code set
 * converts the text itself, so nothing here fires. When it does fire, the repair
 * is deliberately lossy — one U+FFFD per undecodable byte — because a visibly
 * wrong character is a bug someone can see and fix, and a frozen UI is not.
 *
 * Validation is strict: overlong encodings, UTF-16 surrogates and code points
 * above U+10FFFF are rejected. They are all ill-formed UTF-8 and a decoder is
 * free to reject or substitute them, which is exactly the ambiguity that breaks
 * the transport.
 */
#ifndef QUAERO_IPC_UTF8_H
#define QUAERO_IPC_UTF8_H

#include "cJSON.h"

#include <stddef.h>

/* 1 when the NUL-terminated `s` is well-formed UTF-8. NULL and "" are valid. */
int ipc_utf8_valid(const char *s);

/* Owned copy of `s` with every ill-formed byte replaced by U+FFFD. Valid
   characters are preserved byte for byte. Caller frees. NULL on allocation
   failure (or when `s` is NULL). Prefer ipc_utf8_string/ipc_utf8_add_string:
   they skip the copy entirely when `s` is already valid. */
char *ipc_utf8_repair(const char *s);

/* cJSON string item holding `s`, repaired only if it is not valid UTF-8. NULL
   `s` yields an empty string, so callers need no NULL dance. NULL on allocation
   failure. */
cJSON *ipc_utf8_string(const char *s);

/* ipc_utf8_string added to `obj` under `key`. Returns the added item, or NULL on
   failure (nothing is added, `obj` untouched). */
cJSON *ipc_utf8_add_string(cJSON *obj, const char *key, const char *s);

#endif /* QUAERO_IPC_UTF8_H */
