#include "dml.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Unit tests for the pure mongosh DML builder. No libbson/mongoc. */

static int failures = 0;

static void expect_str(const char *got, const char *want, const char *what)
{
    if (got == NULL || strcmp(got, want) != 0) {
        fprintf(stderr, "FAIL: %s\n  got:  %s\n  want: %s\n", what, got ? got : "(null)", want);
        failures++;
    }
}

#define OID "5f1d7f3e9b1e8a0012345678"

/* Build and compare. */
static void check(dbc_dml_kind kind, const dbc_dml_row *row, const char *want, const char *what)
{
    char err[200];
    char *got = mongo_build_dml(kind, row, err, sizeof err);
    if (got == NULL) {
        fprintf(stderr, "FAIL: %s returned NULL (%s)\n", what, err);
        failures++;
        return;
    }
    expect_str(got, want, what);
    free(got);
}

/* Build and require a failure whose message contains `frag`. */
static void check_fails(dbc_dml_kind kind, const dbc_dml_row *row, const char *frag, const char *what)
{
    char err[200] = "";
    char *got = mongo_build_dml(kind, row, err, sizeof err);
    if (got != NULL) {
        fprintf(stderr, "FAIL: %s should have failed, got %s\n", what, got);
        failures++;
        free(got);
        return;
    }
    if (strstr(err, frag) == NULL) {
        fprintf(stderr, "FAIL: %s error '%s' lacks '%s'\n", what, err, frag);
        failures++;
    }
}

