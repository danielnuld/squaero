#include "ddl.h"

#include "strutil.h"

#include <stdlib.h>
#include <string.h>

/* 1 when `json` is a non-empty JSON object text (more than "{}"). */
static int has_members(const char *json)
{
    if (json == NULL) {
        return 0;
    }
    const char *p = strchr(json, '{');
    if (p == NULL) {
        return 0;
    }
    for (p++; *p != '\0'; p++) {
        if (*p == '}') {
            return 0;
        }
        if (*p != ' ' && *p != '\t' && *p != '\n' && *p != '\r') {
            return 1;
        }
    }
    return 0;
}

/* Append the members of the object text `json` (everything between its outer
   braces, trimmed) -- used to merge the index name into its option object. */
static void put_members(mongo_sb *b, const char *json)
{
    const char *start = strchr(json, '{');
    const char *end = strrchr(json, '}');
    if (start == NULL || end == NULL || end <= start) {
        return;
    }
    start++;
    while (start < end && (*start == ' ' || *start == '\t' || *start == '\n' || *start == '\r')) {
        start++;
    }
    while (end > start && (end[-1] == ' ' || end[-1] == '\t' || end[-1] == '\n' || end[-1] == '\r')) {
        end--;
    }
    mongo_sb_putn(b, start, (size_t)(end - start));
}

static int by_name(const void *pa, const void *pb)
{
    const mongo_ddl_index *a = *(const mongo_ddl_index *const *)pa;
    const mongo_ddl_index *b = *(const mongo_ddl_index *const *)pb;
    return strcmp(a->name != NULL ? a->name : "", b->name != NULL ? b->name : "");
}

char *mongo_build_ddl(const mongo_ddl_spec *spec)
{
    if (spec == NULL || spec->collection == NULL || spec->collection[0] == '\0') {
        return NULL;
    }
    mongo_sb b = {0};

    if (spec->view_on != NULL) {
        mongo_sb_puts(&b, "db.createView(");
        mongo_sb_js_string(&b, spec->collection);
        mongo_sb_puts(&b, ", ");
        mongo_sb_js_string(&b, spec->view_on);
        mongo_sb_puts(&b, ", ");
        mongo_sb_puts(&b, spec->view_pipeline != NULL ? spec->view_pipeline : "[]");
        if (has_members(spec->options_json)) {
            mongo_sb_puts(&b, ", ");
            mongo_sb_puts(&b, spec->options_json);
        }
        mongo_sb_puts(&b, ");\n");
        return mongo_sb_take(&b);  /* a view has no indexes of its own */
    }

    mongo_sb_puts(&b, "db.createCollection(");
    mongo_sb_js_string(&b, spec->collection);
    if (has_members(spec->options_json)) {
        mongo_sb_puts(&b, ", ");
        mongo_sb_puts(&b, spec->options_json);
    }
    mongo_sb_puts(&b, ");\n");

    /* Sort pointers, never the caller's array. _id_ is created by the server. */
    const mongo_ddl_index **sorted = NULL;
    int n = 0;
    if (spec->n_indexes > 0 && spec->indexes != NULL) {
        sorted = malloc((size_t)spec->n_indexes * sizeof *sorted);
        if (sorted == NULL) {
            mongo_sb_free(&b);
            return NULL;
        }
        for (int i = 0; i < spec->n_indexes; i++) {
            const mongo_ddl_index *ix = &spec->indexes[i];
            if (ix->name != NULL && strcmp(ix->name, "_id_") == 0) {
                continue;
            }
            sorted[n++] = ix;
        }
        qsort(sorted, (size_t)n, sizeof *sorted, by_name);
    }
    for (int i = 0; i < n; i++) {
        const mongo_ddl_index *ix = sorted[i];
        mongo_sb_coll_ref(&b, spec->collection);
        mongo_sb_puts(&b, ".createIndex(");
        mongo_sb_puts(&b, ix->key_json != NULL ? ix->key_json : "{}");
        mongo_sb_puts(&b, ", { \"name\": ");
        mongo_sb_js_string(&b, ix->name);
        if (has_members(ix->opts_json)) {
            mongo_sb_puts(&b, ", ");
            put_members(&b, ix->opts_json);
        }
        mongo_sb_puts(&b, " });\n");
    }
    free(sorted);
    return mongo_sb_take(&b);
}
