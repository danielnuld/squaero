#ifndef QUAERO_MONGODB_QUERY_PARSE_H
#define QUAERO_MONGODB_QUERY_PARSE_H

#include <stddef.h>

/*
 * mongosh-style command parser.
 *
 * Squaero's query channel hands the driver a single command string (the vtable's
 * `sql` argument). For MongoDB the user writes a mongosh-style expression:
 *
 *   reads
 *     db.<coll>.find(<filter?>, <projection?>)[.sort(<doc>)][.skip(<n>)][.limit(<n>)]
 *     db.<coll>.findOne(<filter?>, <projection?>)
 *     db.<coll>.aggregate(<pipeline-array>)
 *     db.<coll>.countDocuments(<filter?>)
 *     db.<coll>.distinct(<field>, <filter?>)
 *   writes
 *     db.<coll>.insertOne(<doc>)          db.<coll>.insertMany(<docs-array>)
 *     db.<coll>.updateOne(<filter>, <update>, <opts?>)   (and updateMany)
 *     db.<coll>.replaceOne(<filter>, <doc>, <opts?>)
 *     db.<coll>.deleteOne(<filter>)       db.<coll>.deleteMany(<filter>)
 *   indexes / collections / raw commands
 *     db.<coll>.createIndex(<keys>, <opts?>)   db.<coll>.dropIndex(<name|keys>)
 *     db.<coll>.getIndexes()                   db.<coll>.drop()
 *     db.createCollection(<name>, <opts?>)     db.runCommand(<doc|"name">)
 *     db.createView(<name>, <source>, <pipeline>, <opts?>)
 *     db.getCollection("<name>").<method>(...)  (any collection name)
 *
 * This module is the PURE front half: it validates the command shape and slices
 * out the argument spans (and the numeric skip/limit), WITHOUT parsing the JSON
 * itself and without any libbson/mongoc dependency — so it is fully
 * unit-testable on a machine with no MongoDB client. The execute layer turns
 * the extracted spans into BSON with bson_new_from_json (after json_relax).
 *
 * The extracted argument strings are the raw text as written
 * (whitespace-trimmed); their JSON validity is the execute layer's concern (it
 * surfaces a bson parse error honestly).
 */

typedef enum {
    MONGO_OP_FIND = 0,        /* find / findOne (findOne => limit 1) */
    MONGO_OP_AGGREGATE = 1,
    MONGO_OP_INSERT_ONE,
    MONGO_OP_INSERT_MANY,
    MONGO_OP_UPDATE_ONE,
    MONGO_OP_UPDATE_MANY,
    MONGO_OP_REPLACE_ONE,
    MONGO_OP_DELETE_ONE,
    MONGO_OP_DELETE_MANY,
    MONGO_OP_COUNT,           /* countDocuments */
    MONGO_OP_DISTINCT,
    MONGO_OP_CREATE_INDEX,
    MONGO_OP_DROP_INDEX,
    MONGO_OP_GET_INDEXES,
    MONGO_OP_DROP,            /* db.<coll>.drop() */
    MONGO_OP_CREATE_COLLECTION, /* db.createCollection(...): no collection */
    MONGO_OP_CREATE_VIEW,       /* db.createView(...): no collection */
    MONGO_OP_RUN_COMMAND        /* db.runCommand(...): no collection */
} mongo_op;

/* Return codes of mongo_query_parse (0 = success). */
#define MONGO_PARSE_OK          0
#define MONGO_PARSE_SYNTAX      1  /* malformed command */
#define MONGO_PARSE_UNSUPPORTED 2  /* well-formed, but a method we do not run */

#define MONGO_MAX_ARGS 4

typedef struct {
    mongo_op op;
    char *collection;  /* owned; e.g. "users" or "system.profile". NULL for the
                          db-level ops (createCollection / runCommand). */
    char *filter;      /* owned. find: the filter doc (defaults to "{}").
                          aggregate: the pipeline array text (e.g. "[{...}]").
                          Unused by the other ops (see args). */
    char *projection;  /* owned or NULL. find only. */
    char *sort;        /* owned or NULL. find only. */
    long  limit;       /* -1 when unset */
    long  skip;        /* -1 when unset */
    /* Every op other than find/aggregate: the raw, trimmed argument texts in call
       order (nargs of them). A string argument keeps its quotes; decode it with
       mongo_unquote. */
    char *args[MONGO_MAX_ARGS];
    int   nargs;
} mongo_query;

/*
 * Parse a mongosh-style command. On success returns MONGO_PARSE_OK and fills
 * *out (free it with mongo_query_free). On failure returns MONGO_PARSE_SYNTAX or
 * MONGO_PARSE_UNSUPPORTED (an unknown method — the caller reports it as an
 * unsupported operation, never a fake success) and writes a human error into
 * errbuf (when errbuf != NULL && errlen > 0); *out is left zeroed.
 */
int mongo_query_parse(const char *input, mongo_query *out, char *errbuf, size_t errlen);

/*
 * Decode a quoted string literal ("..." or '...', with the usual backslash
 * escapes) into a fresh string (free with free()). NULL when `lit` is not
 * exactly one well-formed literal, or on OOM.
 */
char *mongo_unquote(const char *lit);

/* Release the owned strings of a parsed query. Safe on a zeroed struct. */
void mongo_query_free(mongo_query *q);

#endif /* QUAERO_MONGODB_QUERY_PARSE_H */
