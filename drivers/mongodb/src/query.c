#include "internal.h"
#include "utils/bson_types.h"
#include "utils/columns.h"
#include "utils/json_relax.h"
#include "utils/query_parse.h"
#include "utils/result.h"
#include "utils/value_fmt.h"

#include <inttypes.h>
#include <stdlib.h>
#include <string.h>

/*
 * Query execution: parse a mongosh-style command (find/aggregate), run it via
 * the mongo-c-driver, and flatten the returned documents into the neutral
 * tabular result (see docs/MONGODB.md). Flattening is two-phase: buffer the
 * page while accumulating the union of top-level field names (a later document
 * can introduce a new column), then emit one row per document, placing each
 * field's value in its column and leaving the missing ones SQL NULL.
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

/* Parse a mongosh-style (relaxed) JSON document into a new bson_t: normalize
   bare keys / single quotes to strict JSON first, then hand it to libbson. */
static bson_t *new_bson_relaxed(const char *text, bson_error_t *err)
{
    memset(err, 0, sizeof *err);
    char *strict = mongo_json_relax(text);
    if (strict == NULL) {
        return NULL;
    }
    bson_t *b = bson_new_from_json((const uint8_t *)strict, -1, err);
    free(strict);
    return b;
}

/* As new_bson_relaxed, but initializes a caller-provided bson_t (for options
   sub-documents). Returns 1 on success, 0 on failure. */
static int init_bson_relaxed(bson_t *out, const char *text, bson_error_t *err)
{
    memset(err, 0, sizeof *err);
    char *strict = mongo_json_relax(text);
    if (strict == NULL) {
        return 0;
    }
    int ok = bson_init_from_json(out, strict, -1, err);
    free(strict);
    return ok;
}

/*
 * Render the value at `iter` as neutral cell text. Sets *type to the value's
 * neutral type and *is_null to 1 for a BSON null/undefined (the cell is SQL
 * NULL). Returns an owned string, or NULL: with *is_null == 1 that means SQL
 * NULL, with *is_null == 0 it means an allocation failure the caller must treat
 * as an error.
 */
static char *cell_to_text(const bson_iter_t *iter, dbc_type *type, int *is_null)
{
    bson_type_t bt = bson_iter_type(iter);
    *type = mongo_bson_type_to_neutral((int)bt);
    *is_null = 0;

    char buf[64];
    switch (bt) {
    case BSON_TYPE_NULL:
    case BSON_TYPE_UNDEFINED:
        *is_null = 1;
        return NULL;

    case BSON_TYPE_UTF8: {
        uint32_t len = 0;
        const char *s = bson_iter_utf8(iter, &len);
        return dup_n(s != NULL ? s : "", s != NULL ? len : 0);
    }
    case BSON_TYPE_INT32:
        return dup_n(buf, (size_t)snprintf(buf, sizeof buf, "%" PRId32,
                                           bson_iter_int32(iter)));
    case BSON_TYPE_INT64:
        return dup_n(buf, (size_t)snprintf(buf, sizeof buf, "%" PRId64,
                                           bson_iter_int64(iter)));
    case BSON_TYPE_DOUBLE:
        return dup_n(buf, (size_t)snprintf(buf, sizeof buf, "%.17g",
                                           bson_iter_double(iter)));
    case BSON_TYPE_BOOL: {
        const char *s = bson_iter_bool(iter) ? "true" : "false";
        return dup_n(s, strlen(s));
    }
    case BSON_TYPE_OID: {
        char oid[25];
        bson_oid_to_string(bson_iter_oid(iter), oid);
        return dup_n(oid, strlen(oid));
    }
    case BSON_TYPE_DATE_TIME:
        mongo_format_datetime(bson_iter_date_time(iter), buf, sizeof buf);
        return dup_n(buf, strlen(buf));
    case BSON_TYPE_DECIMAL128: {
        bson_decimal128_t dec;
        if (!bson_iter_decimal128(iter, &dec)) {
            return dup_n("0", 1);
        }
        char dstr[BSON_DECIMAL128_STRING];
        bson_decimal128_to_string(&dec, dstr);
        return dup_n(dstr, strlen(dstr));
    }
    case BSON_TYPE_TIMESTAMP: {
        uint32_t t = 0, i = 0;
        bson_iter_timestamp(iter, &t, &i);
        return dup_n(buf, (size_t)snprintf(buf, sizeof buf,
                                           "%" PRIu32 ",%" PRIu32, t, i));
    }
    case BSON_TYPE_REGEX: {
        const char *opts = NULL;
        const char *pat = bson_iter_regex(iter, &opts);
        if (pat == NULL) pat = "";
        if (opts == NULL) opts = "";
        size_t need = strlen(pat) + strlen(opts) + 3;
        char *out = malloc(need);
        if (out != NULL) {
            snprintf(out, need, "/%s/%s", pat, opts);
        }
        return out;
    }
    case BSON_TYPE_CODE: {
        uint32_t len = 0;
        const char *s = bson_iter_code(iter, &len);
        return dup_n(s != NULL ? s : "", s != NULL ? len : 0);
    }
    case BSON_TYPE_DOCUMENT:
    case BSON_TYPE_ARRAY: {
        const uint8_t *data = NULL;
        uint32_t len = 0;
        if (bt == BSON_TYPE_DOCUMENT) {
            bson_iter_document(iter, &len, &data);
        } else {
            bson_iter_array(iter, &len, &data);
        }
        bson_t sub;
        if (data == NULL || !bson_init_static(&sub, data, len)) {
            return dup_n(bt == BSON_TYPE_ARRAY ? "[]" : "{}", 2);
        }
        size_t jlen = 0;
        char *json = bson_as_relaxed_extended_json(&sub, &jlen);
        if (json == NULL) {
            return dup_n(bt == BSON_TYPE_ARRAY ? "[]" : "{}", 2);
        }
        char *copy = dup_n(json, jlen);
        bson_free(json);
        return copy;
    }
    case BSON_TYPE_BINARY: {
        bson_subtype_t subtype;
        uint32_t len = 0;
        const uint8_t *bin = NULL;
        bson_iter_binary(iter, &subtype, &len, &bin);
        char *out = malloc((size_t)len * 2 + 1);
        if (out != NULL) {
            static const char hex[] = "0123456789abcdef";
            for (uint32_t k = 0; k < len; k++) {
                out[k * 2] = hex[bin[k] >> 4];
                out[k * 2 + 1] = hex[bin[k] & 0x0F];
            }
            out[len * 2] = '\0';
        }
        return out;
    }
    case BSON_TYPE_MINKEY:
        return dup_n("$minKey", 7);
    case BSON_TYPE_MAXKEY:
        return dup_n("$maxKey", 7);
    default:
        /* Unknown/exotic markers: exchange an empty string rather than lie. */
        return dup_n("", 0);
    }
}

