#include "dml.h"

#include "json_check.h"
#include "json_relax.h"
#include "strutil.h"

#include <ctype.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void set_err(char *errbuf, size_t errlen, const char *msg)
{
    if (errbuf != NULL && errlen > 0) {
        snprintf(errbuf, errlen, "%s", msg);
    }
}

static void set_err_col(char *errbuf, size_t errlen, const char *msg, const char *col)
{
    if (errbuf != NULL && errlen > 0) {
        snprintf(errbuf, errlen, "%s (field \"%s\")", msg, col);
    }
}

static int is_hex24(const char *s)
{
    if (strlen(s) != 24) {
        return 0;
    }
    for (int i = 0; i < 24; i++) {
        if (!isxdigit((unsigned char)s[i])) {
            return 0;
        }
    }
    return 1;
}

/* YYYY-MM-DDTHH:MM:SS[.fff]Z -- the form the driver renders BSON dates in. */
static int is_iso_date(const char *s)
{
    static const char shape[] = "dddd-dd-ddTdd:dd:dd";
    size_t i = 0;
    for (; shape[i] != '\0'; i++) {
        if (shape[i] == 'd' ? !isdigit((unsigned char)s[i]) : s[i] != shape[i]) {
            return 0;
        }
    }
    if (s[i] == '.') {
        i++;
        size_t digits = 0;
        while (isdigit((unsigned char)s[i])) {
            i++;
            digits++;
        }
        if (digits == 0) {
            return 0;
        }
    }
    return s[i] == 'Z' && s[i + 1] == '\0';
}

/* A JSON integer that fits an int64. */
static int is_int64_literal(const char *s)
{
    int is_int = 0;
    if (!mongo_json_is_number(s, &is_int) || !is_int) {
        return 0;
    }
    errno = 0;
    char *end = NULL;
    (void)strtoll(s, &end, 10);
    return errno != ERANGE;
}

static int is_bool_literal(const char *s)
{
    return strcmp(s, "true") == 0 || strcmp(s, "false") == 0;
}

/* Normalize a JSON cell (relaxed mongosh syntax is accepted) into strict JSON.
   Returns an owned string, or NULL when it is not one valid JSON value. */
static char *json_normalize(const char *text, int *oom)
{
    char *strict = mongo_json_relax(text);
    if (strict == NULL) {
        *oom = 1;
        return NULL;
    }
    if (!mongo_json_valid(strict)) {
        free(strict);
        return NULL;
    }
    return strict;
}

static int starts_container(const char *s)
{
    while (isspace((unsigned char)*s)) {
        s++;
    }
    return *s == '{' || *s == '[';
}

/* Append `text` as a JSON document/array cell. 0, or -1 with errbuf set. */
static int render_json(mongo_sb *b, const char *col, const char *text, char *errbuf, size_t errlen)
{
    int oom = 0;
    char *norm = json_normalize(text, &oom);
    if (norm == NULL) {
        set_err_col(errbuf, errlen, oom ? "out of memory" : "the value is not valid JSON", col);
        return -1;
    }
    mongo_sb_puts(b, norm);
    free(norm);
    return 0;
}

/*
 * Append `text` as a BSON value of neutral `type` (DBC_TYPE_NULL = infer).
 * A value that does not fit its column type is kept as a string (the collection
 * is schemaless); only a JSON cell that is not JSON is refused. Returns 0, or -1
 * with errbuf set.
 */
static int render_value(mongo_sb *b, const char *col, const char *text, dbc_type type,
                        char *errbuf, size_t errlen)
{
    if (text == NULL) {
        mongo_sb_puts(b, "null");
        return 0;
    }
    int is_int = 0;
    switch (type) {
    case DBC_TYPE_INT:
        if (is_int64_literal(text)) {
            mongo_sb_puts(b, text);
            return 0;
        }
        break;
    case DBC_TYPE_FLOAT:
        if (mongo_json_is_number(text, &is_int)) {
            if (is_int) {  /* an integer-looking value of a double field stays a double */
                mongo_sb_puts(b, "{\"$numberDouble\": ");
                mongo_sb_js_string(b, text);
                mongo_sb_putc(b, '}');
            } else {
                mongo_sb_puts(b, text);
            }
            return 0;
        }
        break;
    case DBC_TYPE_BOOL:
        if (is_bool_literal(text)) {
            mongo_sb_puts(b, text);
            return 0;
        }
        if (strcmp(text, "1") == 0 || strcmp(text, "0") == 0) {
            mongo_sb_puts(b, text[0] == '1' ? "true" : "false");
            return 0;
        }
        break;
    case DBC_TYPE_DATE:
    case DBC_TYPE_TIMESTAMP:
        if (is_iso_date(text)) {
            mongo_sb_puts(b, "{\"$date\": ");
            mongo_sb_js_string(b, text);
            mongo_sb_putc(b, '}');
            return 0;
        }
        break;
    case DBC_TYPE_JSON:
        return render_json(b, col, text, errbuf, errlen);
    case DBC_TYPE_NULL:
        /* Unknown column type (an all-null field, or the caller sent none): infer
           conservatively, never turning ordinary text into a non-string. */
        if (is_int64_literal(text) ||
            (mongo_json_is_number(text, &is_int) && !is_int) || is_bool_literal(text)) {
            mongo_sb_puts(b, text);
            return 0;
        }
        if (starts_container(text)) {
            int oom = 0;
            char *norm = json_normalize(text, &oom);
            if (norm != NULL) {
                mongo_sb_puts(b, norm);
                free(norm);
                return 0;
            }
        }
        break;
    default:
        break;
    }
    mongo_sb_js_string(b, text);
    return 0;
}

