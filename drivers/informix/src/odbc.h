#ifndef QUAERO_INFORMIX_ODBC_H
#define QUAERO_INFORMIX_ODBC_H

/*
 * Where the ODBC entry points come from (issue #490).
 *
 * The Microsoft ODBC Driver Manager resolves DRIVER={IBM INFORMIX ODBC DRIVER}
 * only from HKLM, so using it means an administrator has to register the IBM
 * client on every machine — and when that registration is missing or stale,
 * connecting dies with a bare IM002. The CSDK's driver DLL exports the whole
 * ODBC API itself, so the driver loads iclit09b.dll directly instead and skips
 * the Driver Manager: nothing to register, no administrator, and a client
 * shipped next to the app is enough.
 *
 * ifx_odbc_load() fills the table below once per process, from the first of:
 *   1. $INFORMIXDIR                       (a client chosen by the user)
 *   2. <this plugin>/../csdk              (the one the installer ships)
 *   3. %LOCALAPPDATA%\Squaero\csdk        (a client the app unpacked itself)
 *   4. INFORMIXDIR in the registry        (IBM's own install on this machine)
 *   5. the linked Driver Manager          (unixODBC, or odbc32 on Windows)
 *
 * Call sites keep writing SQLFetch(...) and friends: the macros at the bottom
 * send them through the table.
 */

#include <stddef.h>

#if defined(_WIN32)
#  include <windows.h>
#endif
#include <sql.h>
#include <sqlext.h>

struct ifx_odbc {
    SQLRETURN (SQL_API *AllocHandle)(SQLSMALLINT, SQLHANDLE, SQLHANDLE *);
    SQLRETURN (SQL_API *FreeHandle)(SQLSMALLINT, SQLHANDLE);
    SQLRETURN (SQL_API *SetEnvAttr)(SQLHENV, SQLINTEGER, SQLPOINTER, SQLINTEGER);
    SQLRETURN (SQL_API *SetConnectAttr)(SQLHDBC, SQLINTEGER, SQLPOINTER, SQLINTEGER);
    SQLRETURN (SQL_API *DriverConnect)(SQLHDBC, SQLHWND, SQLCHAR *, SQLSMALLINT,
                                       SQLCHAR *, SQLSMALLINT, SQLSMALLINT *,
                                       SQLUSMALLINT);
    SQLRETURN (SQL_API *Disconnect)(SQLHDBC);
    SQLRETURN (SQL_API *ExecDirect)(SQLHSTMT, SQLCHAR *, SQLINTEGER);
    SQLRETURN (SQL_API *ExecDirectW)(SQLHSTMT, SQLWCHAR *, SQLINTEGER);
    SQLRETURN (SQL_API *NumResultCols)(SQLHSTMT, SQLSMALLINT *);
    SQLRETURN (SQL_API *DescribeCol)(SQLHSTMT, SQLUSMALLINT, SQLCHAR *, SQLSMALLINT,
                                     SQLSMALLINT *, SQLSMALLINT *, SQLULEN *,
                                     SQLSMALLINT *, SQLSMALLINT *);
    SQLRETURN (SQL_API *RowCount)(SQLHSTMT, SQLLEN *);
    SQLRETURN (SQL_API *Fetch)(SQLHSTMT);
    SQLRETURN (SQL_API *GetData)(SQLHSTMT, SQLUSMALLINT, SQLSMALLINT, SQLPOINTER,
                                 SQLLEN, SQLLEN *);
    SQLRETURN (SQL_API *GetDiagRec)(SQLSMALLINT, SQLHANDLE, SQLSMALLINT, SQLCHAR *,
                                    SQLINTEGER *, SQLCHAR *, SQLSMALLINT,
                                    SQLSMALLINT *);
    SQLRETURN (SQL_API *EndTran)(SQLSMALLINT, SQLHANDLE, SQLSMALLINT);
    SQLRETURN (SQL_API *Cancel)(SQLHSTMT);
};

extern struct ifx_odbc ifx_odbc;

/*
 * Resolve the entry points, once per process. `want_dsn` asks for a DSN= style
 * connection, which only the Driver Manager can resolve; anything else prefers
 * a CSDK loaded directly. Returns 0 on success, and on failure writes a reason
 * into `err`. Safe to call on every connect: later calls are a no-op.
 */
int ifx_odbc_load(int want_dsn, char *err, size_t errlen);

/* 1 once ifx_odbc_load bound a CSDK driver directly (no Driver Manager), which
   is also when the connection string must not carry a DRIVER= keyword. */
int ifx_odbc_is_direct(void);

#if !defined(IFX_ODBC_IMPL)
#  define SQLAllocHandle    ifx_odbc.AllocHandle
#  define SQLFreeHandle     ifx_odbc.FreeHandle
#  define SQLSetEnvAttr     ifx_odbc.SetEnvAttr
#  define SQLSetConnectAttr ifx_odbc.SetConnectAttr
#  define SQLDriverConnect  ifx_odbc.DriverConnect
#  define SQLDisconnect     ifx_odbc.Disconnect
#  define SQLExecDirect     ifx_odbc.ExecDirect
#  define SQLExecDirectW    ifx_odbc.ExecDirectW
#  define SQLNumResultCols  ifx_odbc.NumResultCols
#  define SQLDescribeCol    ifx_odbc.DescribeCol
#  define SQLRowCount       ifx_odbc.RowCount
#  define SQLFetch          ifx_odbc.Fetch
#  define SQLGetData        ifx_odbc.GetData
#  define SQLGetDiagRec     ifx_odbc.GetDiagRec
#  define SQLEndTran        ifx_odbc.EndTran
#  define SQLCancel         ifx_odbc.Cancel
#endif

#endif /* QUAERO_INFORMIX_ODBC_H */
