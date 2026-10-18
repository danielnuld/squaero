#ifndef QUAERO_MONGODB_JSON_CHECK_H
#define QUAERO_MONGODB_JSON_CHECK_H

/*
 * Strict JSON validation (RFC 8259) of one complete value, with only
 * surrounding whitespace allowed. Used by the DML builder so a JSON cell edited
 * in the grid can never break out of the statement it is embedded in.
 * Returns 1 when `text` is exactly one valid JSON value, else 0. Nesting deeper
 * than 64 levels is rejected. Pure; no libbson dependency.
 */
int mongo_json_valid(const char *text);

/* 1 when `text` is a strict JSON number; *is_int is set to 1 when it has no
   fraction and no exponent (may be NULL). */
int mongo_json_is_number(const char *text, int *is_int);

#endif /* QUAERO_MONGODB_JSON_CHECK_H */
