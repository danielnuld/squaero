#include "query_parse.h"

#include <stdio.h>
#include <stdlib.h>
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

    /* --- findOne maps to find with limit 1 --- */
    {
        mongo_query q;
        int rc = mongo_query_parse("db.users.findOne({a: 1}, {b: 1})", &q, err, sizeof(err));
        EXPECT(rc == 0, "findOne parses");
        EXPECT(q.op == MONGO_OP_FIND && q.limit == 1, "findOne is find limit 1");
        EXPECT(streq(q.filter, "{a: 1}") && streq(q.projection, "{b: 1}"),
               "findOne filter + projection");
        mongo_query_free(&q);
        EXPECT(mongo_query_parse("db.users.findOne().limit(3)", &q, err, sizeof(err)) != 0,
               "findOne takes no chain");
    }

    /* --- inserts --- */
    {
        mongo_query q;
        int rc = mongo_query_parse("db.users.insertOne({ name: 'ana', tags: [1, 2], n: {k: \"a,b\"} })",
                                   &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_INSERT_ONE, "insertOne parses");
        EXPECT(streq(q.collection, "users"), "insertOne collection");
        EXPECT(q.nargs == 1 && streq(q.args[0], "{ name: 'ana', tags: [1, 2], n: {k: \"a,b\"} }"),
               "insertOne document captured whole (commas in nested values)");
        mongo_query_free(&q);

        rc = mongo_query_parse("db.users.insertOne({})", &q, err, sizeof(err));
        EXPECT(rc == 0 && streq(q.args[0], "{}"), "insertOne of an empty document");
        mongo_query_free(&q);

        rc = mongo_query_parse("db.c.insertMany([{a:1}, {a:2}], {ordered: false})", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_INSERT_MANY && q.nargs == 2, "insertMany + options");
        EXPECT(streq(q.args[0], "[{a:1}, {a:2}]") && streq(q.args[1], "{ordered: false}"),
               "insertMany args");
        mongo_query_free(&q);

        rc = mongo_query_parse("db.c.insertMany([])", &q, err, sizeof(err));
        EXPECT(rc == 0 && streq(q.args[0], "[]"), "insertMany of an empty array parses");
        mongo_query_free(&q);

        EXPECT(mongo_query_parse("db.c.insertOne()", &q, err, sizeof(err)) != 0,
               "insertOne needs a document");
        EXPECT(mongo_query_parse("db.c.insertOne([1])", &q, err, sizeof(err)) != 0 &&
               strstr(err, "must be a document") != NULL,
               "insertOne rejects an array");
        EXPECT(mongo_query_parse("db.c.insertMany({a:1})", &q, err, sizeof(err)) != 0 &&
               strstr(err, "must be an array") != NULL,
               "insertMany rejects a document");
        EXPECT(mongo_query_parse("db.c.insertOne({a:1}, {}, {})", &q, err, sizeof(err)) != 0,
               "insertOne rejects too many arguments");
    }

    /* --- updates / replace / deletes --- */
    {
        mongo_query q;
        int rc = mongo_query_parse(
            "db.users.updateOne({_id: ObjectId(\"5f1d7f3e9b1e8a0012345678\")}, {$set: {a: [1,2]}}, {upsert: true})",
            &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_UPDATE_ONE && q.nargs == 3, "updateOne parses");
        EXPECT(streq(q.args[0], "{_id: ObjectId(\"5f1d7f3e9b1e8a0012345678\")}"),
               "updateOne filter keeps the constructor call");
        EXPECT(streq(q.args[1], "{$set: {a: [1,2]}}"), "updateOne update");
        EXPECT(streq(q.args[2], "{upsert: true}"), "updateOne options");
        mongo_query_free(&q);

        rc = mongo_query_parse("db.users.updateMany({}, [{$set: {a: 1}}])", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_UPDATE_MANY, "updateMany accepts a pipeline update");
        EXPECT(streq(q.args[0], "{}") && streq(q.args[1], "[{$set: {a: 1}}]"), "updateMany args");
        mongo_query_free(&q);

        rc = mongo_query_parse("db.users.replaceOne({a: 1}, {b: 2})", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_REPLACE_ONE && q.nargs == 2, "replaceOne parses");
        mongo_query_free(&q);

        rc = mongo_query_parse("db.users.deleteOne({a: 1})", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_DELETE_ONE && streq(q.args[0], "{a: 1}"), "deleteOne parses");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.users.deleteMany({})", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_DELETE_MANY && streq(q.args[0], "{}"), "deleteMany({}) parses");
        mongo_query_free(&q);

        EXPECT(mongo_query_parse("db.users.deleteMany()", &q, err, sizeof(err)) != 0 &&
               strstr(err, "at least 1") != NULL,
               "deleteMany() without a filter is refused");
        EXPECT(mongo_query_parse("db.users.updateOne({a: 1})", &q, err, sizeof(err)) != 0,
               "updateOne needs an update");
        EXPECT(mongo_query_parse("db.users.updateOne({a: 1}, 5)", &q, err, sizeof(err)) != 0,
               "updateOne update must be a document");
        EXPECT(mongo_query_parse("db.users.replaceOne({a: 1}, [1])", &q, err, sizeof(err)) != 0,
               "replaceOne replacement must be a document");
        EXPECT(mongo_query_parse("db.users.deleteOne({a: 1}) .foo()", &q, err, sizeof(err)) != 0,
               "no chain after a delete");
    }

    /* --- count / distinct --- */
    {
        mongo_query q;
        int rc = mongo_query_parse("db.users.countDocuments()", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_COUNT && q.nargs == 0, "countDocuments() parses");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.users.countDocuments({age: {$gt: 3}})", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.nargs == 1 && streq(q.args[0], "{age: {$gt: 3}}"), "countDocuments(filter)");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.users.distinct(\"city\", {active: true})", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_DISTINCT && q.nargs == 2, "distinct parses");
        EXPECT(streq(q.args[0], "\"city\"") && streq(q.args[1], "{active: true}"), "distinct args");
        mongo_query_free(&q);
        EXPECT(mongo_query_parse("db.users.distinct()", &q, err, sizeof(err)) != 0,
               "distinct needs a field");
        EXPECT(mongo_query_parse("db.users.distinct({a: 1})", &q, err, sizeof(err)) != 0,
               "distinct field must be a string");
    }

    /* --- indexes / collection management --- */
    {
        mongo_query q;
        int rc = mongo_query_parse("db.users.createIndex({email: 1}, {unique: true, name: 'ux'})",
                                   &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_CREATE_INDEX && q.nargs == 2, "createIndex parses");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.users.dropIndex('ux')", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_DROP_INDEX && streq(q.args[0], "'ux'"), "dropIndex by name");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.users.dropIndex({email: 1})", &q, err, sizeof(err));
        EXPECT(rc == 0 && streq(q.args[0], "{email: 1}"), "dropIndex by keys");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.users.getIndexes()", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_GET_INDEXES && q.nargs == 0, "getIndexes parses");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.users.drop()", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_DROP && streq(q.collection, "users"), "drop parses");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.system.js.drop();", &q, err, sizeof(err));
        EXPECT(rc == 0 && streq(q.collection, "system.js"), "drop on a dotted collection");
        mongo_query_free(&q);
        EXPECT(mongo_query_parse("db.users.getIndexes(1)", &q, err, sizeof(err)) != 0,
               "getIndexes takes no arguments");
        EXPECT(mongo_query_parse("db.users.createIndex()", &q, err, sizeof(err)) != 0,
               "createIndex needs keys");
    }

    /* --- db-level methods have no collection --- */
    {
        mongo_query q;
        int rc = mongo_query_parse("db.createCollection(\"logs\", {capped: true, size: 1048576})",
                                   &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_CREATE_COLLECTION && q.collection == NULL,
               "createCollection parses without a collection");
        EXPECT(q.nargs == 2 && streq(q.args[0], "\"logs\"") &&
                   streq(q.args[1], "{capped: true, size: 1048576}"),
               "createCollection args");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.runCommand({ping: 1})", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_RUN_COMMAND && q.collection == NULL &&
                   streq(q.args[0], "{ping: 1}"),
               "runCommand parses");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.runCommand(\"ping\")", &q, err, sizeof(err));
        EXPECT(rc == 0 && streq(q.args[0], "\"ping\""), "runCommand accepts a command name");
        mongo_query_free(&q);
        EXPECT(mongo_query_parse("db.users.runCommand({ping: 1})", &q, err, sizeof(err)) != 0 &&
                   strstr(err, "runs on the database") != NULL,
               "runCommand on a collection is refused");
        EXPECT(mongo_query_parse("db.insertOne({a: 1})", &q, err, sizeof(err)) != 0 &&
                   strstr(err, "runs on a collection") != NULL,
               "a collection method on the db is refused");
        EXPECT(mongo_query_parse("db.find()", &q, err, sizeof(err)) != 0,
               "find on the db is refused");
        EXPECT(mongo_query_parse("db.createCollection()", &q, err, sizeof(err)) != 0,
               "createCollection needs a name");
    }

    /* --- unknown methods are UNSUPPORTED, distinct from a syntax error --- */
    {
        mongo_query q;
        int rc = mongo_query_parse("db.users.bulkWrite([])", &q, err, sizeof(err));
        EXPECT(rc == MONGO_PARSE_UNSUPPORTED, "unknown method reports UNSUPPORTED");
        EXPECT(strstr(err, "unsupported operation 'bulkWrite'") != NULL, "error names the method");
        EXPECT(q.collection == NULL, "nothing left allocated on failure");
        EXPECT(mongo_query_parse("db.users.find({a:1)", &q, err, sizeof(err)) == MONGO_PARSE_SYNTAX,
               "a malformed command is a SYNTAX error");
        EXPECT(mongo_query_parse("db.users.remove({})", &q, err, sizeof(err)) == MONGO_PARSE_UNSUPPORTED,
               "remove is unsupported");
    }

    /* --- mongo_unquote --- */
    {
        char *u = mongo_unquote("\"abc\"");
        EXPECT(u != NULL && streq(u, "abc"), "unquote double");
        free(u);
        u = mongo_unquote("  'a\\'b\\\\c\\n'  ");
        EXPECT(u != NULL && streq(u, "a'b\\c\n"), "unquote single with escapes");
        free(u);
        u = mongo_unquote("\"\\u00e9\\ud83d\\ude00\"");
        EXPECT(u != NULL && streq(u, "\xc3\xa9\xf0\x9f\x98\x80"),
               "unquote \\u escapes incl. surrogate pair");
        free(u);
        u = mongo_unquote("\"\"");
        EXPECT(u != NULL && streq(u, ""), "unquote empty");
        free(u);
        EXPECT(mongo_unquote("abc") == NULL, "unquote needs quotes");
        EXPECT(mongo_unquote("\"abc") == NULL, "unquote unterminated");
        EXPECT(mongo_unquote("\"a\" \"b\"") == NULL, "unquote trailing text");
        EXPECT(mongo_unquote("\"\\uZZZZ\"") == NULL, "unquote bad \\u");
        EXPECT(mongo_unquote(NULL) == NULL, "unquote NULL");
    }

    /* --- db.getCollection("name") addresses any collection name --- */
    {
        mongo_query q;
        int rc = mongo_query_parse("db.getCollection(\"my-coll (v2)\").find({a: 1})", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_FIND, "getCollection + find parses");
        EXPECT(streq(q.collection, "my-coll (v2)"), "getCollection keeps parentheses and dashes");
        EXPECT(streq(q.filter, "{a: 1}"), "getCollection find filter");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.getCollection('it''s').deleteOne({a: 1})", &q, err, sizeof(err));
        EXPECT(rc != 0, "a malformed string literal is rejected");
        EXPECT(mongo_query_parse("db.getCollection(\"\").find()", &q, err, sizeof(err)) != 0,
               "empty getCollection name rejected");
        EXPECT(mongo_query_parse("db.getCollection(x).find()", &q, err, sizeof(err)) != 0,
               "getCollection needs a string literal");
        EXPECT(mongo_query_parse("db.getCollection(\"a\")", &q, err, sizeof(err)) != 0,
               "getCollection without a method rejected");
        EXPECT(mongo_query_parse("db.getCollection(\"a\").runCommand({ping: 1})", &q, err, sizeof(err)) != 0,
               "a db-level method on getCollection is refused");
    }

    /* --- createView --- */
    {
        mongo_query q;
        int rc = mongo_query_parse(
            "db.createView(\"active\", \"users\", [{$match: {active: true}}], {collation: {locale: 'en'}})",
            &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_CREATE_VIEW && q.collection == NULL && q.nargs == 4,
               "createView parses with four arguments");
        EXPECT(streq(q.args[2], "[{$match: {active: true}}]"), "createView pipeline");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.createView('v', 'c', [])", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.nargs == 3, "createView with an empty pipeline");
        mongo_query_free(&q);
        EXPECT(mongo_query_parse("db.createView('v', 'c')", &q, err, sizeof(err)) != 0,
               "createView needs a pipeline");
        EXPECT(mongo_query_parse("db.createView('v', 'c', {})", &q, err, sizeof(err)) != 0 &&
                   strstr(err, "must be an array") != NULL,
               "createView pipeline must be an array");
        EXPECT(mongo_query_parse("db.c.createView('v', 'c', [])", &q, err, sizeof(err)) != 0,
               "createView on a collection is refused");
    }

    /* --- explain: a trailing call on find / aggregate --- */
    {
        mongo_query q;
        int rc = mongo_query_parse("db.users.find({a: 1}).sort({a: -1}).limit(5).explain()", &q,
                                   err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_FIND && streq(q.explain, "queryPlanner"),
               "find().explain() defaults to queryPlanner");
        EXPECT(streq(q.sort, "{a: -1}") && q.limit == 5, "explain keeps the earlier modifiers");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.users.find().explain('executionStats');", &q, err, sizeof(err));
        EXPECT(rc == 0 && streq(q.explain, "executionStats"), "explain takes a verbosity");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.users.aggregate([{$match: {a: 1}}]).explain(\"allPlansExecution\")",
                               &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_AGGREGATE && streq(q.explain, "allPlansExecution") &&
                   streq(q.filter, "[{$match: {a: 1}}]"),
               "aggregate().explain()");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.users.find()", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.explain == NULL, "no explain unless asked");
        mongo_query_free(&q);
        EXPECT(mongo_query_parse("db.users.find().explain('verbose')", &q, err, sizeof(err)) != 0 &&
                   strstr(err, "queryPlanner") != NULL,
               "an unknown verbosity is refused");
        EXPECT(mongo_query_parse("db.users.find().explain().limit(1)", &q, err, sizeof(err)) != 0 &&
                   strstr(err, "last call") != NULL,
               "explain must be last");
        EXPECT(mongo_query_parse("db.users.aggregate([]).limit(1)", &q, err, sizeof(err)) != 0 &&
                   strstr(err, "explain") != NULL,
               "aggregate takes no modifiers other than explain");
        EXPECT(mongo_query_parse("db.users.findOne({}).explain()", &q, err, sizeof(err)) != 0,
               "findOne has no explain");
    }

    /* --- operations, profiler and collection management --- */
    {
        mongo_query q;
        int rc = mongo_query_parse("db.currentOp()", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_CURRENT_OP && q.collection == NULL && q.nargs == 0,
               "currentOp() parses");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.currentOp({active: true, secs_running: {$gt: 3}})", &q, err,
                               sizeof(err));
        EXPECT(rc == 0 && q.nargs == 1 && streq(q.args[0], "{active: true, secs_running: {$gt: 3}}"),
               "currentOp takes a filter document");
        mongo_query_free(&q);
        EXPECT(mongo_query_parse("db.currentOp(true)", &q, err, sizeof(err)) != 0,
               "currentOp(true) is refused (a filter document only)");
        EXPECT(mongo_query_parse("db.coll.currentOp()", &q, err, sizeof(err)) != 0 &&
                   strstr(err, "database") != NULL,
               "currentOp runs on the database");

        rc = mongo_query_parse("db.killOp(12345)", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_KILL_OP && streq(q.args[0], "12345"), "killOp(number)");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.killOp('shard01:99')", &q, err, sizeof(err));
        EXPECT(rc == 0 && streq(q.args[0], "'shard01:99'"), "killOp(string opid of a cluster)");
        mongo_query_free(&q);
        EXPECT(mongo_query_parse("db.killOp()", &q, err, sizeof(err)) != 0, "killOp needs an opid");
        EXPECT(mongo_query_parse("db.killOp({})", &q, err, sizeof(err)) != 0,
               "killOp takes a number or a string");

        rc = mongo_query_parse("db.setProfilingLevel(1, 50)", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_SET_PROFILING && q.nargs == 2 && streq(q.args[1], "50"),
               "setProfilingLevel(level, slowms)");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.setProfilingLevel(2, {slowms: 10, sampleRate: 0.5})", &q, err,
                               sizeof(err));
        EXPECT(rc == 0 && q.nargs == 2, "setProfilingLevel(level, options)");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.setProfilingLevel(0)", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.nargs == 1, "setProfilingLevel(0)");
        mongo_query_free(&q);
        EXPECT(mongo_query_parse("db.setProfilingLevel('all')", &q, err, sizeof(err)) != 0,
               "the profiling level is a number");
        rc = mongo_query_parse("db.getProfilingStatus()", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_GET_PROFILING, "getProfilingStatus()");
        mongo_query_free(&q);

        rc = mongo_query_parse("db.getCollectionInfos({type: 'view'})", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_COLLECTION_INFOS && q.nargs == 1,
               "getCollectionInfos(filter)");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.getCollectionInfos()", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.nargs == 0, "getCollectionInfos()");
        mongo_query_free(&q);

        rc = mongo_query_parse("db.orders.renameCollection('orders_old')", &q, err, sizeof(err));
        EXPECT(rc == 0 && q.op == MONGO_OP_RENAME && streq(q.collection, "orders") &&
                   streq(q.args[0], "'orders_old'") && q.nargs == 1,
               "renameCollection(new)");
        mongo_query_free(&q);
        rc = mongo_query_parse("db.getCollection('a-b').renameCollection(\"c\", true)", &q, err,
                               sizeof(err));
        EXPECT(rc == 0 && streq(q.collection, "a-b") && q.nargs == 2 && streq(q.args[1], "true"),
               "renameCollection(new, dropTarget) on a quoted name");
        mongo_query_free(&q);
        EXPECT(mongo_query_parse("db.orders.renameCollection()", &q, err, sizeof(err)) != 0,
               "renameCollection needs the new name");
        EXPECT(mongo_query_parse("db.orders.renameCollection('x', 1)", &q, err, sizeof(err)) != 0,
               "dropTarget is true or false");
        EXPECT(mongo_query_parse("db.renameCollection('x')", &q, err, sizeof(err)) != 0,
               "renameCollection runs on a collection");
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
