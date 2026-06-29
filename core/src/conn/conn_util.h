#ifndef DBCORE_CONN_UTIL_H
#define DBCORE_CONN_UTIL_H

/*
 * Small shared helpers for the connection subsystem (manager + SSH tunnel).
 */

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Copy msg into buf (of capacity cap), truncating to fit and always
 * NUL-terminating. A NULL buf or zero cap is a no-op; a NULL msg is reported as
 * "unknown error". Used to fill the human-readable errbuf the core passes down.
 */
void conn_copy_err(char *buf, size_t cap, const char *msg);

#ifdef __cplusplus
}
#endif

#endif /* DBCORE_CONN_UTIL_H */
