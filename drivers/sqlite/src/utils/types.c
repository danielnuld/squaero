#include "types.h"

#include <ctype.h>
#include <string.h>

/* Case-insensitive substring search (the affinity rules are case-insensitive
   and SQLite spells decltypes in any case). */
static int contains_ci(const char *haystack, const char *needle)
{
    size_t nlen = strlen(needle);
    if (nlen == 0) {
        return 1;
    }
    for (const char *p = haystack; *p != '\0'; p++) {
        size_t i = 0;
        while (i < nlen &&
               tolower((unsigned char)p[i]) == tolower((unsigned char)needle[i])) {
            i++;
        }
        if (i == nlen) {
            return 1;
        }
    }
    return 0;
}

dbc_type sqlite_affinity(const char *decltype)
{
    /* No declared type (expressions, untyped columns): exchange as text. */
    if (decltype == NULL || decltype[0] == '\0') {
        return DBC_TYPE_TEXT;
    }

    /* SQLite affinity precedence (https://sqlite.org/datatype3.html#affname). */
    if (contains_ci(decltype, "INT")) {
        return DBC_TYPE_INT;
    }
    if (contains_ci(decltype, "CHAR") || contains_ci(decltype, "CLOB") ||
        contains_ci(decltype, "TEXT")) {
        return DBC_TYPE_TEXT;
    }
    if (contains_ci(decltype, "BLOB")) {
        return DBC_TYPE_BLOB;
    }
    if (contains_ci(decltype, "REAL") || contains_ci(decltype, "FLOA") ||
        contains_ci(decltype, "DOUB")) {
        return DBC_TYPE_FLOAT;
    }
    /* The remainder has NUMERIC affinity. SQLite has no native bool/date/time,
       but the declared name is a meaningful hint for the UI, so honor it.
       Order matters: DATETIME/TIMESTAMP contain "TIME" (and "DATE"). */
    if (contains_ci(decltype, "BOOL")) {
        return DBC_TYPE_BOOL;
    }
    if (contains_ci(decltype, "TIMESTAMP") || contains_ci(decltype, "DATETIME")) {
        return DBC_TYPE_TIMESTAMP;
    }
    if (contains_ci(decltype, "DATE")) {
        return DBC_TYPE_DATE;
    }
    if (contains_ci(decltype, "TIME")) {
        return DBC_TYPE_TIME;
    }
    /* NUMERIC, DECIMAL, ... surface as float; the value still travels as text. */
    return DBC_TYPE_FLOAT;
}