int main(void)
{
    /* --- DELETE: the key matches the ObjectId and the string form --- */
    {
        const char *wc[] = {"_id"};
        const char *wv[] = {OID};
        dbc_dml_row row = {.table = "users", .n_where = 1, .where_cols = wc, .where_vals = wv};
        check(DBC_DML_DELETE, &row,
              "db.users.deleteOne({\"$or\": [{\"_id\": {\"$oid\": \"" OID "\"}}, {\"_id\": \"" OID "\"}]})",
              "delete by ObjectId text");
    }
    /* integer _id: number or string */
    {
        const char *wc[] = {"_id"};
        const char *wv[] = {"42"};
        dbc_dml_row row = {.table = "users", .n_where = 1, .where_cols = wc, .where_vals = wv};
        check(DBC_DML_DELETE, &row,
              "db.users.deleteOne({\"$or\": [{\"_id\": 42}, {\"_id\": \"42\"}]})",
              "delete by integer text");
    }
    /* plain string _id, with quotes needing escapes */
    {
        const char *wc[] = {"_id"};
        const char *wv[] = {"a\"b\\c"};
        dbc_dml_row row = {.table = "users", .n_where = 1, .where_cols = wc, .where_vals = wv};
        check(DBC_DML_DELETE, &row, "db.users.deleteOne({\"_id\": \"a\\\"b\\\\c\"})",
              "delete by string key is escaped");
    }
    /* a leading-zero number stays a string only */
    {
        const char *wc[] = {"_id"};
        const char *wv[] = {"007"};
        dbc_dml_row row = {.table = "users", .n_where = 1, .where_cols = wc, .where_vals = wv};
        check(DBC_DML_DELETE, &row, "db.users.deleteOne({\"_id\": \"007\"})", "007 is not a number");
    }
    /* an ISO date _id */
    {
        const char *wc[] = {"_id"};
        const char *wv[] = {"2021-01-01T00:00:00.000Z"};
        dbc_dml_row row = {.table = "t", .n_where = 1, .where_cols = wc, .where_vals = wv};
        check(DBC_DML_DELETE, &row,
              "db.t.deleteOne({\"$or\": [{\"_id\": {\"$date\": \"2021-01-01T00:00:00.000Z\"}}, "
              "{\"_id\": \"2021-01-01T00:00:00.000Z\"}]})",
              "date key");
    }
    /* a document _id (the grid shows it as JSON), relaxed syntax accepted */
    {
        const char *wc[] = {"_id"};
        const char *wv[] = {"{\"a\":1,\"b\":\"x\"}"};
        dbc_dml_row row = {.table = "t", .n_where = 1, .where_cols = wc, .where_vals = wv};
        check(DBC_DML_DELETE, &row, "db.t.deleteOne({\"_id\": {\"a\":1,\"b\":\"x\"}})", "document key");
        const char *wv2[] = {"{a:1}"};
        row.where_vals = wv2;
        check(DBC_DML_DELETE, &row, "db.t.deleteOne({\"_id\": {\"a\":1}})", "relaxed document key");
    }
    /* NULL key matches null/missing */
    {
        const char *wc[] = {"k"};
        const char *wv[] = {NULL};
        dbc_dml_row row = {.table = "t", .n_where = 1, .where_cols = wc, .where_vals = wv};
        check(DBC_DML_DELETE, &row, "db.t.deleteOne({\"k\": null})", "null key");
    }
    /* several key columns are ANDed */
    {
        const char *wc[] = {"a", "b"};
        const char *wv[] = {"x", "true"};
        dbc_dml_row row = {.table = "t", .n_where = 2, .where_cols = wc, .where_vals = wv};
        check(DBC_DML_DELETE, &row,
              "db.t.deleteOne({\"$and\": [{\"a\": \"x\"}, {\"$or\": [{\"b\": true}, {\"b\": \"true\"}]}]})",
              "compound key");
    }
    check_fails(DBC_DML_DELETE, &(dbc_dml_row){.table = "t"}, "refusing", "delete without a key");

    /* --- UPDATE --- */
    {
        const char *sc[] = {"name", "age", "score", "active", "meta", "born", "note"};
        const char *sv[] = {"ana", "30", "7", "1", "{\"k\":[1,2]}", "2020-05-06T07:08:09.010Z", NULL};
        dbc_type st[] = {DBC_TYPE_TEXT, DBC_TYPE_INT, DBC_TYPE_FLOAT, DBC_TYPE_BOOL,
                         DBC_TYPE_JSON, DBC_TYPE_TIMESTAMP, DBC_TYPE_TEXT};
        const char *wc[] = {"_id"};
        const char *wv[] = {OID};
        dbc_dml_row row = {.table = "users", .n_set = 7, .set_cols = sc, .set_vals = sv,
                           .n_where = 1, .where_cols = wc, .where_vals = wv, .set_types = st};
        check(DBC_DML_UPDATE, &row,
              "db.users.updateOne({\"$or\": [{\"_id\": {\"$oid\": \"" OID "\"}}, {\"_id\": \"" OID "\"}]}, "
              "{\"$set\": {\"name\": \"ana\", \"age\": 30, \"score\": {\"$numberDouble\": \"7\"}, "
              "\"active\": true, \"meta\": {\"k\":[1,2]}, "
              "\"born\": {\"$date\": \"2020-05-06T07:08:09.010Z\"}, \"note\": null}})",
              "update with typed values");
    }
    /* a float with a fraction stays a plain number; invalid numerics fall back to strings */
    {
        const char *sc[] = {"f", "i", "b", "d"};
        const char *sv[] = {"1.5", "abc", "maybe", "yesterday"};
        dbc_type st[] = {DBC_TYPE_FLOAT, DBC_TYPE_INT, DBC_TYPE_BOOL, DBC_TYPE_DATE};
        const char *wc[] = {"_id"};
        const char *wv[] = {"k"};
        dbc_dml_row row = {.table = "c", .n_set = 4, .set_cols = sc, .set_vals = sv,
                           .n_where = 1, .where_cols = wc, .where_vals = wv, .set_types = st};
        check(DBC_DML_UPDATE, &row,
              "db.c.updateOne({\"_id\": \"k\"}, {\"$set\": {\"f\": 1.5, \"i\": \"abc\", "
              "\"b\": \"maybe\", \"d\": \"yesterday\"}})",
              "values that do not fit their type stay strings");
    }
    /* no set_types: conservative inference */
    {
        const char *sc[] = {"a", "b", "c", "d", "e", "f"};
        const char *sv[] = {"12", "true", "{x: 1}", "hello", "007", "[1, 2"};
        const char *wc[] = {"_id"};
        const char *wv[] = {"k"};
        dbc_dml_row row = {.table = "c", .n_set = 6, .set_cols = sc, .set_vals = sv,
                           .n_where = 1, .where_cols = wc, .where_vals = wv};
        check(DBC_DML_UPDATE, &row,
              "db.c.updateOne({\"_id\": \"k\"}, {\"$set\": {\"a\": 12, \"b\": true, \"c\": {\"x\": 1}, "
              "\"d\": \"hello\", \"e\": \"007\", \"f\": \"[1, 2\"}})",
              "inferred types without set_types");
    }
    /* _id is never $set; only _id to update is an error */
    {
        const char *sc[] = {"_id", "n"};
        const char *sv[] = {"zzz", "1"};
        dbc_type st[] = {DBC_TYPE_TEXT, DBC_TYPE_INT};
        const char *wc[] = {"_id"};
        const char *wv[] = {"k"};
        dbc_dml_row row = {.table = "c", .n_set = 2, .set_cols = sc, .set_vals = sv,
                           .n_where = 1, .where_cols = wc, .where_vals = wv, .set_types = st};
        check(DBC_DML_UPDATE, &row, "db.c.updateOne({\"_id\": \"k\"}, {\"$set\": {\"n\": 1}})",
              "_id is skipped in $set");
        row.n_set = 1;
        check_fails(DBC_DML_UPDATE, &row, "no fields to update", "update of _id only");
    }
    /* invalid JSON in a JSON cell is refused (and cannot break out of the statement) */
    {
        const char *sc[] = {"meta"};
        const char *sv[] = {"{} , {\"x\": 1}"};
        dbc_type st[] = {DBC_TYPE_JSON};
        const char *wc[] = {"_id"};
        const char *wv[] = {"k"};
        dbc_dml_row row = {.table = "c", .n_set = 1, .set_cols = sc, .set_vals = sv,
                           .n_where = 1, .where_cols = wc, .where_vals = wv, .set_types = st};
        check_fails(DBC_DML_UPDATE, &row, "not valid JSON", "JSON cell with an injected argument");
        const char *sv2[] = {"{\"a\": "};
        row.set_vals = sv2;
        check_fails(DBC_DML_UPDATE, &row, "(field \"meta\")", "truncated JSON cell");
    }
    check_fails(DBC_DML_UPDATE, &(dbc_dml_row){.table = "c", .n_set = 0}, "refusing", "update without key");

    /* --- INSERT --- */
    {
        const char *sc[] = {"_id", "name", "age", "tags", "gone"};
        const char *sv[] = {OID, "bob", "41", "[\"a\",\"b\"]", NULL};
        dbc_type st[] = {DBC_TYPE_TEXT, DBC_TYPE_TEXT, DBC_TYPE_INT, DBC_TYPE_JSON, DBC_TYPE_TEXT};
        dbc_dml_row row = {.table = "users", .n_set = 5, .set_cols = sc, .set_vals = sv, .set_types = st};
        check(DBC_DML_INSERT, &row,
              "db.users.insertOne({\"_id\": {\"$oid\": \"" OID "\"}, \"name\": \"bob\", \"age\": 41, "
              "\"tags\": [\"a\",\"b\"]})",
              "insert: ObjectId _id, NULL omitted");
    }
    {
        const char *sc[] = {"_id", "n"};
        const char *sv[] = {"", "x"};
        dbc_dml_row row = {.table = "users", .n_set = 2, .set_cols = sc, .set_vals = sv};
        check(DBC_DML_INSERT, &row, "db.users.insertOne({\"n\": \"x\"})", "insert: empty _id is generated");
        const char *sv2[] = {NULL, NULL};
        row.set_vals = sv2;
        check(DBC_DML_INSERT, &row, "db.users.insertOne({})", "insert: all NULL is an empty document");
        check(DBC_DML_INSERT, &(dbc_dml_row){.table = "users"}, "db.users.insertOne({})", "insert: no columns");
    }
    {
        const char *sc[] = {"_id"};
        const char *sv[] = {"17"};
        dbc_type st[] = {DBC_TYPE_INT};
        dbc_dml_row row = {.table = "users", .n_set = 1, .set_cols = sc, .set_vals = sv, .set_types = st};
        check(DBC_DML_INSERT, &row, "db.users.insertOne({\"_id\": 17})", "insert: integer _id");
    }

    /* --- collection reference --- */
    {
        const char *wc[] = {"_id"};
        const char *wv[] = {"1"};
        dbc_dml_row row = {.table = "my-coll (v2)", .n_where = 1, .where_cols = wc, .where_vals = wv};
        check(DBC_DML_DELETE, &row,
              "db.getCollection(\"my-coll (v2)\").deleteOne({\"$or\": [{\"_id\": 1}, {\"_id\": \"1\"}]})",
              "unusual collection names go through getCollection");
        row.table = "system.profile";
        check(DBC_DML_DELETE, &row,
              "db.system.profile.deleteOne({\"$or\": [{\"_id\": 1}, {\"_id\": \"1\"}]})",
              "dotted names stay bare");
    }

    /* --- errors --- */
    check_fails(DBC_DML_INSERT, NULL, "collection name", "NULL row");
    check_fails(DBC_DML_INSERT, &(dbc_dml_row){.table = ""}, "collection name", "empty table");
    check_fails(DBC_DML_INSERT, &(dbc_dml_row){.table = NULL}, "collection name", "no table");
    check_fails((dbc_dml_kind)99, &(dbc_dml_row){.table = "t"}, "unknown", "unknown kind");

    if (failures == 0) {
        printf("OK: mongodb DML builder (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
