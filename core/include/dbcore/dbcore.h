#ifndef DBCORE_DBCORE_H
#define DBCORE_DBCORE_H

/*
 * Public API of libdbcore.
 *
 * This is a placeholder surface for M0 (project scaffolding). The real API
 * — connection lifecycle, query execution, result sets, introspection —
 * lands in M1. See docs/ARCHITECTURE.md and docs/DRIVER_API.md.
 */

#ifdef __cplusplus
extern "C" {
#endif

/* Returns the libdbcore version string (e.g. "0.0.1"). Never NULL. */
const char *dbcore_version(void);

#ifdef __cplusplus
}
#endif

#endif /* DBCORE_DBCORE_H */
