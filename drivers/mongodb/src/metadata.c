#include "internal.h"
#include "utils/bson_types.h"
#include "utils/columns.h"
#include "utils/result.h"

#include <stdlib.h>
#include <string.h>

/*
 * Schema introspection over the mongo-c-driver, projected to the neutral column
 * convention shared with the other drivers:
 *   list_databases -> name
 *   list_tables    -> name, type   (type is always "collection")
 *   describe_table -> name, type, notnull, dflt_value, pk
 *
 * MongoDB has no schema layer between a database and its collections, so
 * list_schemas is not implemented (DBC_FEAT_SCHEMAS is not advertised) and the
 * `schema` argument names the database (NULL = the connection's default).
 * Collections are schemaless, so describe_table SAMPLES documents and reports
 * the observed top-level fields and their inferred neutral types — an honest
 * best effort, not a declared schema the engine enforces.
 */

/* Owned copy of the first n bytes of s as a NUL-terminated string. */
static char *dup_n(const char *s, size_t n)
{
    char *p = malloc(n + 1);
    if (p != NULL) {
        memcpy(p, s, n);
        p[n] = '\0';
    }
    return p;
}

/* Free a row's cells then the array (used on an add-row failure path). */
static void free_cells(char **cells, int ncols)
{
    if (cells == NULL) {
        return;
    }
    for (int i = 0; i < ncols; i++) {
        free(cells[i]);
    }
    free(cells);
}

/* The database to introspect: the explicit `schema` argument, else the
   connection default. Returns NULL when neither is available. */
static const char *resolve_db(dbc_conn *c, const char *schema)
{
    if (schema != NULL && schema[0] != '\0') {
        return schema;
    }
    if (c->db != NULL && c->db[0] != '\0') {
        return c->db;
    }
    return NULL;
}

dbc_status mongo_list_databases(dbc_conn *c, dbc_result **out)
{
    *out = NULL;
    if (c == NULL || c->client == NULL) {
        return DBC_ERR_PARAM;
    }

    bson_error_t berr;
    char **names = mongoc_client_get_database_names_with_opts(c->client, NULL, &berr);
    if (names == NULL) {
        mongo_stash_bson_error(c, "list databases failed", &berr);
        return DBC_ERR_QUERY;
    }

    dbc_result *r = mongo_result_new();
    if (r == NULL || mongo_result_add_column(r, "name", DBC_TYPE_TEXT) != 0) {
        mongo_free_result(r);
        bson_strfreev(names);
        return DBC_ERR_NOMEM;
    }
    for (int i = 0; names[i] != NULL; i++) {
        char **cells = calloc(1, sizeof *cells);
        if (cells != NULL) {
            cells[0] = dup_n(names[i], strlen(names[i]));
        }
        if (cells == NULL || cells[0] == NULL ||
            mongo_result_add_row(r, cells) != 0) {
            free_cells(cells, 1);
            mongo_free_result(r);
            bson_strfreev(names);
            return DBC_ERR_NOMEM;
        }
    }
    bson_strfreev(names);
    *out = r;
    return DBC_OK;
}

dbc_status mongo_list_tables(dbc_conn *c, const char *schema, dbc_result **out)
{
    *out = NULL;
    if (c == NULL || c->client == NULL) {
        return DBC_ERR_PARAM;
    }
    const char *dbname = resolve_db(c, schema);
    if (dbname == NULL) {
        mongo_set_err(c, "no database selected");
        return DBC_ERR_PARAM;
    }

    mongoc_database_t *database = mongoc_client_get_database(c->client, dbname);
    if (database == NULL) {
        mongo_set_err(c, "could not open database");
        return DBC_ERR_QUERY;
    }
    bson_error_t berr;
    char **names = mongoc_database_get_collection_names_with_opts(database, NULL,
                                                                  &berr);
    mongoc_database_destroy(database);
    if (names == NULL) {
        mongo_stash_bson_error(c, "list collections failed", &berr);
        return DBC_ERR_QUERY;
    }

    dbc_result *r = mongo_result_new();
    if (r == NULL ||
        mongo_result_add_column(r, "name", DBC_TYPE_TEXT) != 0 ||
        mongo_result_add_column(r, "type", DBC_TYPE_TEXT) != 0) {
        mongo_free_result(r);
        bson_strfreev(names);
        return DBC_ERR_NOMEM;
    }
    for (int i = 0; names[i] != NULL; i++) {
        char **cells = calloc(2, sizeof *cells);
        if (cells != NULL) {
            cells[0] = dup_n(names[i], strlen(names[i]));
            cells[1] = dup_n("collection", 10);
        }
        if (cells == NULL || cells[0] == NULL || cells[1] == NULL ||
            mongo_result_add_row(r, cells) != 0) {
            free_cells(cells, 2);
            mongo_free_result(r);
            bson_strfreev(names);
            return DBC_ERR_NOMEM;
        }
    }
    bson_strfreev(names);
    *out = r;
    return DBC_OK;
}

