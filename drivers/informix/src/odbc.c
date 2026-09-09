/*
 * Binding the ODBC entry points (issue #490). See odbc.h for the why and the
 * search order; this file is the only place allowed to name the real SQL*
 * symbols, so it defines IFX_ODBC_IMPL to keep the redirect macros off.
 */

#define IFX_ODBC_IMPL
#include "odbc.h"

#include <stdio.h>
#include <string.h>

struct ifx_odbc ifx_odbc;

static int loaded;   /* 1 once the table is bound */
static int direct;   /* 1 when bound to a CSDK driver rather than the manager */

int ifx_odbc_is_direct(void)
{
    return direct;
}

/* The Driver Manager linked at build time: odbc32 on Windows, unixODBC
   elsewhere. Always available, so this is the fallback that cannot fail. */
static void bind_manager(void)
{
    ifx_odbc.AllocHandle    = SQLAllocHandle;
    ifx_odbc.FreeHandle     = SQLFreeHandle;
    ifx_odbc.SetEnvAttr     = SQLSetEnvAttr;
    ifx_odbc.SetConnectAttr = SQLSetConnectAttr;
    ifx_odbc.DriverConnect  = SQLDriverConnect;
    ifx_odbc.Disconnect     = SQLDisconnect;
    ifx_odbc.ExecDirect     = SQLExecDirect;
    ifx_odbc.ExecDirectW    = SQLExecDirectW;
    ifx_odbc.NumResultCols  = SQLNumResultCols;
    ifx_odbc.DescribeCol    = SQLDescribeCol;
    ifx_odbc.RowCount       = SQLRowCount;
    ifx_odbc.Fetch          = SQLFetch;
    ifx_odbc.GetData        = SQLGetData;
    ifx_odbc.GetDiagRec     = SQLGetDiagRec;
    ifx_odbc.EndTran        = SQLEndTran;
    ifx_odbc.Cancel         = SQLCancel;
    direct = 0;
}

#if defined(_WIN32)

/* Every entry point the driver uses, resolved from the CSDK's own DLL. If any
   one of them is missing the client is too old to drive, so the whole table is
   discarded rather than half-filled. */
static int bind_csdk(HMODULE h)
{
    struct ifx_odbc t;
    memset(&t, 0, sizeof t);
#define GET(field, name)                                                      \
    do {                                                                      \
        FARPROC p = GetProcAddress(h, name);                                  \
        if (p == NULL) {                                                      \
            return -1;                                                        \
        }                                                                     \
        *(FARPROC *)(void *)&t.field = p;                                     \
    } while (0)
    GET(AllocHandle,    "SQLAllocHandle");
    GET(FreeHandle,     "SQLFreeHandle");
    GET(SetEnvAttr,     "SQLSetEnvAttr");
    GET(SetConnectAttr, "SQLSetConnectAttr");
    GET(DriverConnect,  "SQLDriverConnect");
    GET(Disconnect,     "SQLDisconnect");
    GET(ExecDirect,     "SQLExecDirect");
    GET(ExecDirectW,    "SQLExecDirectW");
    GET(NumResultCols,  "SQLNumResultCols");
    GET(DescribeCol,    "SQLDescribeCol");
    GET(RowCount,       "SQLRowCount");
    GET(Fetch,          "SQLFetch");
    GET(GetData,        "SQLGetData");
    GET(GetDiagRec,     "SQLGetDiagRec");
    GET(EndTran,        "SQLEndTran");
    GET(Cancel,         "SQLCancel");
#undef GET
    ifx_odbc = t;
    direct = 1;
    return 0;
}

/*
 * Try one candidate client root. The CSDK finds its locale and message files
 * through INFORMIXDIR, so that is published to the process before the DLL is
 * loaded; LOAD_WITH_ALTERED_SEARCH_PATH lets the driver pull its sibling DLLs
 * out of the same bin/ without putting that directory on PATH.
 */
