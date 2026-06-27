#include "types.h"

#include <stdio.h>

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
    /* No declared type -> text (expressions, untyped columns). */
    EXPECT(sqlite_affinity(NULL) == DBC_TYPE_TEXT, "NULL decltype -> text");
    EXPECT(sqlite_affinity("") == DBC_TYPE_TEXT, "empty decltype -> text");

    /* INTEGER affinity (any spelling containing INT). */
    EXPECT(sqlite_affinity("INTEGER") == DBC_TYPE_INT, "INTEGER");
    EXPECT(sqlite_affinity("int") == DBC_TYPE_INT, "lowercase int");
    EXPECT(sqlite_affinity("BIGINT") == DBC_TYPE_INT, "BIGINT");
    EXPECT(sqlite_affinity("UNSIGNED BIG INT") == DBC_TYPE_INT, "UNSIGNED BIG INT");

    /* TEXT affinity. */
    EXPECT(sqlite_affinity("TEXT") == DBC_TYPE_TEXT, "TEXT");
    EXPECT(sqlite_affinity("VARCHAR(255)") == DBC_TYPE_TEXT, "VARCHAR");
    EXPECT(sqlite_affinity("CHARACTER(20)") == DBC_TYPE_TEXT, "CHARACTER");
    EXPECT(sqlite_affinity("CLOB") == DBC_TYPE_TEXT, "CLOB");

    /* BLOB affinity. */
    EXPECT(sqlite_affinity("BLOB") == DBC_TYPE_BLOB, "BLOB");

    /* REAL affinity. */
    EXPECT(sqlite_affinity("REAL") == DBC_TYPE_FLOAT, "REAL");
    EXPECT(sqlite_affinity("DOUBLE PRECISION") == DBC_TYPE_FLOAT, "DOUBLE");
    EXPECT(sqlite_affinity("FLOAT") == DBC_TYPE_FLOAT, "FLOAT");

    /* NUMERIC affinity proper -> float. */
    EXPECT(sqlite_affinity("NUMERIC") == DBC_TYPE_FLOAT, "NUMERIC");
    EXPECT(sqlite_affinity("DECIMAL(10,2)") == DBC_TYPE_FLOAT, "DECIMAL");

    /* Declared bool/date/time names are honored as UI hints. */
    EXPECT(sqlite_affinity("BOOLEAN") == DBC_TYPE_BOOL, "BOOLEAN -> bool");
    EXPECT(sqlite_affinity("DATE") == DBC_TYPE_DATE, "DATE -> date");
    EXPECT(sqlite_affinity("DATETIME") == DBC_TYPE_TIMESTAMP, "DATETIME -> timestamp");
    EXPECT(sqlite_affinity("TIMESTAMP") == DBC_TYPE_TIMESTAMP, "TIMESTAMP -> timestamp");
    EXPECT(sqlite_affinity("TIME") == DBC_TYPE_TIME, "TIME -> time");

    /* Precedence: INT wins even when other keywords appear. */
    EXPECT(sqlite_affinity("INTCHAR") == DBC_TYPE_INT, "INT takes precedence over CHAR");

    if (failures == 0) {
        printf("OK: sqlite type affinity (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
