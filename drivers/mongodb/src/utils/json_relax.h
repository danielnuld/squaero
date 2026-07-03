#ifndef QUAERO_MONGODB_JSON_RELAX_H
#define QUAERO_MONGODB_JSON_RELAX_H

/*
 * Relaxed-JSON normalizer.
 *
 * The mongosh-style commands users write carry argument documents in the loose
 * JavaScript-object form the mongo shell accepts — bare (unquoted) keys and
 * single-quoted strings, e.g.  { age: { $gt: 25 }, name: 'ana' }.  libbson's
 * bson_new_from_json, however, requires strict JSON (double-quoted keys and
 * strings). This pure helper bridges the two: it wraps bare object keys in
 * double quotes and rewrites single-quoted strings as double-quoted ones,
 * leaving already-valid JSON untouched. Content inside strings is preserved
 * verbatim (including braces, commas and escapes).
 *
 * It is a lexical transform, not a full parser: it does not validate the JSON
 * (an invalid document still surfaces later as a bson parse error, honestly). It
 * depends on nothing external, so it is unit-tested without a MongoDB client.
 *
 * Returns a freshly allocated strict-JSON string (free with free()), or NULL on
 * allocation failure or a NULL input.
 */
char *mongo_json_relax(const char *input);

#endif /* QUAERO_MONGODB_JSON_RELAX_H */
