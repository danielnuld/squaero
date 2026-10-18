#include "ddl.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Unit tests for the pure mongosh collection-definition builder. */

static int failures = 0;

static void check(const mongo_ddl_spec *spec, const char *want, const char *what)
{
    char *got = mongo_build_ddl(spec);
    if (got == NULL || strcmp(got, want) != 0) {
        fprintf(stderr, "FAIL: %s\n--- got ---\n%s--- want ---\n%s", what, got ? got : "(null)\n", want);
        failures++;
    }
    free(got);
}

int main(void)
{
    /* A plain collection: just the createCollection line; _id_ is never emitted. */
    {
        mongo_ddl_index ix[] = {{"_id_", "{ \"_id\" : 1 }", NULL}};
        mongo_ddl_spec spec = {.collection = "users", .n_indexes = 1, .indexes = ix};
        check(&spec, "db.createCollection(\"users\");\n", "plain collection, only the default index");
        spec.options_json = "{ }";
        check(&spec, "db.createCollection(\"users\");\n", "an empty options object is omitted");
        spec.options_json = "{}";
        check(&spec, "db.createCollection(\"users\");\n", "{} options omitted");
    }

    /* Options (capped, validator) are embedded verbatim. */
    {
        mongo_ddl_spec spec = {
            .collection = "logs",
            .options_json = "{ \"capped\" : true, \"size\" : 1048576, \"max\" : 100 }"};
        check(&spec,
              "db.createCollection(\"logs\", { \"capped\" : true, \"size\" : 1048576, \"max\" : 100 });\n",
              "capped collection");
        spec.collection = "orders";
        spec.options_json =
            "{ \"validator\" : { \"$jsonSchema\" : { \"required\" : [ \"sku\" ] } }, "
            "\"validationLevel\" : \"strict\", \"validationAction\" : \"error\" }";
        check(&spec,
              "db.createCollection(\"orders\", { \"validator\" : { \"$jsonSchema\" : { \"required\" : [ \"sku\" ] } }, "
              "\"validationLevel\" : \"strict\", \"validationAction\" : \"error\" });\n",
              "validator collection");
    }

    /* Indexes: sorted by name, name merged into the options, _id_ skipped. */
    {
        mongo_ddl_index ix[] = {
            {"zip_1", "{ \"zip\" : 1 }", "{ \"sparse\" : true }"},
            {"_id_", "{ \"_id\" : 1 }", NULL},
            {"email_1", "{ \"email\" : 1 }", "{ \"unique\" : true, \"partialFilterExpression\" : { \"a\" : { \"$gt\" : 1 } } }"},
            {"a_1_b_-1", "{ \"a\" : 1, \"b\" : -1 }", "{}"},
        };
        mongo_ddl_spec spec = {.collection = "users", .n_indexes = 4, .indexes = ix};
        const char *want =
            "db.createCollection(\"users\");\n"
            "db.users.createIndex({ \"a\" : 1, \"b\" : -1 }, { \"name\": \"a_1_b_-1\" });\n"
            "db.users.createIndex({ \"email\" : 1 }, { \"name\": \"email_1\", \"unique\" : true, "
            "\"partialFilterExpression\" : { \"a\" : { \"$gt\" : 1 } } });\n"
            "db.users.createIndex({ \"zip\" : 1 }, { \"name\": \"zip_1\", \"sparse\" : true });\n";
        check(&spec, want, "indexes sorted by name with their options");
        /* Deterministic whatever the input order. */
        mongo_ddl_index rev[] = {ix[3], ix[2], ix[1], ix[0]};
        spec.indexes = rev;
        check(&spec, want, "input order does not matter");
    }

    /* A name that needs getCollection(). */
    {
        mongo_ddl_index ix[] = {{"t_1", "{ \"t\" : 1 }", "{ \"expireAfterSeconds\" : 3600 }"}};
        mongo_ddl_spec spec = {.collection = "my-coll", .n_indexes = 1, .indexes = ix};
        check(&spec,
              "db.createCollection(\"my-coll\");\n"
              "db.getCollection(\"my-coll\").createIndex({ \"t\" : 1 }, { \"name\": \"t_1\", \"expireAfterSeconds\" : 3600 });\n",
              "unusual collection name");
    }

    /* A view. */
    {
        mongo_ddl_spec spec = {.collection = "active_users", .view_on = "users",
                               .view_pipeline = "[ { \"$match\" : { \"active\" : true } } ]"};
        check(&spec,
              "db.createView(\"active_users\", \"users\", [ { \"$match\" : { \"active\" : true } } ]);\n",
              "view");
        spec.options_json = "{ \"collation\" : { \"locale\" : \"en\" } }";
        check(&spec,
              "db.createView(\"active_users\", \"users\", [ { \"$match\" : { \"active\" : true } } ], "
              "{ \"collation\" : { \"locale\" : \"en\" } });\n",
              "view with collation");
        spec.view_pipeline = NULL;
        spec.options_json = NULL;
        check(&spec, "db.createView(\"active_users\", \"users\", []);\n",
              "view without a pipeline defaults to []");
    }

    /* Invalid specs. */
    if (mongo_build_ddl(NULL) != NULL) {
        fprintf(stderr, "FAIL: NULL spec\n");
        failures++;
    }
    {
        mongo_ddl_spec spec = {.collection = ""};
        if (mongo_build_ddl(&spec) != NULL) {
            fprintf(stderr, "FAIL: empty name\n");
            failures++;
        }
        spec.collection = NULL;
        if (mongo_build_ddl(&spec) != NULL) {
            fprintf(stderr, "FAIL: NULL name\n");
            failures++;
        }
    }

    if (failures == 0) {
        printf("OK: mongodb DDL builder (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
