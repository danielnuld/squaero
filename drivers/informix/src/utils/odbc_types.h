#ifndef QUAERO_INFORMIX_ODBC_TYPES_H
#define QUAERO_INFORMIX_ODBC_TYPES_H

#include "dbcore/driver.h"

/*
 * ODBC SQL-type -> neutral type mapping.
 *
 * The live result path reaches Informix through the ODBC Driver Manager, so a
 * column's type arrives from SQLDescribeCol as a standard ODBC SQL type code
 * (SQL_INTEGER, SQL_VARCHAR, ...), NOT as an Informix native code. This pure
 * mapper switches on those ODBC codes — mirrored as named constants in
 * odbc_types.c — so it compiles and unit-tests without any ODBC headers.
 *
 * (The native Informix code mapping lives in types.c / informix_type_to_neutral;
 * it backs catalog introspection, where syscolumns.coltype is the native code.)
 */
dbc_type informix_odbc_type_to_neutral(int odbc_sql_type);

#endif /* QUAERO_INFORMIX_ODBC_TYPES_H */
