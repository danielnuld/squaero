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

    /* A literal after a comma inside an array is a value, not a key. */
    check("{a: [1, true, null]}", "{\"a\": [1, true, null]}");
    check("{$in: [x, y]}", "{\"$in\": [x, y]}");

    /* A key is only an identifier followed by a colon. */
    check("{a : 1, b : 2}", "{\"a\" : 1, \"b\" : 2}");

    /* mongosh constructors become Extended JSON. */
    check("{_id: ObjectId(\"5f1d7f3e9b1e8a0012345678\")}",
          "{\"_id\": {\"$oid\":\"5f1d7f3e9b1e8a0012345678\"}}");
    check("{_id: ObjectId('5f1d7f3e9b1e8a0012345678')}",
          "{\"_id\": {\"$oid\":\"5f1d7f3e9b1e8a0012345678\"}}");
    check("{at: ISODate(\"2020-01-02T03:04:05Z\")}",
          "{\"at\": {\"$date\":\"2020-01-02T03:04:05Z\"}}");
    check("{at: new Date(\"2020-01-02T03:04:05Z\")}",
          "{\"at\": {\"$date\":\"2020-01-02T03:04:05Z\"}}");
    check("{n: NumberLong(42), m: NumberInt(\"7\"), d: NumberDecimal(\"1.5\")}",
          "{\"n\": {\"$numberLong\":\"42\"}, \"m\": {\"$numberInt\":\"7\"}, "
          "\"d\": {\"$numberDecimal\":\"1.5\"}}");
    /* Constructors inside an array, after a comma, spaces before the paren. */
    check("{_id: {$in: [ObjectId(\"a\"), ObjectId (\"b\")]}}",
          "{\"_id\": {\"$in\": [{\"$oid\":\"a\"}, {\"$oid\":\"b\"}]}}");
    /* A key named like a constructor / "new" is still a key. */
    check("{Date: 1, new: 2}", "{\"Date\": 1, \"new\": 2}");
    /* A constructor with an unsupported argument is left alone (bson reports it). */
    check("{a: ObjectId(x)}", "{\"a\": ObjectId(x)}");
    /* Constructor-looking text inside a string is untouched. */
    check("{s: \"ObjectId('a')\"}", "{\"s\": \"ObjectId('a')\"}");

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
