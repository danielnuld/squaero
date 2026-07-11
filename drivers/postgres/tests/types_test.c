#include "types.h"

#include <stdio.h>

/* Unit tests for the PostgreSQL OID -> neutral type mapping. The numeric
   literals are the stable catalog type OIDs (see types.c). */

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

int main(void)
{
    /* Boolean. */
    EXPECT(pg_oid_to_neutral(16) == DBC_TYPE_BOOL, "bool -> bool");

    /* Integers. */
    EXPECT(pg_oid_to_neutral(21) == DBC_TYPE_INT, "int2 -> int");
    EXPECT(pg_oid_to_neutral(23) == DBC_TYPE_INT, "int4 -> int");
    EXPECT(pg_oid_to_neutral(20) == DBC_TYPE_INT, "int8 -> int");
    EXPECT(pg_oid_to_neutral(26) == DBC_TYPE_INT, "oid -> int");

    /* Floating / numeric. */
    EXPECT(pg_oid_to_neutral(700) == DBC_TYPE_FLOAT, "float4 -> float");
    EXPECT(pg_oid_to_neutral(701) == DBC_TYPE_FLOAT, "float8 -> float");
    EXPECT(pg_oid_to_neutral(1700) == DBC_TYPE_FLOAT, "numeric -> float");

    /* Binary. */
    EXPECT(pg_oid_to_neutral(17) == DBC_TYPE_BLOB, "bytea -> blob");

    /* Temporal. */
    EXPECT(pg_oid_to_neutral(1082) == DBC_TYPE_DATE, "date -> date");
    EXPECT(pg_oid_to_neutral(1083) == DBC_TYPE_TIME, "time -> time");
    EXPECT(pg_oid_to_neutral(1266) == DBC_TYPE_TIME, "timetz -> time");
    EXPECT(pg_oid_to_neutral(1114) == DBC_TYPE_TIMESTAMP, "timestamp -> timestamp");
    EXPECT(pg_oid_to_neutral(1184) == DBC_TYPE_TIMESTAMP, "timestamptz -> timestamp");

    /* JSON. */
    EXPECT(pg_oid_to_neutral(114) == DBC_TYPE_JSON, "json -> json");
    EXPECT(pg_oid_to_neutral(3802) == DBC_TYPE_JSON, "jsonb -> json");

    /* Text family and text-exchanged types. */
    EXPECT(pg_oid_to_neutral(25) == DBC_TYPE_TEXT, "text -> text");
    EXPECT(pg_oid_to_neutral(1043) == DBC_TYPE_TEXT, "varchar -> text");
    EXPECT(pg_oid_to_neutral(1042) == DBC_TYPE_TEXT, "bpchar -> text");
    EXPECT(pg_oid_to_neutral(18) == DBC_TYPE_TEXT, "char -> text");
    EXPECT(pg_oid_to_neutral(19) == DBC_TYPE_TEXT, "name -> text");
    EXPECT(pg_oid_to_neutral(2950) == DBC_TYPE_TEXT, "uuid -> text");
    EXPECT(pg_oid_to_neutral(1186) == DBC_TYPE_TEXT, "interval -> text");
    EXPECT(pg_oid_to_neutral(790) == DBC_TYPE_TEXT, "money -> text");
    EXPECT(pg_oid_to_neutral(142) == DBC_TYPE_TEXT, "xml -> text");

    /* Unknown / user-defined OIDs fall back to text. */
    EXPECT(pg_oid_to_neutral(999999) == DBC_TYPE_TEXT, "unknown -> text");

    if (failures == 0) {
        printf("OK: postgres type mapping (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
