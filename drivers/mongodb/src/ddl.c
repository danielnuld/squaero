#include "internal.h"
#include "utils/ddl.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * DDL generation (DBC_FEAT_DDL). A MongoDB collection has no CREATE statement;
 * its definition is the createCollection options (capped, validator, collation,
 * timeseries ...) reported by listCollections plus its secondary indexes from
 * listIndexes. This reads both and hands them to the pure builder
 * (utils/ddl.c), which assembles the reproducible mongosh script returned as a
 * one-column ("sql") result.
 */

static char *dup_str(const char *s)
{
    size_t n = strlen(s) + 1;
    char *p = malloc(n);
    if (p != NULL) {
        memcpy(p, s, n);
    }
    return p;
}

/* Relaxed Extended JSON of a document, as an owned (malloc) string, or NULL. */
static char *json_of(const bson_t *doc)
{
    size_t len = 0;
    char *j = bson_as_relaxed_extended_json(doc, &len);
    if (j == NULL) {
        return NULL;
    }
    char *copy = malloc(len + 1);
    if (copy != NULL) {
        memcpy(copy, j, len);
        copy[len] = '\0';
    }
    bson_free(j);
    return copy;
}

/* The key pattern of an index. A text index reports {_fts: "text", _ftsx: 1}
   internally; rebuild the user-facing {field: "text", ...} from its weights. */
static void key_for_index(const bson_t *index, bson_t *out)
{
    bson_iter_t it;
    if (bson_iter_init_find(&it, index, "key") && BSON_ITER_HOLDS_DOCUMENT(&it)) {
        bson_t key;
        const uint8_t *data = NULL;
        uint32_t len = 0;
        bson_iter_document(&it, &len, &data);
        if (bson_init_static(&key, data, len)) {
            bson_iter_t k;
            if (bson_iter_init_find(&k, &key, "_fts")) {
                bson_iter_t w, wi;
                if (bson_iter_init_find(&w, index, "weights") && BSON_ITER_HOLDS_DOCUMENT(&w) &&
                    bson_iter_recurse(&w, &wi)) {
                    while (bson_iter_next(&wi)) {
                        BSON_APPEND_UTF8(out, bson_iter_key(&wi), "text");
                    }
                }
            } else {
                bson_concat(out, &key);
            }
        }
    }
}

