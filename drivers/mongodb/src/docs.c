#include "internal.h"
#include "utils/bson_types.h"
#include "utils/columns.h"
#include "utils/json_relax.h"
#include "utils/result.h"
#include "utils/value_fmt.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * BSON <-> neutral-result plumbing shared by the read path (query.c), the
 * write/utility commands (command.c) and the DDL reader (ddl.c): parsing the
 * relaxed-JSON arguments of a mongosh command into BSON, rendering a BSON value
 * as neutral cell text, and flattening documents into the tabular result (see
 * docs/MONGODB.md). Flattening is two-phase: accumulate the union of top-level
 * field names (a later document can introduce a new column), then emit one row
 * per document, placing each field's value in its column and leaving the missing
 * ones SQL NULL.
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

bson_t *mongo_bson_from_relaxed(const char *text, bson_error_t *err)
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

int mongo_bson_init_relaxed(bson_t *out, const char *text, bson_error_t *err)
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

bson_t *mongo_bson_wrap_relaxed(const char *key, const char *value_text, bson_error_t *err)
{
    memset(err, 0, sizeof *err);
    char *strict = mongo_json_relax(value_text);
    if (strict == NULL) {
        return NULL;
    }
    size_t need = strlen(strict) + strlen(key) + 16;
    char *wrapped = malloc(need);
    if (wrapped == NULL) {
        free(strict);
        return NULL;
    }
    snprintf(wrapped, need, "{\"%s\": %s}", key, strict);
    free(strict);
    bson_t *b = bson_new_from_json((const uint8_t *)wrapped, -1, err);
    free(wrapped);
    return b;
}

char *mongo_bson_array_json(const bson_t *arr)
{
    /* libbson's array-specific serializers are newer than some distro packages;
       serialize {"a": <array>} and cut the wrapper off instead. */
    bson_t wrap = BSON_INITIALIZER;
    BSON_APPEND_ARRAY(&wrap, "a", arr);
    size_t jlen = 0;
    char *json = bson_as_relaxed_extended_json(&wrap, &jlen);
    bson_destroy(&wrap);
    if (json == NULL) {
        return NULL;
    }
    const char *start = strchr(json, '[');
    const char *end = strrchr(json, ']');
    char *out = (start != NULL && end != NULL && end >= start)
                    ? dup_n(start, (size_t)(end - start) + 1)
                    : NULL;
    bson_free(json);
    return out;
}

char *mongo_bson_cell_text(const bson_iter_t *iter, dbc_type *type, int *is_null)
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
        if (bt == BSON_TYPE_ARRAY) {
            char *arr_json = mongo_bson_array_json(&sub);
            return arr_json != NULL ? arr_json : dup_n("[]", 2);
        }
        size_t jlen = 0;
        char *json = bson_as_relaxed_extended_json(&sub, &jlen);
        if (json == NULL) {
            return dup_n("{}", 2);
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

dbc_status mongo_result_from_docs(dbc_conn *c, bson_t *const *docs, int ndocs,
                                  dbc_result **out)
{
    *out = NULL;
    dbc_status status = DBC_ERR_NOMEM;
    mongo_columns *cols = mongo_columns_new();
    dbc_result *r = NULL;
    if (cols == NULL) {
        goto oom;
    }

    /* Phase 1: the column union. */
    for (int d = 0; d < ndocs; d++) {
        bson_iter_t it;
        if (bson_iter_init(&it, docs[d])) {
            while (bson_iter_next(&it)) {
                if (mongo_columns_observe(cols, bson_iter_key(&it)) != 0) {
                    goto oom;
                }
            }
        }
    }

    /* Phase 2: build the result grid. */
    r = mongo_result_new();
    if (r == NULL) {
        goto oom;
    }
    int ncols = mongo_columns_count(cols);
    for (int i = 0; i < ncols; i++) {
        if (mongo_result_add_column(r, mongo_columns_name(cols, i), DBC_TYPE_NULL) != 0) {
            goto oom;
        }
    }
    for (int d = 0; d < ndocs; d++) {
        char **cells = calloc((size_t)(ncols > 0 ? ncols : 1), sizeof *cells);
        if (cells == NULL) {
            goto oom;
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
                char *txt = mongo_bson_cell_text(&it, &t, &is_null);
                if (!is_null && txt == NULL) {
                    free_cells(cells, ncols);
                    goto oom;
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
            goto oom;
        }
    }

    mongo_columns_free(cols);
    *out = r;
    return DBC_OK;

oom:
    mongo_set_err(c, "out of memory");
    mongo_free_result(r);
    mongo_columns_free(cols);
    return status;
}

dbc_status mongo_result_from_cursor(dbc_conn *c, mongoc_cursor_t *cursor,
                                    const char *err_ctx, dbc_result **out)
{
    *out = NULL;
    dbc_status status = DBC_ERR_QUERY;
    bson_t **docs = NULL;
    int ndocs = 0, cap_docs = 0;
    bson_error_t berr;

    /* Buffer the page (bounded: an unbounded find cannot exhaust memory). */
    const bson_t *doc = NULL;
    while (mongoc_cursor_next(cursor, &doc)) {
        if (ndocs >= MONGO_SCAN_CAP) {
            break;
        }
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
        ndocs++;
    }
    if (mongoc_cursor_error(cursor, &berr)) {
        mongo_stash_bson_error(c, err_ctx, &berr);
        goto done;
    }
    status = mongo_result_from_docs(c, docs, ndocs, out);

done:
    for (int i = 0; i < ndocs; i++) {
        bson_destroy(docs[i]);
    }
    free(docs);
    return status;
}

dbc_status mongo_text_result(dbc_conn *c, const char *column, const char *text,
                             dbc_result **out)
{
    *out = NULL;
    dbc_result *r = mongo_result_new();
    char **cells = calloc(1, sizeof *cells);
    if (r != NULL && cells != NULL && mongo_result_add_column(r, column, DBC_TYPE_TEXT) == 0) {
        cells[0] = dup_n(text, strlen(text));
        if (cells[0] != NULL && mongo_result_add_row(r, cells) == 0) {
            *out = r;
            return DBC_OK;
        }
        free(cells[0]);
    }
    free(cells);
    mongo_free_result(r);
    mongo_set_err(c, "out of memory");
    return DBC_ERR_NOMEM;
}
