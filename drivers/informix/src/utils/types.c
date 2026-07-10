#include "types.h"

#include <stdio.h>

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

/*
 * DATETIME/INTERVAL qualifier field name for a time-unit code, or NULL if the
 * code is not a recognized field. FRACTION codes (11..15) carry a scale of
 * code-10 and all share the name FRACTION.
 */
static const char *dtime_field(int code)
{
    switch (code) {
    case 0:  return "YEAR";
    case 2:  return "MONTH";
    case 4:  return "DAY";
    case 6:  return "HOUR";
    case 8:  return "MINUTE";
    case 10: return "SECOND";
    case 11: case 12: case 13: case 14: case 15: return "FRACTION";
    default: return NULL;
    }
}

/*
 * Render a DATETIME/INTERVAL qualifier from collength, which encodes
 *   collength = total_digits*256 + largest_field*16 + smallest_field
 * (field codes as in dtime_field). Produces "<kw> <largest> TO <smallest>",
 * with FRACTION carrying its scale, e.g. "DATETIME YEAR TO FRACTION(3)". Falls
 * back to the bare keyword when the codes are unrecognized.
 */
static void render_dtime(int collength, const char *kw, char *buf, size_t cap)
{
    int largest  = (collength % 256) / 16;
    int smallest = collength % 16;
    const char *lg = dtime_field(largest);
    const char *sm = dtime_field(smallest);
    if (lg == NULL || sm == NULL) {
        snprintf(buf, cap, "%s", kw);
        return;
    }
    if (smallest >= 11) {
        /* smallest is FRACTION(n): "<kw> <largest> TO FRACTION(n)". */
        snprintf(buf, cap, "%s %s TO FRACTION(%d)", kw, lg, smallest - 10);
    } else if (largest == smallest) {
        snprintf(buf, cap, "%s %s", kw, lg);
    } else {
        snprintf(buf, cap, "%s %s TO %s", kw, lg, sm);
    }
}

void informix_col_type_str(int coltype, int collength, char *buf, size_t cap)
{
    if (buf == NULL || cap == 0) {
        return;
    }
    int cl = collength;  /* signed; the standard encodings are non-negative */
    switch (coltype & IFX_SQLTYPE_MASK) {
    case IFX_SQLCHAR:     snprintf(buf, cap, "CHAR(%d)", cl); break;
    case IFX_SQLSMINT:    snprintf(buf, cap, "SMALLINT"); break;
    case IFX_SQLINT:      snprintf(buf, cap, "INTEGER"); break;
    case IFX_SQLFLOAT:    snprintf(buf, cap, "FLOAT"); break;
    case IFX_SQLSMFLOAT:  snprintf(buf, cap, "SMALLFLOAT"); break;
    case IFX_SQLDECIMAL: {
        int prec = cl / 256, scale = cl % 256;
        if (scale == 255) snprintf(buf, cap, "DECIMAL(%d)", prec);   /* floating */
        else              snprintf(buf, cap, "DECIMAL(%d,%d)", prec, scale);
        break;
    }
    case IFX_SQLSERIAL:   snprintf(buf, cap, "SERIAL"); break;
    case IFX_SQLDATE:     snprintf(buf, cap, "DATE"); break;
    case IFX_SQLMONEY: {
        int prec = cl / 256, scale = cl % 256;
        snprintf(buf, cap, "MONEY(%d,%d)", prec, scale);
        break;
    }
    case IFX_SQLDTIME:    render_dtime(cl, "DATETIME", buf, cap); break;
    case IFX_SQLBYTES:    snprintf(buf, cap, "BYTE"); break;
    case IFX_SQLTEXT:     snprintf(buf, cap, "TEXT"); break;
    case IFX_SQLVCHAR: {
        int max = cl % 256, min = cl / 256;
        if (min > 0) snprintf(buf, cap, "VARCHAR(%d,%d)", max, min);
        else         snprintf(buf, cap, "VARCHAR(%d)", max);
        break;
    }
    case IFX_SQLINTERVAL: render_dtime(cl, "INTERVAL", buf, cap); break;
    case IFX_SQLNCHAR:    snprintf(buf, cap, "NCHAR(%d)", cl); break;
    case IFX_SQLNVCHAR: {
        int max = cl % 256, min = cl / 256;
        if (min > 0) snprintf(buf, cap, "NVARCHAR(%d,%d)", max, min);
        else         snprintf(buf, cap, "NVARCHAR(%d)", max);
        break;
    }
    case IFX_SQLINT8:     snprintf(buf, cap, "INT8"); break;
    case IFX_SQLSERIAL8:  snprintf(buf, cap, "SERIAL8"); break;
    case IFX_SQLLVARCHAR:
    case IFX_SQLUDTVAR:   snprintf(buf, cap, "LVARCHAR(%d)", cl > 0 ? cl : 1); break;
    case IFX_SQLBOOL:     snprintf(buf, cap, "BOOLEAN"); break;
    case IFX_SQLINFXBIGINT: snprintf(buf, cap, "BIGINT"); break;
    case IFX_SQLBIGSERIAL: snprintf(buf, cap, "BIGSERIAL"); break;
    default:
        /* Exotic/opaque types (collections, row, fixed UDT, ...) have no simple
           declaration; emit a plausible variable-text column so the CREATE still
           parses rather than emitting a broken type. */
        snprintf(buf, cap, "LVARCHAR(%d)", cl > 0 ? cl : 1);
        break;
    }
}
