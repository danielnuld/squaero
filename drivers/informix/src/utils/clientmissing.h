#ifndef QUAERO_IFX_CLIENTMISSING_H
#define QUAERO_IFX_CLIENTMISSING_H

/*
 * Telling "the IBM Informix client is not installed" apart from every other
 * connect failure (issue #506). Pure, so it is unit-tested without ODBC.
 */

/*
 * Stable marker at the start of the connect error when the client is missing.
 * The frontend matches it to show how to install the Client SDK instead of a raw
 * ODBC diagnostic, so it must not change.
 */
#define IFX_CLIENT_MISSING_MARKER "IFX_CLIENT_MISSING"

/*
 * True when a failed connect means no Informix client could be found.
 *
 * `direct` is ifx_odbc_is_direct(): 1 when a Client SDK's own driver DLL was
 * loaded. When none was, the driver falls back to the ODBC Driver Manager, and a
 * manager that has no Informix driver registered answers SQLSTATE IM002 ("data
 * source name not found and no default driver specified"). A loaded client never
 * produces IM002 for this reason, so the rule needs both.
 */
int ifx_client_missing(int direct, const char *sqlstate);

#endif /* QUAERO_IFX_CLIENTMISSING_H */