#define MAX_ALTS 6

/* Free helper for the alternatives of a where term. */
static void free_alts(char **alts, int n)
{
    for (int i = 0; i < n; i++) {
        free(alts[i]);
    }
}

/* Build one alternative `{"col": <value>}` body into alts[*n]. */
static int push_alt(char **alts, int *n, const char *col, const char *value_prefix,
                    const char *value, const char *value_suffix, int quote_value)
{
    mongo_sb b = {0};
    mongo_sb_putc(&b, '{');
    mongo_sb_js_string(&b, col);
    mongo_sb_puts(&b, ": ");
    mongo_sb_puts(&b, value_prefix);
    if (quote_value) {
        mongo_sb_js_string(&b, value);
    } else {
        mongo_sb_puts(&b, value);
    }
    mongo_sb_puts(&b, value_suffix);
    mongo_sb_putc(&b, '}');
    char *s = mongo_sb_take(&b);
    if (s == NULL) {
        return -1;
    }
    alts[(*n)++] = s;
    return 0;
}

/*
 * One where term. The cell text does not say which BSON type the `_id` has, so
 * the term matches every type the text could stand for.
 */
static char *render_cond(const char *col, const char *val, char *errbuf, size_t errlen)
{
    char *alts[MAX_ALTS];
    int n = 0;
    int rc = 0;

    if (val == NULL) {
        rc = push_alt(alts, &n, col, "", "null", "", 0);
    } else if (starts_container(val)) {
        /* A document / array _id (the grid shows it as JSON). */
        int oom = 0;
        char *norm = json_normalize(val, &oom);
        if (norm == NULL) {
            set_err_col(errbuf, errlen, oom ? "out of memory" : "the key value is not valid JSON", col);
            return NULL;
        }
        rc = push_alt(alts, &n, col, "", norm, "", 0);
        free(norm);
    } else {
        if (is_hex24(val)) {
            rc |= push_alt(alts, &n, col, "{\"$oid\": ", val, "}", 1);
        }
        if (rc == 0 && is_iso_date(val)) {
            rc |= push_alt(alts, &n, col, "{\"$date\": ", val, "}", 1);
        }
        if (rc == 0 && (is_int64_literal(val) || mongo_json_is_number(val, NULL))) {
            rc |= push_alt(alts, &n, col, "", val, "", 0);
        }
        if (rc == 0 && is_bool_literal(val)) {
            rc |= push_alt(alts, &n, col, "", val, "", 0);
        }
        if (rc == 0) {
            rc |= push_alt(alts, &n, col, "", val, "", 1);
        }
    }
    if (rc != 0) {
        free_alts(alts, n);
        set_err(errbuf, errlen, "out of memory");
        return NULL;
    }

    mongo_sb b = {0};
    if (n == 1) {
        mongo_sb_puts(&b, alts[0]);
    } else {
        mongo_sb_puts(&b, "{\"$or\": [");
        for (int i = 0; i < n; i++) {
            if (i > 0) {
                mongo_sb_puts(&b, ", ");
            }
            mongo_sb_puts(&b, alts[i]);
        }
        mongo_sb_puts(&b, "]}");
    }
    free_alts(alts, n);
    char *out = mongo_sb_take(&b);
    if (out == NULL) {
        set_err(errbuf, errlen, "out of memory");
    }
    return out;
}

