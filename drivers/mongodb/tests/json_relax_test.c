#include "json_relax.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Unit tests for the relaxed-JSON -> strict-JSON normalizer. Pure. */

static int failures = 0;

static void check(const char *in, const char *want)
{
    char *got = mongo_json_relax(in);
    if (got == NULL || strcmp(got, want) != 0) {
        fprintf(stderr, "FAIL: '%s' -> '%s' (want '%s')\n",
                in, got ? got : "(null)", want);
        failures++;
    }
    free(got);
}

int main(void)
{
    /* Bare keys get quoted; already-quoted keys are left alone. */
    check("{a:1}", "{\"a\":1}");
    check("{\"a\":1}", "{\"a\":1}");

    /* Nested objects and $-operators. */
    check("{ age: { $gt: 25 } }", "{ \"age\": { \"$gt\": 25 } }");

    /* Dotted keys are a single identifier. */
    check("{a.b:1}", "{\"a.b\":1}");

    /* Multiple keys, mixed with a quoted string value. */
    check("{name: \"ana\", active: true}",
          "{\"name\": \"ana\", \"active\": true}");

    /* Single-quoted string values become double-quoted. */
    check("{name: 'ana'}", "{\"name\": \"ana\"}");

    /* A brace/comma/colon INSIDE a string must not be treated as structure,
       and the string content is preserved verbatim. */
    check("{k: \"a:b,{c}\"}", "{\"k\": \"a:b,{c}\"}");

    /* Literals true/false/null and numbers as values are not touched. */
    check("{a: true, b: false, c: null, d: 3.5}",
          "{\"a\": true, \"b\": false, \"c\": null, \"d\": 3.5}");

    /* Arrays of objects (aggregate pipelines). */
    check("[{ $match: { x: 1 } }, { $limit: 5 }]",
          "[{ \"$match\": { \"x\": 1 } }, { \"$limit\": 5 }]");

    /* A double quote embedded in a single-quoted string is escaped. */
    check("{k: 'a\"b'}", "{\"k\": \"a\\\"b\"}");

    /* An empty object/array round-trips. */
    check("{}", "{}");
    check("[]", "[]");

    /* NULL input yields NULL, not a crash. */
    if (mongo_json_relax(NULL) != NULL) {
        fprintf(stderr, "FAIL: NULL input should return NULL\n");
        failures++;
    }

    if (failures == 0) {
        printf("OK: mongodb relaxed-json normalizer (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
