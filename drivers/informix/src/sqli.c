#include "sqli.h"

#include <stdio.h>
#include <string.h>

#if defined(_WIN32)

#include "utils/connlost.h"
#include "utils/connstr.h"
#include "utils/odbc_types.h"
#include "utils/text.h"
#include "utils/utf16.h"

#include <windows.h>
#include <sql.h>
#include <sqlext.h>

#include <stdint.h>
#include <stdlib.h>

/*
 * See sqli.h. The ODBC entry points come from the CSDK's own driver DLL
 * (iclit09b.dll), which exports the whole API, so nothing is linked and no
 * Driver Manager is involved. The table is bound once per process.
 */

static struct {
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
} odbc;

static int odbc_bound;

#define OK(rc) ((rc) == SQL_SUCCESS || (rc) == SQL_SUCCESS_WITH_INFO)
#if defined(_WIN64)
#  define BITS "64-bit"
#else
#  define BITS "32-bit"
#endif

/* Every entry point, or none: a client missing one is too old to drive. */
static int bind_entry_points(HMODULE h)
{
#define GET(field, name)                                                      \
    do {                                                                      \
        FARPROC p = GetProcAddress(h, name);                                  \
        if (p == NULL) {                                                      \
            return -1;                                                        \
        }                                                                     \
        memcpy(&odbc.field, &p, sizeof p);                                    \
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
    return 0;
}

/*
 * Load the client under one INFORMIXDIR. The CSDK finds its locale and message
 * files through INFORMIXDIR, so that is published to the process first;
 * LOAD_WITH_ALTERED_SEARCH_PATH lets the DLL pull its siblings out of the same
 * bin\ without putting it on PATH. A client of the other bitness cannot load
 * into this process, and is named as such.
 */
static int try_root(const char *root, char *err, size_t errlen)
{
    char path[MAX_PATH];
    HMODULE h;
    if (snprintf(path, sizeof path, "%s\\bin\\iclit09b.dll", root) >= (int)sizeof path) {
        return -1;
    }
    h = LoadLibraryExA(path, NULL, LOAD_WITH_ALTERED_SEARCH_PATH);
    if (h == NULL) {
        if (GetLastError() == ERROR_BAD_EXE_FORMAT) {
            snprintf(err, errlen, "the IBM Informix Client SDK in %s is not %s, "
                     "as this Squaero is: install the %s one", root, BITS, BITS);
        }
        return -1;
    }
    SetEnvironmentVariableA("INFORMIXDIR", root);
    if (bind_entry_points(h) != 0) {
        snprintf(err, errlen, "the IBM Informix Client SDK in %s is too old", root);
        FreeLibrary(h);
        return -1;
    }
    return 0;
}

/* ponytail: no lock. Two connects racing here bind the same table to the same
   values, and LoadLibrary is idempotent. */
static int load(char *err, size_t errlen)
{
    char root[MAX_PATH];
    DWORD n = (DWORD)sizeof root;
    if (odbc_bound) {
        return 0;
    }
    snprintf(err, errlen, "the IBM Informix Client SDK (%s) is not installed "
             "(looked in INFORMIXDIR and the registry)", BITS);
    /* GetEnvironmentVariableA, not getenv: the CRT copy would not see what
       try_root writes. */
    n = GetEnvironmentVariableA("INFORMIXDIR", root, (DWORD)sizeof root);
    if (n > 0 && n < sizeof root && try_root(root, err, errlen) == 0) {
        odbc_bound = 1;
        return 0;
    }
    /* The registry view matches this process: a 64-bit plugin reads where the
       64-bit CSDK registers itself, a 32-bit one WOW6432Node. */
    n = (DWORD)sizeof root;
    if (RegGetValueA(HKEY_LOCAL_MACHINE, "SOFTWARE\\Informix\\Environment", "INFORMIXDIR",
                     RRF_RT_REG_SZ, NULL, root, &n) == ERROR_SUCCESS &&
        try_root(root, err, errlen) == 0) {
        odbc_bound = 1;
        return 0;
    }
    return -1;
}

struct ifx_sqli {
    SQLHENV          env;
    SQLHDBC          dbc;
    int              connected;
    char             err[1024];
    int              conn_lost;
    /* The statement a cancel from another thread should interrupt, or NULL.
       Guarded by lock, which the free path takes too, so a cancel never
       reaches a freed handle. */
    SQLHSTMT         active;
    CRITICAL_SECTION lock;
};

/*
 * A result. Cells are pulled with SQLGetData(SQL_C_CHAR) into per-column
 * buffers that grow to fit, so a cell stays valid until the next fetch.
 */
struct ifx_sqli_result {
    ifx_sqli  *s;
    SQLHSTMT   stmt;        /* NULL once a statement without rows is done */
    int        ncols;
    char     **name;        /* [ncols] UTF-8 */
    short     *type;        /* [ncols] ODBC SQL type */
    char     **cell;        /* [ncols] current row */
    size_t    *cap;
    int       *null;
    char     **u8;          /* [ncols] UTF-8 copy when a cell was not */
    size_t    *u8cap;
    long long  affected;
};

#define CELL_INIT_CAP 256

static void track(ifx_sqli *s, SQLHSTMT h)
{
    EnterCriticalSection(&s->lock);
    s->active = h;
    LeaveCriticalSection(&s->lock);
}

/* Stop tracking h (a stale call for another statement is a no-op). */
static void untrack(ifx_sqli *s, SQLHSTMT h)
{
    EnterCriticalSection(&s->lock);
    if (s->active == h) {
        s->active = NULL;
    }
    LeaveCriticalSection(&s->lock);
}

/* "<ctx>: [SQLSTATE] message; ..." from the diagnostic records of h. */
static void stash(ifx_sqli *s, SQLSMALLINT htype, SQLHANDLE h, const char *ctx)
{
    SQLSMALLINT rec = 1, len;
    SQLCHAR state[6], msg[512];
    SQLINTEGER native;
    int pos = snprintf(s->err, sizeof s->err, "%s", ctx);
    s->conn_lost = 0;
    while (pos >= 0 && (size_t)pos < sizeof s->err &&
           OK(odbc.GetDiagRec(htype, h, rec, state, &native, msg, sizeof msg, &len))) {
        int n;
        if (ifx_sqlstate_is_conn_lost((const char *)state)) {
            s->conn_lost = 1;
        }
        n = snprintf(s->err + pos, sizeof s->err - (size_t)pos, "%s[%s] %s",
                     rec == 1 ? ": " : "; ", (const char *)state, (const char *)msg);
        if (n < 0) {
            break;
        }
        pos += n;
        rec++;
    }
    if (rec == 1) {
        snprintf(s->err, sizeof s->err, "%s: no diagnostic available", ctx);
    }
    /* Messages are localized: a Spanish one carries accents in the client's
       code set, which would break the frame meant to report it. */
    ifx_text_fix_utf8_inplace(s->err, sizeof s->err);
}

ifx_sqli *ifx_sqli_connect(const struct ifx_dsn *d, char *err, size_t errlen)
{
    char service[16], conn_str[2048];
    ifx_sqli *s;
    SQLRETURN rc;
    struct informix_conn_params p;

    if (load(err, errlen) != 0) {
        return NULL;
    }
    s = calloc(1, sizeof *s);
    if (s == NULL) {
        snprintf(err, errlen, "out of memory");
        return NULL;
    }
    InitializeCriticalSection(&s->lock);

    snprintf(service, sizeof service, "%d", d->port);
    memset(&p, 0, sizeof p);
    p.host = d->host;
    p.service = service;
    p.server = d->sqli_server;
    p.database = d->database;
    p.user = d->user;
    p.password = d->password;
    if (informix_build_conn_str(&p, conn_str, sizeof conn_str) < 0) {
        snprintf(err, errlen, "the connection values are too long for SQLI");
        ifx_sqli_close(s);
        return NULL;
    }

    if (!OK(odbc.AllocHandle(SQL_HANDLE_ENV, SQL_NULL_HANDLE, &s->env))) {
        snprintf(err, errlen, "SQLAllocHandle(ENV) failed");
        ifx_sqli_close(s);
        return NULL;
    }
    odbc.SetEnvAttr(s->env, SQL_ATTR_ODBC_VERSION, (SQLPOINTER)SQL_OV_ODBC3, 0);
    if (!OK(odbc.AllocHandle(SQL_HANDLE_DBC, s->env, &s->dbc))) {
        snprintf(err, errlen, "SQLAllocHandle(DBC) failed");
        ifx_sqli_close(s);
        return NULL;
    }
    rc = odbc.DriverConnect(s->dbc, NULL, (SQLCHAR *)conn_str, SQL_NTS, NULL, 0, NULL,
                            SQL_DRIVER_NOPROMPT);
    memset(conn_str, 0, sizeof conn_str); /* it held the password */
    if (!OK(rc)) {
        stash(s, SQL_HANDLE_DBC, s->dbc, "connect");
        snprintf(err, errlen, "%s", s->err);
        ifx_sqli_close(s);
        return NULL;
    }
    s->connected = 1;
    return s;
}

void ifx_sqli_close(ifx_sqli *s)
{
    if (s == NULL) {
        return;
    }
    if (s->dbc != NULL) {
        if (s->connected) {
            odbc.Disconnect(s->dbc);
        }
        odbc.FreeHandle(SQL_HANDLE_DBC, s->dbc);
    }
    if (s->env != NULL) {
        odbc.FreeHandle(SQL_HANDLE_ENV, s->env);
    }
    DeleteCriticalSection(&s->lock);
    free(s);
}

const char *ifx_sqli_error(const ifx_sqli *s)
{
    return s != NULL ? s->err : "";
}

int ifx_sqli_conn_lost(const ifx_sqli *s)
{
    return s != NULL && s->conn_lost;
}

int ifx_sqli_cancel(ifx_sqli *s)
{
    int rc = -1;
    /* Under the lock the free path takes too, so the handle stays alive.
       SQLCancel is quick and meant to be called from another thread. */
    EnterCriticalSection(&s->lock);
    if (s->active != NULL) {
        rc = OK(odbc.Cancel(s->active)) ? 0 : -1;
    }
    LeaveCriticalSection(&s->lock);
    return rc;
}

int ifx_sqli_begin(ifx_sqli *s)
{
    if (!OK(odbc.SetConnectAttr(s->dbc, SQL_ATTR_AUTOCOMMIT,
                                (SQLPOINTER)(uintptr_t)SQL_AUTOCOMMIT_OFF, SQL_IS_INTEGER))) {
        stash(s, SQL_HANDLE_DBC, s->dbc, "begin");
        return -1;
    }
    return 0;
}

int ifx_sqli_end(ifx_sqli *s, int commit)
{
    int rc = 0;
    if (!OK(odbc.EndTran(SQL_HANDLE_DBC, s->dbc, commit ? SQL_COMMIT : SQL_ROLLBACK))) {
        stash(s, SQL_HANDLE_DBC, s->dbc, commit ? "commit" : "rollback");
        rc = -1;
    }
    /* Back to autocommit either way, so later statements are not held. */
    odbc.SetConnectAttr(s->dbc, SQL_ATTR_AUTOCOMMIT,
                        (SQLPOINTER)(uintptr_t)SQL_AUTOCOMMIT_ON, SQL_IS_INTEGER);
    return rc;
}

void ifx_sqli_free(ifx_sqli_result *r)
{
    int i;
    if (r == NULL) {
        return;
    }
    if (r->stmt != NULL) {
        untrack(r->s, r->stmt);
        odbc.FreeHandle(SQL_HANDLE_STMT, r->stmt);
    }
    for (i = 0; i < r->ncols; i++) {
        if (r->name != NULL) free(r->name[i]);
        if (r->cell != NULL) free(r->cell[i]);
        if (r->u8 != NULL) free(r->u8[i]);
    }
    free(r->name);
    free(r->type);
    free(r->cell);
    free(r->cap);
    free(r->null);
    free(r->u8);
    free(r->u8cap);
    free(r);
}

/* Allocate the per-column arrays and describe each column. */
static int describe(ifx_sqli_result *r, int ncols)
{
    int i;
    r->ncols = ncols;
    r->name  = calloc((size_t)ncols, sizeof *r->name);
    r->type  = calloc((size_t)ncols, sizeof *r->type);
    r->cell  = calloc((size_t)ncols, sizeof *r->cell);
    r->cap   = calloc((size_t)ncols, sizeof *r->cap);
    r->null  = calloc((size_t)ncols, sizeof *r->null);
    r->u8    = calloc((size_t)ncols, sizeof *r->u8);
    r->u8cap = calloc((size_t)ncols, sizeof *r->u8cap);
    if (r->name == NULL || r->type == NULL || r->cell == NULL || r->cap == NULL ||
        r->null == NULL || r->u8 == NULL || r->u8cap == NULL) {
        return -1;
    }
    for (i = 0; i < ncols; i++) {
        SQLCHAR name[256] = { 0 };
        SQLSMALLINT name_len = 0, sql_type = 0, decimals = 0, nullable = 0;
        SQLULEN size = 0;
        size_t len;
        if (!OK(odbc.DescribeCol(r->stmt, (SQLUSMALLINT)(i + 1), name, sizeof name,
                                 &name_len, &sql_type, &size, &decimals, &nullable))) {
            return -1;
        }
        /* name_len counts what was available, which exceeds the buffer when
           the name was cut; never trust NUL termination alone. */
        len = name_len > 0 ? (size_t)name_len : 0;
        if (len > sizeof name - 1) {
            len = sizeof name - 1;
        }
        name[len] = '\0';
        r->name[i] = ifx_text_to_utf8_dup((const char *)name);
        r->cell[i] = malloc(CELL_INIT_CAP);
        if (r->name[i] == NULL || r->cell[i] == NULL) {
            return -1;
        }
        r->cell[i][0] = '\0';
        r->cap[i] = CELL_INIT_CAP;
        r->type[i] = (short)sql_type;
    }
    return 0;
}

int ifx_sqli_query(ifx_sqli *s, const char *sql, ifx_sqli_result **out)
{
    ifx_sqli_result *r;
    unsigned short *wsql;
    SQLSMALLINT ncols = 0;
    SQLRETURN rc;
    *out = NULL;
    r = calloc(1, sizeof *r);
    if (r == NULL) {
        snprintf(s->err, sizeof s->err, "query: out of memory");
        return -1;
    }
    r->s = s;
    if (!OK(odbc.AllocHandle(SQL_HANDLE_STMT, s->dbc, &r->stmt))) {
        stash(s, SQL_HANDLE_DBC, s->dbc, "query");
        r->stmt = NULL;
        ifx_sqli_free(r);
        return -1;
    }
    track(s, r->stmt);
    /* Accents only inside string literals go through the wide entry point, so
       the driver converts them to the database's code set (issue #324); the
       CSDK crashes on non-ASCII outside a literal, which stays on the ANSI
       path and gets the server's own error. */
    wsql = ifx_sql_wide_safe(sql) ? ifx_utf8_to_utf16(sql, NULL) : NULL;
    if (wsql != NULL) {
        rc = odbc.ExecDirectW(r->stmt, (SQLWCHAR *)wsql, SQL_NTS);
        free(wsql);
    } else {
        rc = odbc.ExecDirect(r->stmt, (SQLCHAR *)sql, SQL_NTS);
    }
    if (!OK(rc) && rc != SQL_NO_DATA) {
        stash(s, SQL_HANDLE_STMT, r->stmt, "query");
        ifx_sqli_free(r);
        return -1;
    }
    odbc.NumResultCols(r->stmt, &ncols);
    if (ncols <= 0) {
        SQLLEN n = 0;
        odbc.RowCount(r->stmt, &n);
        r->affected = (long long)n;
        untrack(s, r->stmt);
        odbc.FreeHandle(SQL_HANDLE_STMT, r->stmt);
        r->stmt = NULL;
    } else if (describe(r, ncols) != 0) {
        snprintf(s->err, sizeof s->err, "query: could not describe the result");
        ifx_sqli_free(r);
        return -1;
    }
    *out = r;
    return 0;
}

int ifx_sqli_col_count(const ifx_sqli_result *r)
{
    return r->ncols;
}

const char *ifx_sqli_col_name(const ifx_sqli_result *r, int col)
{
    return r->name[col];
}

dbc_type ifx_sqli_col_type(const ifx_sqli_result *r, int col)
{
    return informix_odbc_type_to_neutral((int)r->type[col]);
}

/* One column of the current row into its buffer, growing to fit. */
static int fetch_cell(ifx_sqli_result *r, int col)
{
    size_t used = 0;
    r->null[col] = 0;
    r->cell[col][0] = '\0';
    for (;;) {
        SQLLEN ind = 0;
        SQLRETURN rc = odbc.GetData(r->stmt, (SQLUSMALLINT)(col + 1), SQL_C_CHAR,
                                    r->cell[col] + used, (SQLLEN)(r->cap[col] - used), &ind);
        if (rc == SQL_NO_DATA) {
            return 0;
        }
        if (!OK(rc)) {
            return -1;
        }
        if (ind == SQL_NULL_DATA) {
            r->null[col] = 1;
            return 0;
        }
        if (rc == SQL_SUCCESS) {
            return 0;
        }
        /* Truncated: the buffer holds cap - used - 1 more bytes. Grow, go on. */
        {
            size_t ncap = r->cap[col] * 2;
            char *nb = realloc(r->cell[col], ncap);
            if (nb == NULL) {
                return -1;
            }
            used = r->cap[col] - 1;
            r->cell[col] = nb;
            r->cap[col] = ncap;
        }
    }
}

int ifx_sqli_next(ifx_sqli_result *r)
{
    SQLRETURN rc;
    int i;
    if (r->stmt == NULL) {
        return 0;
    }
    rc = odbc.Fetch(r->stmt);
    if (rc == SQL_NO_DATA) {
        return 0;
    }
    if (!OK(rc)) {
        stash(r->s, SQL_HANDLE_STMT, r->stmt, "fetch");
        return -1;
    }
    for (i = 0; i < r->ncols; i++) {
        if (fetch_cell(r, i) != 0) {
            stash(r->s, SQL_HANDLE_STMT, r->stmt, "fetch");
            return -1;
        }
    }
    return 1;
}

const char *ifx_sqli_text(ifx_sqli_result *r, int col)
{
    const char *u;
    if (r->null[col]) {
        return NULL;
    }
    /* CLIENT_LOCALE asks for UTF-8, so this is normally a pass-through; the
       net is for a client that ignored it. */
    u = ifx_text_to_utf8(r->cell[col], &r->u8[col], &r->u8cap[col]);
    return u != NULL ? u : r->cell[col];
}

long long ifx_sqli_rows_affected(const ifx_sqli_result *r)
{
    return r->affected;
}

#else /* !_WIN32: the fallback exists only where the CSDK is loaded directly. */

ifx_sqli *ifx_sqli_connect(const struct ifx_dsn *d, char *err, size_t errlen)
{
    (void)d;
    snprintf(err, errlen, "SQLI (the IBM Client SDK) is only used on Windows");
    return NULL;
}

/* Never reached: no connection is ever made here. */
void ifx_sqli_close(ifx_sqli *s) { (void)s; }
const char *ifx_sqli_error(const ifx_sqli *s) { (void)s; return ""; }
int ifx_sqli_conn_lost(const ifx_sqli *s) { (void)s; return 1; }
int ifx_sqli_cancel(ifx_sqli *s) { (void)s; return -1; }
int ifx_sqli_begin(ifx_sqli *s) { (void)s; return -1; }
int ifx_sqli_end(ifx_sqli *s, int commit) { (void)s; (void)commit; return -1; }
int ifx_sqli_query(ifx_sqli *s, const char *sql, ifx_sqli_result **out)
{
    (void)s; (void)sql; *out = NULL; return -1;
}
int ifx_sqli_col_count(const ifx_sqli_result *r) { (void)r; return 0; }
const char *ifx_sqli_col_name(const ifx_sqli_result *r, int col) { (void)r; (void)col; return NULL; }
dbc_type ifx_sqli_col_type(const ifx_sqli_result *r, int col) { (void)r; (void)col; return DBC_TYPE_NULL; }
int ifx_sqli_next(ifx_sqli_result *r) { (void)r; return 0; }
const char *ifx_sqli_text(ifx_sqli_result *r, int col) { (void)r; (void)col; return NULL; }
long long ifx_sqli_rows_affected(const ifx_sqli_result *r) { (void)r; return 0; }
void ifx_sqli_free(ifx_sqli_result *r) { (void)r; }

#endif
