#ifndef QUAERO_MONGODB_QUERY_PARSE_H
#define QUAERO_MONGODB_QUERY_PARSE_H

#include <stddef.h>

/*
 * mongosh-style query parser.
 *
 * Quaero's query channel hands the driver a single command string (the vtable's
 * `sql` argument). For MongoDB the user writes a mongosh-style expression:
 *
 *     db.<collection>.find(<filter?>, <projection?>)[.sort(<doc>)][.skip(<n>)][.limit(<n>)]
 *     db.<collection>.aggregate(<pipeline-array>)
 *
 * This module is the PURE front half: it validates the command shape and slices
 * out the JSON argument spans and the numeric skip/limit, WITHOUT parsing the
 * JSON itself and without any libbson/mongoc dependency — so it is fully
 * unit-testable on a machine with no MongoDB client. The execute layer (query.c)
 * turns the extracted JSON spans into BSON with bson_new_from_json.
 *
 * The extracted `filter`/`projection`/`sort` strings are the raw JSON text as
 * written (whitespace-trimmed); their JSON validity is the execute layer's
 * concern (it surfaces a bson parse error honestly).
 */

typedef enum {
    MONGO_OP_FIND = 0,
    MONGO_OP_AGGREGATE = 1
} mongo_op;

typedef struct {
    mongo_op op;
    char *collection;  /* owned; e.g. "users" or "system.profile" */
    char *filter;      /* owned. find: the filter doc (defaults to "{}").
                          aggregate: the pipeline array text (e.g. "[{...}]"). */
    char *projection;  /* owned or NULL. find only. */
    char *sort;        /* owned or NULL. find only. */
    long  limit;       /* -1 when unset */
    long  skip;        /* -1 when unset */
} mongo_query;

/*
 * Parse a mongosh-style command. On success returns 0 and fills *out (free it
 * with mongo_query_free). On failure returns non-zero and writes a human error
 * into errbuf (when errbuf != NULL && errlen > 0); *out is left zeroed.
 */
int mongo_query_parse(const char *input, mongo_query *out, char *errbuf, size_t errlen);

/* Release the owned strings of a parsed query. Safe on a zeroed struct. */
void mongo_query_free(mongo_query *q);

#endif /* QUAERO_MONGODB_QUERY_PARSE_H */
