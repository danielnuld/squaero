#ifndef QUAERO_INFORMIX_TYPES_H
#define QUAERO_INFORMIX_TYPES_H

#include "dbcore/driver.h"

#include <stddef.h>

/*
 * Informix type mapping.
 *
 * Result-set and descriptor metadata expose each column's type as an Informix
 * SQL type code (the `SQLCHAR`, `SQLINT`, ... constants from the CSDK's
 * sqltypes.h). The low byte (`code & SQLTYPE`, i.e. & 0xFF) is the base type;
 * the high bits carry flags such as SQLNONULL (0x0100, "disallow nulls"). This
 * pure mapper masks off those flags and switches on the base code WITHOUT
 * including any CSDK header, so the type logic stays unit-testable on a machine
 * that has no Informix Client SDK installed. The codes are mirrored in types.c
 * as named constants; see that file.
 *
 * Note: the type code says nothing about whether a given value is NULL — that
 * is carried out-of-band by the indicator (sqlind < 0). NULL-vs-empty is
 * therefore resolved in the value-fetch layer (issue #70 criterion), not here.
 */
dbc_type informix_type_to_neutral(int informix_type);

/*
 * Render an Informix column type as its SQL declaration text (e.g. "CHAR(20)",
 * "VARCHAR(50)", "DECIMAL(10,2)", "DATETIME YEAR TO SECOND"), for get_ddl. This
 * is the inverse of what the catalog stores: `coltype` is the syscolumns type
 * code (base in the low byte, flags above — the NOT NULL flag is ignored here)
 * and `collength` is its length/precision/qualifier encoding, decoded per the
 * documented syscolumns formulas. Writes a NUL-terminated string into buf (never
 * overflowing cap); exotic/opaque types fall back to a plausible declaration so
 * the emitted CREATE stays syntactically valid. Pure — no CSDK headers — so it
 * is unit-tested without an Informix client.
 */
void informix_col_type_str(int coltype, int collength, char *buf, size_t cap);

#endif /* QUAERO_INFORMIX_TYPES_H */
