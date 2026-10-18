#ifndef QUAERO_MONGODB_CANCEL_TAG_H
#define QUAERO_MONGODB_CANCEL_TAG_H

#include <stddef.h>

/*
 * The per-connection tag a cancel finds its operation by. Every read the driver
 * runs carries it as the operation's `comment`; cancel asks the server (from a
 * side client) for the operations whose comment is this tag and kills them with
 * killOp. The tag is built once at connect and never changes, which is what lets
 * cancel read it from another thread without a lock. Pure: no libbson/mongoc.
 */

/* Write "quaero-cancel-<unique>" into buf; `unique` is a per-connection id (the
   driver passes an ObjectId's hex, unique across processes and machines). Returns
   the length, or -1 when buf (capacity cap) is too small or `unique` is empty or
   holds anything but letters, digits, '-' and '_' (the tag ends up in a server
   filter, so it stays plain). */
int mongo_cancel_tag(char *buf, size_t cap, const char *unique);

/* 1 when `comment` is a tag this module built (the prefix check cancel applies
   to what the server returned before it kills anything). */
int mongo_cancel_tag_is(const char *comment);

#endif /* QUAERO_MONGODB_CANCEL_TAG_H */
