#ifndef QUAERO_MSSQL_OPTIONS_H
#define QUAERO_MSSQL_OPTIONS_H

/*
 * Pure DSN option parsing for the SQL Server driver, free of FreeTDS so it is
 * unit-tested without the client library.
 */

/*
 * The FreeTDS `encryption` value for the DSN's `encryption` field, or NULL when
 * the value is not one the driver accepts. Absent/empty means "require", which is
 * what Microsoft's current clients default to (ODBC Driver 18: Encrypt=yes).
 * "request" is NOT a safe default — measured against SQL Server 2022, it left
 * the session in plaintext, because FreeTDS then encrypts only when the server
 * demands it. Accepted spellings:
 *   "off"      login packet only (the TDS minimum), then plaintext
 *   "request"  encrypt only if the server insists
 *   "require"  encrypt, and refuse the connection otherwise
 *   "strict"   TDS 8: TLS before any TDS traffic (SQL Server 2022+ configured for it)
 */
const char *mssql_encryption_option(const char *value);

#endif /* QUAERO_MSSQL_OPTIONS_H */
