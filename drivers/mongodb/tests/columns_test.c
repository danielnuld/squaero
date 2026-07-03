#include "columns.h"

#include <stdio.h>
#include <string.h>

/* Unit tests for the flatten column-set accumulator: union of top-level field
   names across a page of documents, "_id" hoisted first, first-seen order
   otherwise, duplicates ignored. */

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

static int name_is(const mongo_columns *c, int idx, const char *want)
{
    const char *got = mongo_columns_name(c, idx);
    return got != NULL && strcmp(got, want) == 0;
}

int main(void)
{
    /* Nominal: two documents with a partly overlapping shape. Union preserves
       first-seen order; "_id" leads. */
    {
        mongo_columns *c = mongo_columns_new();
        /* doc1: {_id, name, age} */
        mongo_columns_observe(c, "_id");
        mongo_columns_observe(c, "name");
        mongo_columns_observe(c, "age");
        /* doc2: {_id, name, address} — address is new, the rest are dupes */
        mongo_columns_observe(c, "_id");
        mongo_columns_observe(c, "name");
        mongo_columns_observe(c, "address");

        EXPECT(mongo_columns_count(c) == 4, "union has 4 columns");
        EXPECT(name_is(c, 0, "_id"), "col0 is _id");
        EXPECT(name_is(c, 1, "name"), "col1 is name");
        EXPECT(name_is(c, 2, "age"), "col2 is age");
        EXPECT(name_is(c, 3, "address"), "col3 is address");
        EXPECT(mongo_columns_index_of(c, "age") == 2, "index_of age");
        EXPECT(mongo_columns_index_of(c, "missing") == -1, "index_of missing = -1");
        mongo_columns_free(c);
    }

    /* Edge: _id observed AFTER other fields (e.g. a projection on the first doc
       dropped it) must still be hoisted to column 0, shifting the rest up. */
    {
        mongo_columns *c = mongo_columns_new();
        mongo_columns_observe(c, "name");
        mongo_columns_observe(c, "age");
        mongo_columns_observe(c, "_id");

        EXPECT(mongo_columns_count(c) == 3, "3 columns after late _id");
        EXPECT(name_is(c, 0, "_id"), "late _id hoisted to col0");
        EXPECT(name_is(c, 1, "name"), "name shifted to col1");
        EXPECT(name_is(c, 2, "age"), "age shifted to col2");
        mongo_columns_free(c);
    }

    /* Edge: growth past the initial capacity (add > 8 distinct fields). */
    {
        mongo_columns *c = mongo_columns_new();
        char buf[16];
        for (int i = 0; i < 20; i++) {
            snprintf(buf, sizeof(buf), "f%d", i);
            EXPECT(mongo_columns_observe(c, buf) == 0, "observe grows");
        }
        EXPECT(mongo_columns_count(c) == 20, "20 columns after growth");
        EXPECT(name_is(c, 0, "f0"), "f0 first");
        EXPECT(name_is(c, 19, "f19"), "f19 last");
        mongo_columns_free(c);
    }

    /* Edge: repeated _id stays a single column at position 0. */
    {
        mongo_columns *c = mongo_columns_new();
        mongo_columns_observe(c, "_id");
        mongo_columns_observe(c, "x");
        mongo_columns_observe(c, "_id");
        EXPECT(mongo_columns_count(c) == 2, "_id not duplicated");
        EXPECT(name_is(c, 0, "_id"), "_id still col0");
        mongo_columns_free(c);
    }

    /* Edge: NULL name / NULL accumulator are rejected, not crashes. */
    EXPECT(mongo_columns_observe(NULL, "x") == -1, "NULL accumulator -> -1");
    {
        mongo_columns *c = mongo_columns_new();
        EXPECT(mongo_columns_observe(c, NULL) == -1, "NULL name -> -1");
        EXPECT(mongo_columns_count(c) == 0, "no column added for NULL name");
        mongo_columns_free(c);
    }

    if (failures == 0) {
        printf("OK: mongodb flatten column accumulator (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
