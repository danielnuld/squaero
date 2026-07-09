#ifndef QUAERO_MYSQL_TYPES_H
#define QUAERO_MYSQL_TYPES_H

#include "dbcore/driver.h"

#include <stddef.h>

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

/* True for MYSQL_TYPE_BIT. BIT columns come over the text protocol as raw
   big-endian bytes (not a decimal string), so the query layer converts them. */
int mysql_type_is_bit(int mysql_type);

/*
 * Render a MySQL BIT value — `len` raw big-endian bytes — as an unsigned decimal
 * string in `out` (always NUL-terminated when outcap > 0). A bit(1) 0x00/0x01
 * becomes "0"/"1"; wider bits become their integer value. BIT is at most 64 bits;
 * if more bytes arrive the low 8 are used. Pure and unit-tested.
 */
void mysql_bit_to_decimal(const unsigned char *bytes, size_t len, char *out, size_t outcap);

#endif /* QUAERO_MYSQL_TYPES_H */
