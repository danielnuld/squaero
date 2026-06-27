#include "dbcore/loader.h"

#include <stddef.h>
#include <string.h>

/*
 * Pure filename classification for the loader. No I/O: it only inspects the
 * string, so it is unit-tested directly (core/tests/driver/plugin_name_test.c).
 *
 * The accepted extensions are per-platform. Note macOS: CMake builds loadable
 * MODULE libraries with the ".so" suffix (".dylib" is for regular shared
 * libraries), so a driver plugin there is "name.so" — both are accepted.
 */
#if defined(_WIN32)
static const char *const k_exts[] = { ".dll" };
#  define DBC_PLUGIN_CASE_INSENSITIVE 1
#elif defined(__APPLE__)
static const char *const k_exts[] = { ".dylib", ".so" };
#  define DBC_PLUGIN_CASE_INSENSITIVE 0
#else
static const char *const k_exts[] = { ".so" };
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

    for (size_t i = 0; i < sizeof k_exts / sizeof k_exts[0]; i++) {
        size_t extlen = strlen(k_exts[i]);
        /* Reject a name that is exactly the extension (no stem, e.g. ".so"). */
        if (len > extlen &&
            ends_with(filename, len, k_exts[i], extlen,
                      DBC_PLUGIN_CASE_INSENSITIVE)) {
            return 1;
        }
    }
    return 0;
}
