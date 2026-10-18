#ifndef QUAERO_MONGODB_DDL_H
#define QUAERO_MONGODB_DDL_H

/*
 * Render a collection's definition as a reproducible mongosh script (get_ddl):
 *
 *   db.createCollection("users", { "validator": {...}, "validationLevel": "strict" });
 *   db.users.createIndex({ "email": 1 }, { "name": "email_1", "unique": true });
 *
 * or, for a view, db.createView("v", "source", [pipeline]). One statement per
 * line, each ending in `;`; the default `_id_` index is skipped (the server
 * creates it), the rest are sorted by name so the output is deterministic for a
 * given definition. The JSON fragments are produced by the caller (ddl.c, from
 * listCollections / listIndexes) and embedded verbatim; this builder only
 * assembles the script, so it is pure and unit-tested without a server.
 */

typedef struct {
    const char *name;       /* index name (explicit, so the script is reproducible) */
    const char *key_json;   /* key pattern as a JSON object, e.g. { "a" : 1 } */
    const char *opts_json;  /* the index's other options (unique, sparse,
                               expireAfterSeconds, partialFilterExpression, ...) as
                               a JSON object, or NULL / "{}" when there are none */
} mongo_ddl_index;

typedef struct {
    const char *collection;
    const char *options_json;   /* createCollection options (capped, size, validator,
                                   collation, timeseries, ...) as a JSON object, or
                                   NULL / "{}" */
    const char *view_on;        /* non-NULL for a view: the source collection */
    const char *view_pipeline;  /* the view's pipeline as a JSON array (view only) */
    int                    n_indexes;
    const mongo_ddl_index *indexes;
} mongo_ddl_spec;

/* Returns the script (free with free()), or NULL for a NULL/nameless spec or on
   out-of-memory. */
char *mongo_build_ddl(const mongo_ddl_spec *spec);

#endif /* QUAERO_MONGODB_DDL_H */