dbc_status mongo_describe_table(dbc_conn *c, const char *schema,
                                const char *table, dbc_result **out)
{
    *out = NULL;
    if (c == NULL || c->client == NULL) {
        return DBC_ERR_PARAM;
    }
    if (table == NULL || table[0] == '\0') {
        mongo_set_err(c, "collection name is required");
        return DBC_ERR_PARAM;
    }
    const char *dbname = resolve_db(c, schema);
    if (dbname == NULL) {
        mongo_set_err(c, "no database selected");
        return DBC_ERR_PARAM;
    }

    mongoc_collection_t *coll =
        mongoc_client_get_collection(c->client, dbname, table);
    if (coll == NULL) {
        mongo_set_err(c, "could not open collection");
        return DBC_ERR_QUERY;
    }

    bson_t *empty = bson_new();
    bson_t opts;
    bson_init(&opts);
    bson_append_int64(&opts, "limit", -1, MONGO_DESCRIBE_SAMPLE);
    mongoc_cursor_t *cursor =
        mongoc_collection_find_with_opts(coll, empty, &opts, NULL);
    bson_destroy(&opts);
    bson_destroy(empty);

    dbc_status status = DBC_ERR_QUERY;
    bson_t **docs = NULL;
    int ndocs = 0, cap_docs = 0;
    mongo_columns *cols = mongo_columns_new();
    dbc_type *types = NULL;
    dbc_result *r = NULL;
    bson_error_t berr;

    if (cursor == NULL || cols == NULL) {
        mongo_set_err(c, "out of memory");
        status = DBC_ERR_NOMEM;
        goto done;
    }

    /* Sample: buffer documents and accumulate the field union. */
    const bson_t *doc = NULL;
    while (mongoc_cursor_next(cursor, &doc)) {
        if (ndocs >= cap_docs) {
            int nc = cap_docs == 0 ? 64 : cap_docs * 2;
            bson_t **grown = realloc(docs, (size_t)nc * sizeof *grown);
            if (grown == NULL) {
                mongo_set_err(c, "out of memory");
                status = DBC_ERR_NOMEM;
                goto done;
            }
            docs = grown;
            cap_docs = nc;
        }
        docs[ndocs] = bson_copy(doc);
        if (docs[ndocs] == NULL) {
            mongo_set_err(c, "out of memory");
            status = DBC_ERR_NOMEM;
            goto done;
        }
        bson_iter_t it;
        if (bson_iter_init(&it, docs[ndocs])) {
            while (bson_iter_next(&it)) {
                if (mongo_columns_observe(cols, bson_iter_key(&it)) != 0) {
                    ndocs++;
                    mongo_set_err(c, "out of memory");
                    status = DBC_ERR_NOMEM;
                    goto done;
                }
            }
        }
        ndocs++;
    }
    if (mongoc_cursor_error(cursor, &berr)) {
        mongo_stash_bson_error(c, "describe failed", &berr);
        goto done;
    }

    /* Infer each field's neutral type from its first non-null occurrence. */
    int nfields = mongo_columns_count(cols);
    types = calloc((size_t)(nfields > 0 ? nfields : 1), sizeof *types); /* DBC_TYPE_NULL */
    if (types == NULL) {
        mongo_set_err(c, "out of memory");
        status = DBC_ERR_NOMEM;
        goto done;
    }
    for (int d = 0; d < ndocs; d++) {
        bson_iter_t it;
        if (!bson_iter_init(&it, docs[d])) {
            continue;
        }
        while (bson_iter_next(&it)) {
            int idx = mongo_columns_index_of(cols, bson_iter_key(&it));
            if (idx < 0 || idx >= nfields || types[idx] != DBC_TYPE_NULL) {
                continue;
            }
            bson_type_t bt = bson_iter_type(&it);
            if (bt == BSON_TYPE_NULL || bt == BSON_TYPE_UNDEFINED) {
                continue;
            }
            types[idx] = mongo_bson_type_to_neutral((int)bt);
        }
    }

    /* Build the describe result: name, type, notnull, dflt_value, pk. */
    r = mongo_result_new();
    if (r == NULL ||
        mongo_result_add_column(r, "name", DBC_TYPE_TEXT) != 0 ||
        mongo_result_add_column(r, "type", DBC_TYPE_TEXT) != 0 ||
        mongo_result_add_column(r, "notnull", DBC_TYPE_INT) != 0 ||
        mongo_result_add_column(r, "dflt_value", DBC_TYPE_TEXT) != 0 ||
        mongo_result_add_column(r, "pk", DBC_TYPE_INT) != 0) {
        mongo_set_err(c, "out of memory");
        status = DBC_ERR_NOMEM;
        goto done;
    }
    for (int i = 0; i < nfields; i++) {
        const char *fname = mongo_columns_name(cols, i);
        const char *tname = mongo_type_name(types[i]);
        int is_id = (fname != NULL && strcmp(fname, "_id") == 0);

        char **cells = calloc(5, sizeof *cells);
        if (cells != NULL) {
            cells[0] = dup_n(fname != NULL ? fname : "",
                             fname != NULL ? strlen(fname) : 0);
            cells[1] = dup_n(tname, strlen(tname));
            cells[2] = dup_n("0", 1);   /* MongoDB does not enforce NOT NULL */
            cells[3] = NULL;             /* no server-side default */
            cells[4] = dup_n(is_id ? "1" : "0", 1);
        }
        if (cells == NULL || cells[0] == NULL || cells[1] == NULL ||
            cells[2] == NULL || cells[4] == NULL ||
            mongo_result_add_row(r, cells) != 0) {
            free_cells(cells, 5);
            mongo_set_err(c, "out of memory");
            status = DBC_ERR_NOMEM;
            goto done;
        }
    }

    *out = r;
    r = NULL;
    status = DBC_OK;

done:
    mongo_free_result(r);
    free(types);
    mongo_columns_free(cols);
    for (int i = 0; i < ndocs; i++) {
        bson_destroy(docs[i]);
    }
    free(docs);
    if (cursor != NULL) {
        mongoc_cursor_destroy(cursor);
    }
    mongoc_collection_destroy(coll);
    return status;
}
