#ifndef QUAERO_MONGODB_STRUTIL_H
#define QUAERO_MONGODB_STRUTIL_H

#include <stddef.h>

/*
 * Small pure string helpers shared by the statement builders (dml.c, ddl.c):
 * a growable buffer, a JSON/JS string-literal writer and the collection
 * reference (`db.users` / `db.getCollection("my-coll")`) the mongosh surface
 * uses. No libbson/mongoc dependency.
 */

typedef struct {
    char  *data;
    size_t len;
    size_t cap;
    int    oom;   /* sticky: once set, every put is a no-op */
} mongo_sb;

void  mongo_sb_putc(mongo_sb *b, char ch);
void  mongo_sb_putn(mongo_sb *b, const char *s, size_t n);
void  mongo_sb_puts(mongo_sb *b, const char *s);
/* Hand the buffer over as a NUL-terminated string (free with free()); NULL when
   an allocation failed. The buffer is reset either way. */
char *mongo_sb_take(mongo_sb *b);
void  mongo_sb_free(mongo_sb *b);

/* Append `s` as a double-quoted JSON string literal: `"` `\` and control
   characters are escaped, UTF-8 passes through untouched. NULL is written as "". */
void  mongo_sb_js_string(mongo_sb *b, const char *s);

/* 1 when `name` can follow `db.` bare in mongosh: dot-separated identifiers
   ([A-Za-z_][A-Za-z0-9_]*), non-empty. */
int   mongo_name_is_simple(const char *name);

/* Append the collection reference: `db.<name>` for a simple name, otherwise
   `db.getCollection("<name>")`. */
void  mongo_sb_coll_ref(mongo_sb *b, const char *name);

#endif /* QUAERO_MONGODB_STRUTIL_H */
