#ifndef QUAERO_POSTGRES_TYPES_H
#define QUAERO_POSTGRES_TYPES_H

#include "dbcore/driver.h"

/*
 * PostgreSQL type mapping.
 *
 * Result-set metadata exposes each column's type as a PostgreSQL type OID
 * (PQftype). These OIDs are assigned in the catalog's initial contents and are a
 * stable part of the wire protocol, so this pure mapper switches on them WITHOUT
 * including libpq-fe.h — keeping the type logic unit-testable on a machine that
 * has no PostgreSQL client library installed. The driver's query layer passes
 * PQftype(res, col) straight through.
 *
 * The OIDs are mirrored in types.c as named constants; see that file.
 */
dbc_type pg_oid_to_neutral(unsigned int oid);

#endif /* QUAERO_POSTGRES_TYPES_H */