/* The filter document selecting the row: one term, or an $and of all of them. */
static int render_filter(mongo_sb *b, const dbc_dml_row *row, char *errbuf, size_t errlen)
{
    if (row->n_where <= 0 || row->where_cols == NULL || row->where_vals == NULL) {
        set_err(errbuf, errlen, "no key to identify the document (refusing to change every document)");
        return -1;
    }
    if (row->n_where == 1) {
        char *cond = render_cond(row->where_cols[0], row->where_vals[0], errbuf, errlen);
        if (cond == NULL) {
            return -1;
        }
        mongo_sb_puts(b, cond);
        free(cond);
        return 0;
    }
    mongo_sb_puts(b, "{\"$and\": [");
    for (int i = 0; i < row->n_where; i++) {
        char *cond = render_cond(row->where_cols[i], row->where_vals[i], errbuf, errlen);
        if (cond == NULL) {
            return -1;
        }
        if (i > 0) {
            mongo_sb_puts(b, ", ");
        }
        mongo_sb_puts(b, cond);
        free(cond);
    }
    mongo_sb_puts(b, "]}");
    return 0;
}

static dbc_type type_at(const dbc_dml_row *row, int i)
{
    return row->set_types != NULL ? row->set_types[i] : DBC_TYPE_NULL;
}

/* Append `"col": value` pairs for set columns, honouring the INSERT / UPDATE
   rules about NULL and `_id`. Returns the number written, or -1 on error. */
static int render_pairs(mongo_sb *b, const dbc_dml_row *row, int is_insert,
                        char *errbuf, size_t errlen)
{
    int written = 0;
    for (int i = 0; i < row->n_set; i++) {
        const char *col = row->set_cols[i];
        const char *val = row->set_vals[i];
        int is_id = (strcmp(col, "_id") == 0);
        if (is_id && !is_insert) {
            continue;  /* immutable */
        }
        if (is_insert && (val == NULL || (is_id && val[0] == '\0'))) {
            continue;  /* let the server apply its defaults / generate the _id */
        }
        if (written > 0) {
            mongo_sb_puts(b, ", ");
        }
        mongo_sb_js_string(b, col);
        mongo_sb_puts(b, ": ");
        dbc_type t = type_at(row, i);
        if (is_insert && is_id && is_hex24(val) && (t == DBC_TYPE_NULL || t == DBC_TYPE_TEXT)) {
            /* A new document's ObjectId _id typed in the grid. */
            mongo_sb_puts(b, "{\"$oid\": ");
            mongo_sb_js_string(b, val);
            mongo_sb_putc(b, '}');
        } else if (render_value(b, col, val, t, errbuf, errlen) != 0) {
            return -1;
        }
        written++;
    }
    return written;
}

char *mongo_build_dml(dbc_dml_kind kind, const dbc_dml_row *row, char *errbuf, size_t errlen)
{
    if (errbuf != NULL && errlen > 0) {
        errbuf[0] = '\0';
    }
    if (row == NULL || row->table == NULL || row->table[0] == '\0') {
        set_err(errbuf, errlen, "collection name is required");
        return NULL;
    }
    if ((kind == DBC_DML_INSERT || kind == DBC_DML_UPDATE) &&
        row->n_set > 0 && (row->set_cols == NULL || row->set_vals == NULL)) {
        set_err(errbuf, errlen, "missing columns or values");
        return NULL;
    }

    mongo_sb b = {0};
    mongo_sb_coll_ref(&b, row->table);

    if (kind == DBC_DML_INSERT) {
        mongo_sb_puts(&b, ".insertOne({");
        if (render_pairs(&b, row, 1, errbuf, errlen) < 0) {
            mongo_sb_free(&b);
            return NULL;
        }
        mongo_sb_puts(&b, "})");
    } else if (kind == DBC_DML_UPDATE) {
        mongo_sb_puts(&b, ".updateOne(");
        if (render_filter(&b, row, errbuf, errlen) != 0) {
            mongo_sb_free(&b);
            return NULL;
        }
        mongo_sb_puts(&b, ", {\"$set\": {");
        int n = render_pairs(&b, row, 0, errbuf, errlen);
        if (n <= 0) {
            if (n == 0) {
                set_err(errbuf, errlen, "no fields to update (_id cannot be changed)");
            }
            mongo_sb_free(&b);
            return NULL;
        }
        mongo_sb_puts(&b, "}})");
    } else if (kind == DBC_DML_DELETE) {
        mongo_sb_puts(&b, ".deleteOne(");
        if (render_filter(&b, row, errbuf, errlen) != 0) {
            mongo_sb_free(&b);
            return NULL;
        }
        mongo_sb_putc(&b, ')');
    } else {
        set_err(errbuf, errlen, "unknown modification kind");
        mongo_sb_free(&b);
        return NULL;
    }

    char *out = mongo_sb_take(&b);
    if (out == NULL) {
        set_err(errbuf, errlen, "out of memory");
    }
    return out;
}
