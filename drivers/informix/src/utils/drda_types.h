#ifndef QUAERO_INFORMIX_DRDA_TYPES_H
#define QUAERO_INFORMIX_DRDA_TYPES_H

#include "dbcore/driver.h"

/*
 * Map the SQLTYPE a DRDA server describes a column with (the DB2 codes; odd =
 * nullable) to the neutral dbc_type. Informix sends its BOOLEAN as SMALLINT, so
 * it maps to DBC_TYPE_INT: nothing on the wire tells the two apart. DECIMAL and
 * MONEY are DBC_TYPE_FLOAT, as they were over ODBC. Pure, for unit tests.
 */
dbc_type informix_drda_type_to_neutral(int sqltype);

#endif /* QUAERO_INFORMIX_DRDA_TYPES_H */
