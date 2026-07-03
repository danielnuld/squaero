#ifndef QUAERO_MONGODB_VALUE_FMT_H
#define QUAERO_MONGODB_VALUE_FMT_H

#include <stddef.h>
#include <stdint.h>

/*
 * Pure value-formatting helpers shared by the mongoc value layer (query.c).
 * Kept free of libbson/mongoc so they are unit-testable without a MongoDB
 * client.
 */

/*
 * Format a BSON UTC datetime (milliseconds since the Unix epoch, which may be
 * negative for dates before 1970) as ISO 8601 in UTC:
 * "YYYY-MM-DDTHH:MM:SS.mmmZ". Writes into buf (a 32-byte buffer is always
 * enough for in-range values). Uses a civil-from-days computation, so it does
 * not depend on the platform's time_t range or gmtime.
 */
void mongo_format_datetime(int64_t millis, char *buf, size_t len);

#endif /* QUAERO_MONGODB_VALUE_FMT_H */
