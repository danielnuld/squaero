#include "types.h"

#include <stdio.h>
#include <string.h>

/* Unit tests for the Informix SQL-type -> neutral type mapping. The numeric
   literals are the stable SQL type codes mirrored in types.c (CSDK sqltypes.h).
   SQLNONULL (0x0100) is the "disallow nulls" flag the server ORs onto a column
   type code; the mapper must mask it off and key on the base type. */

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

#define SQLNONULL 0x0100   /* high-byte NOT NULL flag, mirrored from sqltypes.h */

int main(void)
{
    /* Integers (incl. the SERIAL auto-increment family). */
    EXPECT(informix_type_to_neutral(1) == DBC_TYPE_INT, "SMINT -> int");
    EXPECT(informix_type_to_neutral(2) == DBC_TYPE_INT, "INT -> int");
    EXPECT(informix_type_to_neutral(17) == DBC_TYPE_INT, "INT8 -> int");
    EXPECT(informix_type_to_neutral(52) == DBC_TYPE_INT, "BIGINT -> int");
    EXPECT(informix_type_to_neutral(6) == DBC_TYPE_INT, "SERIAL -> int");
    EXPECT(informix_type_to_neutral(18) == DBC_TYPE_INT, "SERIAL8 -> int");
    EXPECT(informix_type_to_neutral(53) == DBC_TYPE_INT, "BIGSERIAL -> int");
    EXPECT(informix_type_to_neutral(42) == DBC_TYPE_INT, "REFSER8 -> int");

    /* Floating / fixed-point. */
    EXPECT(informix_type_to_neutral(3) == DBC_TYPE_FLOAT, "FLOAT -> float");
    EXPECT(informix_type_to_neutral(4) == DBC_TYPE_FLOAT, "SMFLOAT -> float");
    EXPECT(informix_type_to_neutral(5) == DBC_TYPE_FLOAT, "DECIMAL -> float");
    EXPECT(informix_type_to_neutral(8) == DBC_TYPE_FLOAT, "MONEY -> float");

    /* Boolean. */
    EXPECT(informix_type_to_neutral(45) == DBC_TYPE_BOOL, "BOOL -> bool");

    /* Null type. */
    EXPECT(informix_type_to_neutral(9) == DBC_TYPE_NULL, "NULL -> null");

    /* Temporal. */
    EXPECT(informix_type_to_neutral(7) == DBC_TYPE_DATE, "DATE -> date");
    EXPECT(informix_type_to_neutral(10) == DBC_TYPE_TIMESTAMP, "DATETIME -> timestamp");

    /* Binary large object. */
    EXPECT(informix_type_to_neutral(11) == DBC_TYPE_BLOB, "BYTE -> blob");

    /* Character / text family. */
    EXPECT(informix_type_to_neutral(0) == DBC_TYPE_TEXT, "CHAR -> text");
    EXPECT(informix_type_to_neutral(13) == DBC_TYPE_TEXT, "VARCHAR -> text");
    EXPECT(informix_type_to_neutral(15) == DBC_TYPE_TEXT, "NCHAR -> text");
    EXPECT(informix_type_to_neutral(16) == DBC_TYPE_TEXT, "NVARCHAR -> text");
    EXPECT(informix_type_to_neutral(43) == DBC_TYPE_TEXT, "LVARCHAR -> text");
    EXPECT(informix_type_to_neutral(12) == DBC_TYPE_TEXT, "TEXT -> text");

    /* No neutral counterpart: exchanged as text. */
    EXPECT(informix_type_to_neutral(14) == DBC_TYPE_TEXT, "INTERVAL -> text");
    EXPECT(informix_type_to_neutral(19) == DBC_TYPE_TEXT, "SET -> text");
    EXPECT(informix_type_to_neutral(22) == DBC_TYPE_TEXT, "ROW -> text");
    EXPECT(informix_type_to_neutral(40) == DBC_TYPE_TEXT, "UDTVAR -> text");

    /* Edge: the NOT NULL flag (0x0100) must be masked off before mapping. */
    EXPECT(informix_type_to_neutral(2 | SQLNONULL) == DBC_TYPE_INT,
           "INT with SQLNONULL -> int");
    EXPECT(informix_type_to_neutral(13 | SQLNONULL) == DBC_TYPE_TEXT,
           "VARCHAR with SQLNONULL -> text");
    EXPECT(informix_type_to_neutral(7 | SQLNONULL) == DBC_TYPE_DATE,
           "DATE with SQLNONULL -> date");

    /* Unknown / future / reserved codes fall back to text. */
    EXPECT(informix_type_to_neutral(51) == DBC_TYPE_TEXT, "UNKNOWN -> text");
    EXPECT(informix_type_to_neutral(9999) == DBC_TYPE_TEXT, "unknown -> text");

    /* --- type-string rendering for get_ddl (informix_col_type_str) --- */
    /* collength encodings follow the documented syscolumns formulas:
       CHAR/NCHAR = length; VARCHAR = max + 256*min; DECIMAL/MONEY = 256*prec + scale;
       DATETIME/INTERVAL = 256*digits + 16*largest_field + smallest_field. */
    char b[64];
#define EXPECT_TYPE(ct, cl, want)                                          \
    do {                                                                   \
        informix_col_type_str((ct), (cl), b, sizeof b);                    \
        EXPECT(strcmp(b, (want)) == 0, "type_str " want);                  \
        if (strcmp(b, (want)) != 0)                                        \
            fprintf(stderr, "  got \"%s\" want \"%s\"\n", b, (want));       \
    } while (0)

    EXPECT_TYPE(0, 20, "CHAR(20)");
    EXPECT_TYPE(1, 2, "SMALLINT");
    EXPECT_TYPE(2, 4, "INTEGER");
    EXPECT_TYPE(3, 8, "FLOAT");
    EXPECT_TYPE(4, 4, "SMALLFLOAT");
    EXPECT_TYPE(5, 10 * 256 + 2, "DECIMAL(10,2)");
    EXPECT_TYPE(5, 8 * 256 + 255, "DECIMAL(8)");       /* scale 255 = floating */
    EXPECT_TYPE(6, 4, "SERIAL");
    EXPECT_TYPE(7, 4, "DATE");
    EXPECT_TYPE(8, 16 * 256 + 2, "MONEY(16,2)");
    EXPECT_TYPE(11, 10, "BYTE");
    EXPECT_TYPE(12, 10, "TEXT");
    EXPECT_TYPE(13, 50, "VARCHAR(50)");
    EXPECT_TYPE(13, 10 * 256 + 50, "VARCHAR(50,10)");
    EXPECT_TYPE(15, 5, "NCHAR(5)");
    EXPECT_TYPE(16, 30, "NVARCHAR(30)");
    EXPECT_TYPE(17, 8, "INT8");
    EXPECT_TYPE(18, 8, "SERIAL8");
    EXPECT_TYPE(43, 2000, "LVARCHAR(2000)");
    EXPECT_TYPE(45, 1, "BOOLEAN");
    EXPECT_TYPE(52, 8, "BIGINT");
    EXPECT_TYPE(53, 8, "BIGSERIAL");
    /* DATETIME / INTERVAL qualifiers (digits component is ignored in the text). */
    EXPECT_TYPE(10, 14 * 256 + 0 * 16 + 10, "DATETIME YEAR TO SECOND");
    EXPECT_TYPE(10, 4 * 256 + 6 * 16 + 8, "DATETIME HOUR TO MINUTE");
    EXPECT_TYPE(10, 20 * 256 + 0 * 16 + 13, "DATETIME YEAR TO FRACTION(3)");
    EXPECT_TYPE(14, 6 * 256 + 4 * 16 + 8, "INTERVAL DAY TO MINUTE");
    /* The NOT NULL flag (0x0100) must be masked before decoding the base type. */
    EXPECT_TYPE(0 | SQLNONULL, 10, "CHAR(10)");

#undef EXPECT_TYPE

    if (failures == 0) {
        printf("OK: informix type mapping (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