static int try_csdk(const char *root)
{
    char path[MAX_PATH];
    if (root == NULL || root[0] == '\0') {
        return -1;
    }
    if (snprintf(path, sizeof path, "%s\\bin\\iclit09b.dll", root) >= (int)sizeof path) {
        return -1;
    }
    HMODULE h = LoadLibraryExA(path, NULL, LOAD_WITH_ALTERED_SEARCH_PATH);
    if (h == NULL) {
        return -1;
    }
    SetEnvironmentVariableA("INFORMIXDIR", root);
    if (bind_csdk(h) != 0) {
        FreeLibrary(h);
        return -1;
    }
    return 0;
}

/* <directory holding this plugin>\..\<name>, i.e. a sibling of drivers\. */
static int app_relative(const char *name, char *out, size_t outlen)
{
    HMODULE self = NULL;
    if (!GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                            GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                            /* any address inside this module; a data one
                               because ISO C will not cast a function pointer */
                            (LPCSTR)(void *)&loaded, &self)) {
        return -1;
    }
    char path[MAX_PATH];
    DWORD n = GetModuleFileNameA(self, path, sizeof path);
    if (n == 0 || n >= sizeof path) {
        return -1;
    }
    char *slash = strrchr(path, '\\');
    if (slash == NULL) {
        return -1;
    }
    *slash = '\0';                       /* .../drivers */
    slash = strrchr(path, '\\');
    if (slash == NULL) {
        return -1;
    }
    *slash = '\0';                       /* the install directory */
    if (snprintf(out, outlen, "%s\\%s", path, name) >= (int)outlen) {
        return -1;
    }
    return 0;
}

static int registry_informixdir(char *out, DWORD outlen)
{
    /* This plugin is 32-bit, so HKLM\SOFTWARE already reads the WOW6432Node
       view where the 32-bit CSDK registers itself. */
    return RegGetValueA(HKEY_LOCAL_MACHINE, "SOFTWARE\\Informix\\Environment",
                        "INFORMIXDIR", RRF_RT_REG_SZ, NULL, out,
                        &outlen) == ERROR_SUCCESS ? 0 : -1;
}

/* GetEnvironmentVariableA rather than getenv: MSVC deprecates the latter, and
   this driver also writes the environment, which the CRT copy would not see. */
static int env_var(const char *name, char *out, DWORD outlen)
{
    DWORD n = GetEnvironmentVariableA(name, out, outlen);
    return (n > 0 && n < outlen) ? 0 : -1;
}

static int load_direct(void)
{
    char buf[MAX_PATH];
    char env[MAX_PATH];

    if (env_var("INFORMIXDIR", env, (DWORD)sizeof env) == 0 &&
        try_csdk(env) == 0) {
        return 0;
    }
    if (app_relative("csdk", buf, sizeof buf) == 0 && try_csdk(buf) == 0) {
        return 0;
    }
    if (env_var("LOCALAPPDATA", env, (DWORD)sizeof env) == 0 &&
        snprintf(buf, sizeof buf, "%s\\Squaero\\csdk", env) < (int)sizeof buf &&
        try_csdk(buf) == 0) {
        return 0;
    }
    if (registry_informixdir(buf, (DWORD)sizeof buf) == 0 && try_csdk(buf) == 0) {
        return 0;
    }
    return -1;
}

#else

static int load_direct(void)
{
    /* Informix on POSIX goes through unixODBC as before. */
    return -1;
}

#endif

int ifx_odbc_load(int want_dsn, char *err, size_t errlen)
{
    /* ponytail: no lock. Two connects racing here both bind the same table to
       the same values, and LoadLibrary is idempotent; add one if the search
       order ever gains a side effect. */
    if (loaded) {
        if (want_dsn && direct) {
            snprintf(err, errlen,
                     "a DSN needs the ODBC Driver Manager, but this session "
                     "already loaded the Informix client directly");
            return -1;
        }
        return 0;
    }
    /* DSN= is resolved by the Driver Manager, so a connection asking for one
       cannot use a directly loaded client. */
    if (want_dsn || load_direct() != 0) {
        bind_manager();
    }
    loaded = 1;
    (void)err;
    (void)errlen;
    return 0;
}
