#ifndef QUAERO_MYSQL_TYPES_H
#define QUAERO_MYSQL_TYPES_H

#include "dbcore/driver.h"

/*
 * MySQL / MariaDB type mapping.
 *
 * Result-set metadata exposes each column's type as a value of the client
 * library's `enum enum_field_types` (mysql.h). These integer codes are a stable
 * part of the wire/client ABI, so this pure mapper switches on them WITHOUT
 * including mysql.h — keeping the type logic unit-testable on a machine that
 * has no MySQL client library installed. The driver's query layer passes
 * `field->type` straight through.
 *
 * The codes are mirrored in types.c as named constants; see that file.
 */
dbc_type mysql_type_to_neutral(int mysql_type);

#endif /* QUAERO_MYSQL_TYPES_H */