/* Free a partially-filled cell array of ncols entries. */
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

dbc_status mongo_query_exec(dbc_conn *c, const char *sql, dbc_result **out)
{
    *out = NULL;
    if (c == NULL || c->client == NULL) {
        return DBC_ERR_PARAM;
    }
    if (c->db == NULL || c->db[0] == '\0') {
        mongo_set_err(c, "no database selected; set \"database\" in the connection");
        return DBC_ERR_QUERY;
    }

    mongo_query q;
    char perr[256];
    if (mongo_query_parse(sql, &q, perr, sizeof perr) != 0) {
        mongo_set_err(c, perr);
        return DBC_ERR_QUERY;
    }

    dbc_status status = DBC_ERR_QUERY;
    mongoc_collection_t *coll = NULL;
    bson_t *filter = NULL;
    bson_t opts;
    bson_init(&opts);
    mongoc_cursor_t *cursor = NULL;
    bson_t **docs = NULL;
    int ndocs = 0, cap_docs = 0;
    mongo_columns *cols = NULL;
    dbc_result *r = NULL;
    bson_error_t berr;

    coll = mongoc_client_get_collection(c->client, c->db, q.collection);
    if (coll == NULL) {
        mongo_set_err(c, "could not open collection");
        goto done;
    }

    if (q.op == MONGO_OP_FIND) {
        filter = new_bson_relaxed(q.filter, &berr);
        if (filter == NULL) {
            mongo_stash_bson_error(c, "invalid filter", &berr);
            goto done;
        }
        if (q.projection != NULL) {
            bson_t proj;
            if (!init_bson_relaxed(&proj, q.projection, &berr)) {
                mongo_stash_bson_error(c, "invalid projection", &berr);
                goto done;
            }
            bson_append_document(&opts, "projection", -1, &proj);
            bson_destroy(&proj);
        }
        if (q.sort != NULL) {
            bson_t so;
            if (!init_bson_relaxed(&so, q.sort, &berr)) {
                mongo_stash_bson_error(c, "invalid sort", &berr);
                goto done;
            }
            bson_append_document(&opts, "sort", -1, &so);
            bson_destroy(&so);
        }
        int64_t limit = (q.limit >= 0) ? q.limit : MONGO_SCAN_CAP;
        bson_append_int64(&opts, "limit", -1, limit);
        if (q.skip >= 0) {
            bson_append_int64(&opts, "skip", -1, q.skip);
        }
        cursor = mongoc_collection_find_with_opts(coll, filter, &opts, NULL);
    } else {
        /* aggregate: normalize the relaxed pipeline array, then wrap it so
           bson_new_from_json (which needs a top-level object) parses it; mongoc
           accepts the {pipeline:[...]} form. */
        char *strict = mongo_json_relax(q.filter);
        if (strict == NULL) {
            mongo_set_err(c, "out of memory");
            goto done;
        }
        size_t need = strlen(strict) + 32;
        char *wrapped = malloc(need);
        if (wrapped == NULL) {
            free(strict);
            mongo_set_err(c, "out of memory");
            goto done;
        }
        snprintf(wrapped, need, "{\"pipeline\": %s}", strict);
        free(strict);
        memset(&berr, 0, sizeof berr);
        filter = bson_new_from_json((const uint8_t *)wrapped, -1, &berr);
        free(wrapped);
        if (filter == NULL) {
            mongo_stash_bson_error(c, "invalid pipeline", &berr);
            goto done;
        }
        cursor = mongoc_collection_aggregate(coll, MONGOC_QUERY_NONE, filter,
                                             NULL, NULL);
    }

    if (cursor == NULL) {
        mongo_set_err(c, "could not create cursor");
        goto done;
    }

    cols = mongo_columns_new();
    if (cols == NULL) {
        mongo_set_err(c, "out of memory");
        goto done;
    }

    /* Phase 1: buffer the page and accumulate the column union. */
    const bson_t *doc = NULL;
    while (mongoc_cursor_next(cursor, &doc)) {
        if (ndocs >= MONGO_SCAN_CAP) {
            break; /* safety bound for an unbounded find */
        }
        if (ndocs >= cap_docs) {
            int nc = cap_docs == 0 ? 64 : cap_docs * 2;
            bson_t **grown = realloc(docs, (size_t)nc * sizeof *grown);
            if (grown == NULL) {
                mongo_set_err(c, "out of memory");
                goto done;
            }
            docs = grown;
            cap_docs = nc;
        }
        docs[ndocs] = bson_copy(doc);
        if (docs[ndocs] == NULL) {
            mongo_set_err(c, "out of memory");
            goto done;
        }
        bson_iter_t it;
        if (bson_iter_init(&it, docs[ndocs])) {
            while (bson_iter_next(&it)) {
                if (mongo_columns_observe(cols, bson_iter_key(&it)) != 0) {
                    ndocs++; /* count this doc so cleanup frees it */
                    mongo_set_err(c, "out of memory");
                    goto done;
                }
            }
        }
        ndocs++;
    }
    if (mongoc_cursor_error(cursor, &berr)) {
        mongo_stash_bson_error(c, "query failed", &berr);
        goto done;
    }

    /* Phase 2: build the result grid. */
    r = mongo_result_new();
    if (r == NULL) {
        mongo_set_err(c, "out of memory");
        goto done;
    }
    int ncols = mongo_columns_count(cols);
    for (int i = 0; i < ncols; i++) {
        if (mongo_result_add_column(r, mongo_columns_name(cols, i),
                                    DBC_TYPE_NULL) != 0) {
            mongo_set_err(c, "out of memory");
            goto done;
        }
    }
    for (int d = 0; d < ndocs; d++) {
        char **cells = calloc((size_t)(ncols > 0 ? ncols : 1), sizeof *cells);
        if (cells == NULL) {
            mongo_set_err(c, "out of memory");
            goto done;
        }
        bson_iter_t it;
        if (bson_iter_init(&it, docs[d])) {
            while (bson_iter_next(&it)) {
                int idx = mongo_columns_index_of(cols, bson_iter_key(&it));
                if (idx < 0 || idx >= ncols) {
                    continue;
                }
                dbc_type t = DBC_TYPE_NULL;
                int is_null = 0;
                char *txt = cell_to_text(&it, &t, &is_null);
                if (!is_null && txt == NULL) {
                    free_cells(cells, ncols);
                    mongo_set_err(c, "out of memory");
                    goto done;
                }
                free(cells[idx]); /* defensive: a duplicate key */
                cells[idx] = txt; /* NULL when SQL NULL */
                if (!is_null && mongo_col_type(r, idx) == DBC_TYPE_NULL) {
                    mongo_result_set_col_type(r, idx, t);
                }
            }
        }
        if (mongo_result_add_row(r, cells) != 0) {
            free_cells(cells, ncols);
            mongo_set_err(c, "out of memory");
            goto done;
        }
    }

    *out = r;
    r = NULL; /* ownership transferred to the caller */
    status = DBC_OK;

done:
    mongo_free_result(r);
    mongo_columns_free(cols);
    for (int i = 0; i < ndocs; i++) {
        bson_destroy(docs[i]);
    }
    free(docs);
    if (cursor != NULL) {
        mongoc_cursor_destroy(cursor);
    }
    bson_destroy(&opts);
    if (filter != NULL) {
        bson_destroy(filter);
    }
    if (coll != NULL) {
        mongoc_collection_destroy(coll);
    }
    mongo_query_free(&q);
    return status;
}
