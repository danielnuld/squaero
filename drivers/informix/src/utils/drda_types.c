#include "drda_types.h"

dbc_type informix_drda_type_to_neutral(int sqltype)
{
    switch (sqltype & ~1) {
    case 384: /* DATE */
        return DBC_TYPE_DATE;
    case 388: /* TIME */
        return DBC_TYPE_TIME;
    case 392: /* TIMESTAMP (Informix DATETIME) */
        return DBC_TYPE_TIMESTAMP;
    case 404: /* BLOB (Informix BYTE) */
    case 908: /* VARBINARY */
    case 912: /* BINARY */
        return DBC_TYPE_BLOB;
    case 480: /* FLOAT, REAL */
    case 484: /* DECIMAL, MONEY */
    case 488: /* zoned DECIMAL */
    case 996: /* DECFLOAT */
        return DBC_TYPE_FLOAT;
    case 492: /* BIGINT, INT8 */
    case 496: /* INTEGER, SERIAL */
    case 500: /* SMALLINT, and Informix BOOLEAN */
        return DBC_TYPE_INT;
    case 2436: /* BOOLEAN */
        return DBC_TYPE_BOOL;
    default: /* CHAR, VARCHAR, LVARCHAR, NCHAR, CLOB (TEXT), and the rest */
        return DBC_TYPE_TEXT;
    }
}
