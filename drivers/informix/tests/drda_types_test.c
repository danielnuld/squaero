#include "drda_types.h"

#include <stdio.h>

/* SQLTYPE (as Informix describes columns over DRDA) -> neutral dbc_type. The
   codes are the ones measured against Informix 15.0.1 and 11.70 (issue #557). */

static int failures = 0;
#define EXPECT(cond, msg)                         \
    do {                                          \
        if (!(cond)) {                            \
            fprintf(stderr, "FAIL: %s\n", (msg)); \
            failures++;                           \
        }                                         \
    } while (0)

int main(void)
{
    /* Nullable (odd) and NOT NULL (even) map alike. */
    EXPECT(informix_drda_type_to_neutral(496) == DBC_TYPE_INT, "INTEGER not null");
    EXPECT(informix_drda_type_to_neutral(497) == DBC_TYPE_INT, "INTEGER nullable");
    EXPECT(informix_drda_type_to_neutral(501) == DBC_TYPE_INT, "SMALLINT (and BOOLEAN)");
    EXPECT(informix_drda_type_to_neutral(493) == DBC_TYPE_INT, "BIGINT / INT8");
    EXPECT(informix_drda_type_to_neutral(481) == DBC_TYPE_FLOAT, "FLOAT / SMALLFLOAT");
    EXPECT(informix_drda_type_to_neutral(485) == DBC_TYPE_FLOAT, "DECIMAL / MONEY");
    EXPECT(informix_drda_type_to_neutral(385) == DBC_TYPE_DATE, "DATE");
    EXPECT(informix_drda_type_to_neutral(389) == DBC_TYPE_TIME, "DATETIME HOUR TO ...");
    EXPECT(informix_drda_type_to_neutral(393) == DBC_TYPE_TIMESTAMP, "DATETIME YEAR TO ...");
    EXPECT(informix_drda_type_to_neutral(449) == DBC_TYPE_TEXT, "VARCHAR");
    EXPECT(informix_drda_type_to_neutral(453) == DBC_TYPE_TEXT, "CHAR");
    EXPECT(informix_drda_type_to_neutral(409) == DBC_TYPE_TEXT, "CLOB (TEXT)");
    EXPECT(informix_drda_type_to_neutral(405) == DBC_TYPE_BLOB, "BLOB (BYTE)");
    EXPECT(informix_drda_type_to_neutral(2437) == DBC_TYPE_BOOL, "BOOLEAN proper");
    EXPECT(informix_drda_type_to_neutral(0) == DBC_TYPE_TEXT, "unknown -> text");

    if (failures == 0) {
        printf("OK: informix drda types\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
