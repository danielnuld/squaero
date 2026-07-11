#include "types.h"

/*
 * PostgreSQL base type OIDs, mirrored from the server catalog (pg_type.dat /
 * catalog/pg_type_d.h). These are fixed at initdb time and never change across
 * versions, so mirroring them here lets the mapping be compiled and tested
 * without the client headers (like the MySQL driver mirrors enum_field_types).
 * Domains and user-defined types carry their own high OIDs and fall through to
 * text, whose textual form is always safe to display.
 */
enum {
    PG_BOOLOID        = 16,
    PG_BYTEAOID       = 17,
    PG_CHAROID        = 18,
    PG_NAMEOID        = 19,
    PG_INT8OID        = 20,
    PG_INT2OID        = 21,
    PG_INT4OID        = 23,
    PG_TEXTOID        = 25,
    PG_OIDOID         = 26,
    PG_JSONOID        = 114,
    PG_XMLOID         = 142,
    PG_FLOAT4OID      = 700,
    PG_FLOAT8OID      = 701,
    PG_MONEYOID       = 790,
    PG_BPCHAROID      = 1042,
    PG_VARCHAROID     = 1043,
    PG_DATEOID        = 1082,
    PG_TIMEOID        = 1083,
    PG_TIMESTAMPOID   = 1114,
    PG_TIMESTAMPTZOID = 1184,
    PG_INTERVALOID    = 1186,
    PG_TIMETZOID      = 1266,
    PG_BITOID         = 1560,
    PG_VARBITOID      = 1562,
    PG_NUMERICOID     = 1700,
    PG_UUIDOID        = 2950,
    PG_JSONBOID       = 3802
};

/*
 * Map a PostgreSQL type OID to the neutral dbc_type. Notes:
 *   - NUMERIC maps to float (it is arbitrary-precision, but the neutral model
 *     has no decimal type; its textual value round-trips losslessly anyway).
 *   - money/bit/varbit/interval/uuid/xml and array OIDs are exchanged as text:
 *     their canonical textual form is what PQgetvalue returns.
 */
dbc_type pg_oid_to_neutral(unsigned int oid)
{
    switch (oid) {
    case PG_BOOLOID:
        return DBC_TYPE_BOOL;

    case PG_INT2OID:
    case PG_INT4OID:
    case PG_INT8OID:
    case PG_OIDOID:
        return DBC_TYPE_INT;

    case PG_FLOAT4OID:
    case PG_FLOAT8OID:
    case PG_NUMERICOID:
        return DBC_TYPE_FLOAT;

    case PG_BYTEAOID:
        return DBC_TYPE_BLOB;

    case PG_DATEOID:
        return DBC_TYPE_DATE;

    case PG_TIMEOID:
    case PG_TIMETZOID:
        return DBC_TYPE_TIME;

    case PG_TIMESTAMPOID:
    case PG_TIMESTAMPTZOID:
        return DBC_TYPE_TIMESTAMP;

    case PG_JSONOID:
    case PG_JSONBOID:
        return DBC_TYPE_JSON;

    case PG_CHAROID:
    case PG_NAMEOID:
    case PG_TEXTOID:
    case PG_BPCHAROID:
    case PG_VARCHAROID:
    case PG_XMLOID:
    case PG_MONEYOID:
    case PG_INTERVALOID:
    case PG_BITOID:
    case PG_VARBITOID:
    case PG_UUIDOID:
        return DBC_TYPE_TEXT;

    default:
        /* Domains, arrays, enums, ranges, geometry, user-defined types and any
           future OID exchange as text (their textual form is safe). */
        return DBC_TYPE_TEXT;
    }
}
