#include "query_parse.h"

#include <stdio.h>
#include <string.h>

/* Unit tests for the mongosh-style query parser. Pure: no libbson/mongoc. */

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

static int streq(const char *a, const char *b)
{
    return a != NULL && b != NULL && strcmp(a, b) == 0;
}

int main(void)
{
    char err[128];

    /* Bare find(): empty filter defaults to {}. */
    {
        mongo_query q;
        int rc = mongo_query_parse("db.users.find()", &q, err, sizeof(err));
        EXPECT(rc == 0, "bare find parses");
        EXPECT(q.op == MONGO_OP_FIND, "op is find");
        EXPECT(streq(q.collection, "users"), "collection users");
        EXPECT(streq(q.filter, "{}"), "empty filter defaults to {}");
        EXPECT(q.projection == NULL, "no projection");
        EXPECT(q.sort == NULL, "no sort");
        EXPECT(q.limit == -1 && q.skip == -1, "limit/skip unset");
        mongo_query_free(&q);
    }

    /* find with a filter document (contains a nested object and a comma). */
    {
        mongo_query q;
        int rc = mongo_query_parse(
            "db.users.find({ age: { $gt: 25 }, active: true })", &q, err, sizeof(err));
        EXPECT(rc == 0, "find with filter parses");
        EXPECT(streq(q.filter, "{ age: { $gt: 25 }, active: true }"), "filter captured whole");
        EXPECT(q.projection == NULL, "single arg -> no projection");
        mongo_query_free(&q);
    }

    /* find with filter + projection (top-level comma splits the two). */
    {
        mongo_query q;
        int rc = mongo_query_parse(
            "db.users.find({a: 1}, {name: 1, _id: 0})", &q, err, sizeof(err));
        EXPECT(rc == 0, "find filter+projection parses");
        EXPECT(streq(q.filter, "{a: 1}"), "filter is first arg");
        EXPECT(streq(q.projection, "{name: 1, _id: 0}"), "projection is second arg");
        mongo_query_free(&q);
    }

    /* Chained sort / skip / limit. */
    {
        mongo_query q;
        int rc = mongo_query_parse(
            "db.users.find({}).sort({name: 1}).skip(10).limit(50)", &q, err, sizeof(err));
        EXPECT(rc == 0, "chained modifiers parse");
        EXPECT(streq(q.sort, "{name: 1}"), "sort captured");
        EXPECT(q.skip == 10, "skip 10");
        EXPECT(q.limit == 50, "limit 50");
        mongo_query_free(&q);
    }

    /* aggregate with a pipeline array. */
    {
        mongo_query q;
        int rc = mongo_query_parse(
            "db.orders.aggregate([{ $match: { paid: true } }, { $count: \"n\" }])",
            &q, err, sizeof(err));
        EXPECT(rc == 0, "aggregate parses");
        EXPECT(q.op == MONGO_OP_AGGREGATE, "op is aggregate");
        EXPECT(streq(q.collection, "orders"), "collection orders");
        EXPECT(streq(q.filter, "[{ $match: { paid: true } }, { $count: \"n\" }]"),
               "pipeline captured whole");
        mongo_query_free(&q);
    }

    /* Dotted collection name (e.g. system.profile). */
    {
        mongo_query q;
        int rc = mongo_query_parse("db.system.profile.find()", &q, err, sizeof(err));
        EXPECT(rc == 0, "dotted collection parses");
        EXPECT(streq(q.collection, "system.profile"), "dotted collection captured");
        mongo_query_free(&q);
    }

    /* A string argument containing brackets/quotes must not confuse the scanner. */
    {
        mongo_query q;
        int rc = mongo_query_parse(
            "db.c.find({ name: \"a)b,{c}\" })", &q, err, sizeof(err));
        EXPECT(rc == 0, "brackets inside a string are ignored");
        EXPECT(streq(q.filter, "{ name: \"a)b,{c}\" }"), "string-embedded brackets kept");
        EXPECT(q.projection == NULL, "comma inside string is not an arg separator");
        mongo_query_free(&q);
    }

    /* Leading/trailing whitespace and a trailing semicolon are tolerated. */
    {
        mongo_query q;
        int rc = mongo_query_parse("  db.users.find() ;  ", &q, err, sizeof(err));
        EXPECT(rc == 0, "surrounding whitespace + semicolon tolerated");
        mongo_query_free(&q);
    }

    /* --- error cases --- */
    {
        mongo_query q;
        EXPECT(mongo_query_parse("users.find()", &q, err, sizeof(err)) != 0,
               "missing db. prefix rejected");
        EXPECT(mongo_query_parse("db.users.remove({})", &q, err, sizeof(err)) != 0,
               "unsupported op rejected");
        EXPECT(mongo_query_parse("db.users.find({a:1)", &q, err, sizeof(err)) != 0,
               "unbalanced parens rejected");
        EXPECT(mongo_query_parse("db.users.find().foo({})", &q, err, sizeof(err)) != 0,
               "unsupported chained method rejected");
        EXPECT(mongo_query_parse("db.users.find().limit(-3)", &q, err, sizeof(err)) != 0,
               "negative limit rejected");
        EXPECT(mongo_query_parse("db.users.find().limit(abc)", &q, err, sizeof(err)) != 0,
               "non-numeric limit rejected");
        EXPECT(mongo_query_parse("db..find()", &q, err, sizeof(err)) != 0,
               "empty collection rejected");
        EXPECT(mongo_query_parse(NULL, &q, err, sizeof(err)) != 0,
               "NULL input rejected");
    }

    if (failures == 0) {
        printf("OK: mongodb mongosh query parser (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
