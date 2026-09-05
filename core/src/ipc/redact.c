/*
 * Secret-stripping for anything that PRINTS a request (issue #302).
 *
 * The app shell's QUAERO_RPC_DEBUG trace dumped each request verbatim, and a
 * conn.open request carries the DSN — password included. That is the variable
 * someone turns on when something is wrong, which is exactly when the log gets
 * redirected to a file, pasted into an issue, or handed to a colleague.
 *
 * Redaction is by KEY NAME and recursive, not by a fixed path: a driver that
 * puts a new secret in its DSN tomorrow is covered without touching this file.
 * Matching is case-insensitive and by substring, so `password`, `sshPassword`
 * and `tunnel_passphrase` all fall in — as does a whole object or array under
 * such a key, which is replaced wholesale rather than walked into.
 */

#include "dbcore/ipc.h"

#include <stdlib.h>
#include <string.h>

#include "cJSON.h"

/* What a redacted value reads as in the trace. */
#define REDACTED "***"

/* Printed instead of a request that cannot be parsed: it may well be a
   truncated conn.open, and a half-parsed secret is still a secret. */
static const char WITHHELD[] = "<request withheld: not valid JSON>";

/* Substrings that make a key secret. Lower-case; matching folds the key. */
static const char *const SECRET_PARTS[] = {
    "password", "passwd", "pwd",    "passphrase", "secret",
    "token",    "privatekey", "apikey", "credential",
};

static char lower(char c)
{
    return (c >= 'A' && c <= 'Z') ? (char)(c - 'A' + 'a') : c;
}

/* Case-insensitive substring test. No locale, no ctype: keys are ASCII. */
static int contains_fold(const char *haystack, const char *needle)
{
    size_t nlen = strlen(needle);
    if (nlen == 0) {
        return 1;
    }
    for (const char *p = haystack; *p != '\0'; p++) {
        size_t i = 0;
        while (i < nlen && p[i] != '\0' && lower(p[i]) == needle[i]) {
            i++;
        }
        if (i == nlen) {
            return 1;
        }
    }
    return 0;
}

static int is_secret_key(const char *key)
{
    if (key == NULL) {
        return 0;
    }
    for (size_t i = 0; i < sizeof SECRET_PARTS / sizeof SECRET_PARTS[0]; i++) {
        if (contains_fold(key, SECRET_PARTS[i])) {
            return 1;
        }
    }
    return 0;
}

/* Replaces every secret-keyed value below `node` (an object or an array). */
static void redact_tree(cJSON *node)
{
    cJSON *child = node->child;
    while (child != NULL) {
        cJSON *next = child->next;
        if (cJSON_IsObject(node) && is_secret_key(child->string)) {
            cJSON *masked = cJSON_CreateString(REDACTED);
            if (masked != NULL &&
                !cJSON_ReplaceItemInObjectCaseSensitive(node, child->string, masked)) {
                cJSON_Delete(masked);
            }
        } else if (cJSON_IsObject(child) || cJSON_IsArray(child)) {
            redact_tree(child);
        }
        child = next;
    }
}

/* True when a secret-keyed value survived the pass above — an allocation that
   failed, or a duplicate key that the replace-by-name did not reach. The whole
   request is then withheld: a trace line is worth less than a leaked password. */
static int has_exposed_secret(const cJSON *node)
{
    for (const cJSON *child = node->child; child != NULL; child = child->next) {
        int secret = cJSON_IsObject(node) && is_secret_key(child->string);
        if (secret &&
            !(cJSON_IsString(child) && child->valuestring != NULL &&
              strcmp(child->valuestring, REDACTED) == 0)) {
            return 1;
        }
        if (!secret && (cJSON_IsObject(child) || cJSON_IsArray(child)) &&
            has_exposed_secret(child)) {
            return 1;
        }
    }
    return 0;
}

static char *withheld(void)
{
    char *out = (char *)malloc(sizeof WITHHELD);
    if (out != NULL) {
        memcpy(out, WITHHELD, sizeof WITHHELD);
    }
    return out;
}

char *dbcore_ipc_redact(const char *request_json)
{
    cJSON *root = request_json != NULL ? cJSON_Parse(request_json) : NULL;
    if (root == NULL) {
        return withheld();
    }
    char *out = NULL;
    if (cJSON_IsObject(root) || cJSON_IsArray(root)) {
        redact_tree(root);
        if (has_exposed_secret(root)) {
            cJSON_Delete(root);
            return withheld();
        }
    }
    out = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return out != NULL ? out : withheld();
}
