#include "stmt_class.h"

#include <stdio.h>

static int failures = 0;

#define CHECK(sql, want)                                                    \
    do {                                                                    \
        stmt_class_t got = stmt_classify(sql);                              \
        if (got != (want)) {                                                \
            fprintf(stderr, "FAIL: [%s] => %d, want %d\n",                  \
                    (sql) ? (sql) : "(null)", got, (want));                 \
            failures++;                                                     \
        }                                                                   \
    } while (0)

int main(void)
{
    /* --- empty / trivial --- */
    CHECK(NULL, STMT_EMPTY);
    CHECK("", STMT_EMPTY);
    CHECK("   \n\t ", STMT_EMPTY);
    CHECK("-- just a comment", STMT_EMPTY);
    CHECK("/* only a block comment */", STMT_EMPTY);
    CHECK(";", STMT_EMPTY);

    /* --- plain reads --- */
    CHECK("SELECT 1", STMT_READ);
    CHECK("  select * from t", STMT_READ);
    CHECK("SELECT * FROM t WHERE x = 1;", STMT_READ);
    CHECK("EXPLAIN SELECT * FROM t", STMT_READ);
    CHECK("SHOW TABLES", STMT_READ);
    CHECK("DESCRIBE t", STMT_READ);
    CHECK("VALUES (1),(2)", STMT_READ);
    CHECK("(SELECT 1)", STMT_READ);
    CHECK("select 1; select 2;", STMT_READ);

    /* --- plain writes / DDL --- */
    CHECK("INSERT INTO t VALUES (1)", STMT_WRITE);
    CHECK("UPDATE t SET x = 1", STMT_WRITE);
    CHECK("DELETE FROM t", STMT_WRITE);
    CHECK("DROP TABLE t", STMT_WRITE);
    CHECK("CREATE TABLE t (a int)", STMT_WRITE);
    CHECK("ALTER TABLE t ADD COLUMN b int", STMT_WRITE);
    CHECK("TRUNCATE t", STMT_WRITE);
    CHECK("GRANT ALL ON t TO u", STMT_WRITE);
    CHECK("REPLACE INTO t VALUES (1)", STMT_WRITE);
    CHECK("CALL do_thing()", STMT_WRITE);
    CHECK("PRAGMA journal_mode = WAL", STMT_WRITE);
    CHECK("set autocommit=0", STMT_WRITE);

    /* --- CTEs --- */
    CHECK("WITH x AS (SELECT 1) SELECT * FROM x", STMT_READ);
    CHECK("with a as (select 1), b as (select 2) select * from a join b",
          STMT_READ);
    /* data-modifying CTE (PostgreSQL) => write */
    CHECK("WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d", STMT_WRITE);
    CHECK("WITH x AS (INSERT INTO t VALUES (1) RETURNING id) SELECT * FROM x",
          STMT_WRITE);

    /* --- multi-statement evasion --- */
    CHECK("SELECT 1; DROP TABLE t", STMT_WRITE);
    CHECK("SELECT 1 ; delete from t ; select 2", STMT_WRITE);

    /* --- comment evasion --- */
    CHECK("SELECT 1 -- ; DROP TABLE t", STMT_READ); /* the drop is commented out */
    CHECK("/* comment */ SELECT 1", STMT_READ);
    CHECK("/* x */ DROP TABLE t", STMT_WRITE);
    CHECK("SELECT 1; /* c */ DELETE FROM t", STMT_WRITE);
    CHECK("SELECT 1 /* not a real ; separator */ FROM t", STMT_READ);

    /* --- string-literal evasion: keyword / separator inside a string --- */
    CHECK("SELECT 'DROP TABLE t' AS note", STMT_READ);
    CHECK("SELECT 'a; DELETE FROM t' FROM dual", STMT_READ);
    CHECK("SELECT \"DELETE\" FROM t", STMT_READ);
    CHECK("SELECT 'it''s fine; really' FROM t", STMT_READ);

    /* --- quote-escaping evasion (fail-closed across both escape modes) --- */
    /* Under ANSI (no backslash escape) the first quote pair closes the string
       and `; DROP TABLE t` becomes live SQL => must be WRITE. */
    CHECK("SELECT 'a\\'; DROP TABLE t; -- '", STMT_WRITE);

    /* --- leading noise --- */
    CHECK("   \n  SELECT 1", STMT_READ);
    CHECK("\t/* c */\n  UPDATE t SET x=1", STMT_WRITE);

    if (failures == 0) {
        printf("stmt_class_test: all checks passed\n");
        return 0;
    }
    fprintf(stderr, "stmt_class_test: %d failure(s)\n", failures);
    return 1;
}
