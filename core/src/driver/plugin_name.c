#include "dbcore/loader.h"

#include <stddef.h>
#include <string.h>

/*
 * Pure filename classification for the loader. No I/O: it only inspects the
 * string, so it is unit-tested directly (core/tests/driver/plugin_name_test.c).
 */

/* Platform shared-library extension, including the leading dot. */
#if defined(_WIN32)
#  define DBC_PLUGIN_EXT ".dll"
#  define DBC_PLUGIN_CASE_INSENSITIVE 1
#elif defined(__APPLE__)
#  define DBC_PLUGIN_EXT ".dylib"
#  define DBC_PLUGIN_CASE_INSENSITIVE 0
#else
#  define DBC_PLUGIN_EXT ".so"
#  define DBC_PLUGIN_CASE_INSENSITIVE 0
#endif

static int ends_with(const char *s, size_t slen, const char *suffix,
                     size_t suflen, int case_insensitive)
{
    if (suflen > slen) {
        return 0;
    }
    const char *tail = s + (slen - suflen);
    for (size_t i = 0; i < suflen; i++) {
        char a = tail[i];
        char b = suffix[i];
        if (case_insensitive) {
            if (a >= 'A' && a <= 'Z') { a = (char)(a - 'A' + 'a'); }
            if (b >= 'A' && b <= 'Z') { b = (char)(b - 'A' + 'a'); }
        }
        if (a != b) {
            return 0;
        }
    }
    return 1;
}

int dbc_plugin_is_candidate(const char *filename)
{
    if (filename == NULL) {
        return 0;
    }
    size_t len = strlen(filename);
    size_t extlen = strlen(DBC_PLUGIN_EXT);

    /* Reject names that are exactly the extension (no stem, e.g. ".so"). */
    if (len <= extlen) {
        return 0;
    }
    return ends_with(filename, len, DBC_PLUGIN_EXT, extlen,
                     DBC_PLUGIN_CASE_INSENSITIVE);
}