dbc_status mongo_get_ddl(dbc_conn *c, const char *schema, const char *object,
                         dbc_result **out)
{
    *out = NULL;
    if (c == NULL || c->client == NULL) {
        return DBC_ERR_PARAM;
    }
    if (object == NULL || object[0] == '\0') {
        mongo_set_err(c, "collection name is required");
        return DBC_ERR_PARAM;
    }
    const char *dbname = (schema != NULL && schema[0] != '\0') ? schema : c->db;
    if (dbname == NULL || dbname[0] == '\0') {
        mongo_set_err(c, "no database selected");
        return DBC_ERR_PARAM;
    }

    dbc_status status = DBC_ERR_QUERY;
    bson_error_t berr;
    mongoc_database_t *database = mongoc_client_get_database(c->client, dbname);
    mongoc_collection_t *coll = NULL;
    mongoc_cursor_t *cursor = NULL;
    bson_t *info = NULL;        /* the listCollections entry */
    bson_t options;             /* its "options" document (init'd when present) */
    int have_options = 0;
    int is_view = 0;
    char *options_json = NULL, *pipeline_json = NULL;
    const char *view_on = NULL;
    mongo_ddl_index *indexes = NULL;
    char **owned = NULL;        /* every malloc'd string held by `indexes` */
    int n_indexes = 0, n_owned = 0;
    char *script = NULL;

    /* 1. The collection's entry in listCollections. */
    {
        bson_t filter = BSON_INITIALIZER, opts = BSON_INITIALIZER;
        BSON_APPEND_UTF8(&filter, "name", object);
        BSON_APPEND_DOCUMENT(&opts, "filter", &filter);
        cursor = mongoc_database_find_collections_with_opts(database, &opts);
        bson_destroy(&filter);
        bson_destroy(&opts);
    }
    if (cursor == NULL) {
        mongo_set_err(c, "could not list collections");
        goto done;
    }
    const bson_t *doc = NULL;
    if (mongoc_cursor_next(cursor, &doc)) {
        info = bson_copy(doc);
    }
    if (mongoc_cursor_error(cursor, &berr)) {
        mongo_stash_bson_error(c, "listCollections failed", &berr);
        goto done;
    }
    if (info == NULL) {
        char msg[512];
        snprintf(msg, sizeof msg, "collection \"%s\" not found in database \"%s\"", object, dbname);
        mongo_set_err(c, msg);
        goto done;
    }

    bson_iter_t it;
    if (bson_iter_init_find(&it, info, "type") && BSON_ITER_HOLDS_UTF8(&it)) {
        is_view = (strcmp(bson_iter_utf8(&it, NULL), "view") == 0);
    }
    if (bson_iter_init_find(&it, info, "options") && BSON_ITER_HOLDS_DOCUMENT(&it)) {
        const uint8_t *data = NULL;
        uint32_t len = 0;
        bson_iter_document(&it, &len, &data);
        have_options = bson_init_static(&options, data, len);
    }

    /* 2. Options JSON (a view keeps viewOn / pipeline apart from the rest). */
    if (have_options) {
        bson_t rest = BSON_INITIALIZER;
        bson_iter_t oi;
        bson_iter_init(&oi, &options);
        while (bson_iter_next(&oi)) {
            const char *k = bson_iter_key(&oi);
            if (is_view && strcmp(k, "viewOn") == 0 && BSON_ITER_HOLDS_UTF8(&oi)) {
                view_on = bson_iter_utf8(&oi, NULL);
            } else if (is_view && strcmp(k, "pipeline") == 0 && BSON_ITER_HOLDS_ARRAY(&oi)) {
                bson_t arr;
                const uint8_t *data = NULL;
                uint32_t len = 0;
                bson_iter_array(&oi, &len, &data);
                if (bson_init_static(&arr, data, len)) {
                    pipeline_json = mongo_bson_array_json(&arr);
                }
            } else {
                bson_append_value(&rest, k, -1, bson_iter_value(&oi));
            }
        }
        options_json = json_of(&rest);
        bson_destroy(&rest);
        if (options_json == NULL) {
            mongo_set_err(c, "out of memory");
            status = DBC_ERR_NOMEM;
            goto done;
        }
    }
    if (is_view && view_on == NULL) {
        mongo_set_err(c, "the view definition has no source collection");
        goto done;
    }

    /* 3. Secondary indexes (a view has none of its own). */
    if (!is_view) {
        coll = mongoc_client_get_collection(c->client, dbname, object);
        mongoc_cursor_destroy(cursor);
        cursor = mongoc_collection_find_indexes_with_opts(coll, NULL);
        if (cursor == NULL) {
            mongo_set_err(c, "could not list indexes");
            goto done;
        }
        int cap = 0;
        while (mongoc_cursor_next(cursor, &doc)) {
            if (n_indexes >= cap) {
                int nc = cap == 0 ? 8 : cap * 2;
                mongo_ddl_index *grown = realloc(indexes, (size_t)nc * sizeof *grown);
                char **grown_owned = realloc(owned, (size_t)nc * 3 * sizeof *grown_owned);
                if (grown != NULL) {
                    indexes = grown;
                }
                if (grown_owned != NULL) {
                    owned = grown_owned;
                }
                if (grown == NULL || grown_owned == NULL) {
                    mongo_set_err(c, "out of memory");
                    status = DBC_ERR_NOMEM;
                    goto done;
                }
                cap = nc;
            }
            mongo_ddl_index *ix = &indexes[n_indexes];
            memset(ix, 0, sizeof *ix);

            bson_iter_t ni;
            if (!bson_iter_init_find(&ni, doc, "name") || !BSON_ITER_HOLDS_UTF8(&ni)) {
                continue;
            }
            char *name = dup_str(bson_iter_utf8(&ni, NULL));
            bson_t key = BSON_INITIALIZER;
            key_for_index(doc, &key);
            char *key_json = json_of(&key);
            bson_destroy(&key);
            bson_t rest = BSON_INITIALIZER;
            bson_copy_to_excluding_noinit(doc, &rest, "v", "key", "name", "ns",
                                          "textIndexVersion", NULL);
            char *opts_json = json_of(&rest);
            bson_destroy(&rest);
            if (name == NULL || key_json == NULL || opts_json == NULL) {
                free(name);
                free(key_json);
                free(opts_json);
                mongo_set_err(c, "out of memory");
                status = DBC_ERR_NOMEM;
                goto done;
            }
            owned[n_owned++] = name;
            owned[n_owned++] = key_json;
            owned[n_owned++] = opts_json;
            ix->name = name;
            ix->key_json = key_json;
            ix->opts_json = opts_json;
            n_indexes++;
        }
        if (mongoc_cursor_error(cursor, &berr)) {
            mongo_stash_bson_error(c, "listIndexes failed", &berr);
            goto done;
        }
    }

    {
        mongo_ddl_spec spec = {
            .collection = object,
            .options_json = options_json,
            .view_on = is_view ? view_on : NULL,
            .view_pipeline = pipeline_json,
            .n_indexes = n_indexes,
            .indexes = indexes,
        };
        script = mongo_build_ddl(&spec);
    }
    if (script == NULL) {
        mongo_set_err(c, "out of memory");
        status = DBC_ERR_NOMEM;
        goto done;
    }
    status = mongo_text_result(c, "sql", script, out);

done:
    free(script);
    for (int i = 0; i < n_owned; i++) {
        free(owned[i]);
    }
    free(owned);
    free(indexes);
    free(options_json);
    free(pipeline_json);
    if (info != NULL) {
        bson_destroy(info);
    }
    if (cursor != NULL) {
        mongoc_cursor_destroy(cursor);
    }
    if (coll != NULL) {
        mongoc_collection_destroy(coll);
    }
    mongoc_database_destroy(database);
    return status;
}
