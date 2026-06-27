#ifndef QUAERO_SQLITE_TYPES_H
#define QUAERO_SQLITE_TYPES_H

#include "dbcore/driver.h"

/*
 * Map a SQLite declared column type (sqlite3_column_decltype) to a neutral
 * dbc_type, following SQLite's type-affinity rules. `decltype` may be NULL
 * (expressions and untyped columns), which maps to DBC_TYPE_TEXT since cells
 * are exchanged as text. Pure: inspects the string only.
 */
dbc_type sqlite_affinity(const char *decltype);

#endif /* QUAERO_SQLITE_TYPES_H */
