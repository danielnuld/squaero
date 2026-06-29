#include "types.h"

/*
 * Informix SQL type codes, mirrored from the CSDK's sqltypes.h. They are a
 * stable part of the client interface; mirroring them here lets the mapping be
 * compiled and tested without the SDK headers. SQLTYPE is the mask that strips
 * the flag bits (SQLNONULL, SQLDISTINCT, ...) carried in the high byte of a
 * column's type code, leaving the base type.
 */
enum {
    IFX_SQLCHAR      = 0,
    IFX_SQLSMINT     = 1,
    IFX_SQLINT       = 2,
    IFX_SQLFLOAT     = 3,
    IFX_SQLSMFLOAT   = 4,
    IFX_SQLDECIMAL   = 5,
    IFX_SQLSERIAL    = 6,
    IFX_SQLDATE      = 7,
    IFX_SQLMONEY     = 8,
    IFX_SQLNULL      = 9,
    IFX_SQLDTIME     = 10,
    IFX_SQLBYTES     = 11,
    IFX_SQLTEXT      = 12,
    IFX_SQLVCHAR     = 13,
    IFX_SQLINTERVAL  = 14,
    IFX_SQLNCHAR     = 15,
    IFX_SQLNVCHAR    = 16,
    IFX_SQLINT8      = 17,
    IFX_SQLSERIAL8   = 18,
    IFX_SQLSET       = 19,
    IFX_SQLMULTISET  = 20,
    IFX_SQLLIST      = 21,
    IFX_SQLROW       = 22,
    IFX_SQLCOLLECTION = 23,
    IFX_SQLROWREF    = 24,
    IFX_SQLUDTVAR    = 40,
    IFX_SQLUDTFIXED  = 41,
    IFX_SQLREFSER8   = 42,
    IFX_SQLLVARCHAR  = 43,
    IFX_SQLSENDRECV  = 44,
    IFX_SQLBOOL      = 45,
    IFX_SQLINFXBIGINT = 52,
    IFX_SQLBIGSERIAL = 53,

    IFX_SQLTYPE_MASK = 0xFF   /* SQLTYPE: strips flag bits, leaves base type */
};

/*
 * Map an Informix SQL type code to the neutral dbc_type. Notes on the
 * inherently lossy / ambiguous cases:
 *   - DECIMAL and MONEY are fixed-point; the neutral model has no decimal type,
 *     so they map to FLOAT (same convention as the MySQL driver). Exact-decimal
 *     fidelity, when needed, is preserved by fetching the textual form.
 *   - DATETIME (SQLDTIME) carries a qualifier (e.g. YEAR TO SECOND vs HOUR TO
 *     SECOND) that the type code alone does not reveal, so it maps generically
 *     to TIMESTAMP; a time-only qualifier is refined later by the query layer.
 *   - INTERVAL has no neutral counterpart; its textual form is exchanged as
 *     TEXT.
 *   - Collection/row/UDT types (SET/MULTISET/LIST/ROW/UDT...) have no neutral
 *     counterpart and are surfaced as TEXT (their literal form is safe).
 *   - SERIAL/SERIAL8/BIGSERIAL/REFSER8 are auto-increment integer counters and
 *     map to INT.
 */
dbc_type informix_type_to_neutral(int informix_type)
{
    switch (informix_type & IFX_SQLTYPE_MASK) {
    case IFX_SQLSMINT:
    case IFX_SQLINT:
    case IFX_SQLINT8:
    case IFX_SQLINFXBIGINT:
    case IFX_SQLSERIAL:
    case IFX_SQLSERIAL8:
    case IFX_SQLBIGSERIAL:
    case IFX_SQLREFSER8:
        return DBC_TYPE_INT;

    case IFX_SQLFLOAT:
    case IFX_SQLSMFLOAT:
    case IFX_SQLDECIMAL:
    case IFX_SQLMONEY:
        return DBC_TYPE_FLOAT;

    case IFX_SQLBOOL:
        return DBC_TYPE_BOOL;

    case IFX_SQLNULL:
        return DBC_TYPE_NULL;

    case IFX_SQLDATE:
        return DBC_TYPE_DATE;

    case IFX_SQLDTIME:
        return DBC_TYPE_TIMESTAMP;

    case IFX_SQLBYTES:
        return DBC_TYPE_BLOB;

    case IFX_SQLCHAR:
    case IFX_SQLVCHAR:
    case IFX_SQLNCHAR:
    case IFX_SQLNVCHAR:
    case IFX_SQLLVARCHAR:
    case IFX_SQLTEXT:
    case IFX_SQLINTERVAL:
    case IFX_SQLSET:
    case IFX_SQLMULTISET:
    case IFX_SQLLIST:
    case IFX_SQLROW:
    case IFX_SQLCOLLECTION:
    case IFX_SQLROWREF:
    case IFX_SQLUDTVAR:
    case IFX_SQLUDTFIXED:
    case IFX_SQLSENDRECV:
        return DBC_TYPE_TEXT;

    default:
        /* Unknown/future codes exchange as text (their textual form is safe). */
        return DBC_TYPE_TEXT;
    }
}
