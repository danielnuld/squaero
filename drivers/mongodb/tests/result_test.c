#include "result.h"

#include <stdlib.h>
#include <stdio.h>
#include <string.h>

/* Unit tests for the materialized result builder + vtable readers. Pure: no
   libbson/mongoc. */

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

/* Helper: an owned copy of a literal, as the mongoc layer would hand over. */
static char *own(const char *s)
{
    size_t n = strlen(s) + 1;
    char *p = malloc(n);
    memcpy(p, s, n);
    return p;
}

int main(void)
{
    /* Build a 2-column result with a NULL cell and iterate it. */
    {
        dbc_result *r = mongo_result_new();
        EXPECT(r != NULL, "new result");
        EXPECT(mongo_col_count(r) == 0, "empty has 0 cols");

        EXPECT(mongo_result_add_column(r, "_id", DBC_TYPE_TEXT) == 0, "add col _id");
        EXPECT(mongo_result_add_column(r, "age", DBC_TYPE_NULL) == 0, "add col age");
        mongo_result_set_col_type(r, 1, DBC_TYPE_INT); /* refine once value seen */

        EXPECT(mongo_col_count(r) == 2, "2 columns");
        EXPECT(strcmp(mongo_col_name(r, 0), "_id") == 0, "col0 name");
        EXPECT(mongo_col_type(r, 1) == DBC_TYPE_INT, "col1 type refined to int");
        EXPECT(mongo_col_name(r, 2) == NULL, "col OOB name NULL");
        EXPECT(mongo_col_type(r, 5) == DBC_TYPE_NULL, "col OOB type NULL");

        char **row1 = malloc(2 * sizeof *row1);
        row1[0] = own("507f");
        row1[1] = own("30");
        EXPECT(mongo_result_add_row(r, row1) == 0, "add row1");

        char **row2 = malloc(2 * sizeof *row2);
        row2[0] = own("508a");
        row2[1] = NULL; /* SQL NULL: this document had no 'age' */
        EXPECT(mongo_result_add_row(r, row2) == 0, "add row2");

        /* Before the first next_row, cell_text is NULL (no current row). */
        EXPECT(mongo_cell_text(r, 0) == NULL, "no current row before next_row");

        EXPECT(mongo_next_row(r) == 1, "row1 ready");
        EXPECT(strcmp(mongo_cell_text(r, 0), "507f") == 0, "row1 c0");
        EXPECT(strcmp(mongo_cell_text(r, 1), "30") == 0, "row1 c1");

        EXPECT(mongo_next_row(r) == 1, "row2 ready");
        EXPECT(strcmp(mongo_cell_text(r, 0), "508a") == 0, "row2 c0");
        EXPECT(mongo_cell_text(r, 1) == NULL, "row2 c1 is SQL NULL");

        EXPECT(mongo_next_row(r) == 0, "end after 2 rows");
        EXPECT(mongo_next_row(r) == 0, "stays at end");

        mongo_free_result(r); /* frees rows + cells; no leak under a sanitizer */
    }

    /* A write-style result: no columns, only an affected count. */
    {
        dbc_result *r = mongo_result_new();
        mongo_result_set_affected(r, 7);
        EXPECT(mongo_col_count(r) == 0, "no columns");
        EXPECT(mongo_next_row(r) == 0, "no rows to iterate");
        EXPECT(mongo_rows_affected(r) == 7, "affected reported");
        mongo_free_result(r);
    }

    /* Type-name mapping mirrors ipc_type_name. */
    EXPECT(strcmp(mongo_type_name(DBC_TYPE_JSON), "json") == 0, "json name");
    EXPECT(strcmp(mongo_type_name(DBC_TYPE_INT), "int") == 0, "int name");
    EXPECT(strcmp(mongo_type_name(DBC_TYPE_TIMESTAMP), "timestamp") == 0, "timestamp name");
    EXPECT(strcmp(mongo_type_name(DBC_TYPE_NULL), "null") == 0, "null name");

    /* NULL-safety of the readers. */
    EXPECT(mongo_col_count(NULL) == 0, "NULL col_count");
    EXPECT(mongo_next_row(NULL) == 0, "NULL next_row");
    EXPECT(mongo_cell_text(NULL, 0) == NULL, "NULL cell_text");
    mongo_free_result(NULL);

    if (failures == 0) {
        printf("OK: mongodb result builder (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
