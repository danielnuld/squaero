#include "columns.h"

#include <stdlib.h>
#include <string.h>

struct mongo_columns {
    char **names;   /* owned; names[0..count-1] */
    int    count;
    int    cap;
};

mongo_columns *mongo_columns_new(void)
{
    mongo_columns *c = calloc(1, sizeof(*c));
    return c; /* names/count/cap already zeroed; NULL on OOM */
}

void mongo_columns_free(mongo_columns *c)
{
    if (c == NULL) {
        return;
    }
    for (int i = 0; i < c->count; i++) {
        free(c->names[i]);
    }
    free(c->names);
    free(c);
}

int mongo_columns_count(const mongo_columns *c)
{
    return c != NULL ? c->count : 0;
}

const char *mongo_columns_name(const mongo_columns *c, int idx)
{
    if (c == NULL || idx < 0 || idx >= c->count) {
        return NULL;
    }
    return c->names[idx];
}

int mongo_columns_index_of(const mongo_columns *c, const char *name)
{
    if (c == NULL || name == NULL) {
        return -1;
    }
    for (int i = 0; i < c->count; i++) {
        if (strcmp(c->names[i], name) == 0) {
            return i;
        }
    }
    return -1;
}

/* Grow the names array to hold at least one more entry. Returns 0 or -1 (OOM). */
static int ensure_capacity(mongo_columns *c)
{
    if (c->count < c->cap) {
        return 0;
    }
    int new_cap = c->cap == 0 ? 8 : c->cap * 2;
    char **grown = realloc(c->names, (size_t)new_cap * sizeof(*grown));
    if (grown == NULL) {
        return -1;
    }
    c->names = grown;
    c->cap = new_cap;
    return 0;
}

int mongo_columns_observe(mongo_columns *c, const char *name)
{
    if (c == NULL || name == NULL) {
        return -1;
    }
    if (mongo_columns_index_of(c, name) >= 0) {
        return 0; /* already present: the union is a set */
    }
    if (ensure_capacity(c) != 0) {
        return -1;
    }

    size_t len = strlen(name) + 1;
    char *copy = malloc(len);
    if (copy == NULL) {
        return -1;
    }
    memcpy(copy, name, len);

    int hoist = strcmp(name, "_id") == 0;
    if (hoist && c->count > 0) {
        /* Shift existing names up by one to make room at position 0. */
        memmove(&c->names[1], &c->names[0], (size_t)c->count * sizeof(*c->names));
        c->names[0] = copy;
    } else {
        c->names[c->count] = copy;
    }
    c->count++;
    return 0;
}
