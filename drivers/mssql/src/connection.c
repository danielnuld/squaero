#include "internal.h"
#include "utils/options.h"

#include "cJSON.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Connection lifecycle for the SQL Server driver over FreeTDS db-lib. The DSN
 * arrives as JSON:
 *
 *   { "host": "127.0.0.1", "port": "1433", "instance": "SQLEXPRESS",
 *     "user": "sa", "password": "secret", "database": "app",
 *     "encryption": "request" }
 *
 * `host` and `user` are required. `port` and `instance` are alternatives (a named
 * instance is found through the SQL Browser); `encryption` is one of off /
 * request / require / strict (utils/options.h). No freetds.conf is read or
 * needed: every setting goes on the LOGINREC. Credentials are only held for the
 * duration of connect.
 *
 * Errors: db-lib reports through two process-wide callbacks. Once a DBPROCESS
 * exists they find the owning dbc_conn via dbsetuserdata; before that (a failed
 * login) there is no DBPROCESS, so the reason is kept per thread and copied into
 * the handle connect hands back.
 *
 * Cancel (issue #668): db-lib's dbcancel must not be called from another thread
 * while dbsqlexec runs, so ms_drv_cancel only raises an atomic flag
 * (utils/cancel.h). The query thread acts on it:
 *   - while it waits on the server, through db-lib's interrupt handler. FreeTDS
 *     polls the socket in one-second slices when a handler is installed (always
 *     the case for db-lib) and asks chkintr between slices; when it says yes,
 *     hndlintr answers INT_CANCEL, the wait ends as a timeout, and err_handler
 *     gets SYBETIME. Answering INT_TIMEOUT there makes FreeTDS send the ATTENTION
 *     and keep reading until the server acknowledges it: the query fails, the
 *     connection lives (INT_CANCEL would close the socket instead).
 *   - while rows or results keep arriving (no wait, so no interrupt), through
 *     ms_cancel_claimed in query.c, which then dbcancels on its own thread.
 * So a cancel lands within about a second.
 */

static const char k_canceled[] = "query canceled";

static _Thread_local char g_login_err[1024];

static void copy_err(char *buf, size_t cap, const char *msg)
{
    if (buf == NULL || cap == 0) {
        return;
    }
    snprintf(buf, cap, "%s", msg != NULL ? msg : "");
}

/* Where a callback about `dbproc` should write: its connection, or the
   per-thread login buffer while no connection exists yet. */
static char *err_target(DBPROCESS *dbproc)
{
    dbc_conn *c = dbproc != NULL ? (dbc_conn *)dbgetuserdata(dbproc) : NULL;
    return c != NULL ? c->err : g_login_err;
}

static int err_handler(DBPROCESS *dbproc, int severity, int dberr, int oserr,
                       char *dberrstr, char *oserrstr)
{
    (void)severity;
    /* The only timeout this driver can see is the one its interrupt handler
       forces on a cancel (no query timeout is set): send the ATTENTION and keep
       the connection. Anything else keeps the old answer, cancel. */
    if (dberr == SYBETIME && dbproc != NULL) {
        dbc_conn *c = (dbc_conn *)dbgetuserdata(dbproc);
        if (c != NULL && ms_cancel_claimed(c)) {
            return INT_TIMEOUT;
        }
    }
    char *target = err_target(dbproc);
    /* A server message recorded just before (e.g. "Login failed for user")
       explains the failure better than db-lib's generic follow-up. */
    if (target[0] == '\0') {
        if (oserr != 0 && oserrstr != NULL && oserrstr[0] != '\0') {
            snprintf(target, sizeof g_login_err, "%s (%s)", dberrstr != NULL ? dberrstr : "",
                     oserrstr);
        } else {
            copy_err(target, sizeof g_login_err, dberrstr);
        }
    }
    return INT_CANCEL;
}

static int msg_handler(DBPROCESS *dbproc, DBINT msgno, int msgstate, int severity,
                       char *msgtext, char *srvname, char *procname, int line)
{
    (void)msgno;
    (void)msgstate;
    (void)srvname;
    (void)procname;
    (void)line;
    /* Severity 10 and below is informational ("Changed database context to…"). */
    if (severity > 10) {
        copy_err(err_target(dbproc), sizeof g_login_err, msgtext);
    }
    return 0;
}

/* db-lib's interrupt pair, asked between the one-second waits on the server. */
static int chk_interrupt(void *dbproc)
{
    dbc_conn *c = (dbc_conn *)dbgetuserdata((DBPROCESS *)dbproc);
    return c != NULL && mssql_cancel_pending(&c->cancel);
}

static int handle_interrupt(void *dbproc)
{
    (void)dbproc;
    return INT_CANCEL; /* end the wait; err_handler then sends the ATTENTION */
}

int ms_cancel_claimed(dbc_conn *c)
{
    if (!mssql_cancel_claim(&c->cancel)) {
        return 0;
    }
    copy_err(c->err, sizeof c->err, k_canceled);
    return 1;
}

dbc_status ms_drv_cancel(dbc_conn *c)
{
    if (c == NULL) {
        return DBC_ERR_PARAM;
    }
    mssql_cancel_request(&c->cancel);
    return DBC_OK;
}

/* dbinit and the handlers are process-wide; install them once.
   ponytail: not guarded against two first connects racing on two threads; the
   core opens connections from one thread, so it does not happen today. */
static int ensure_init(void)
{
    static int initialized = 0;
    if (!initialized) {
        if (dbinit() == FAIL) {
            return 0;
        }
        dberrhandle(err_handler);
        dbmsghandle(msg_handler);
        initialized = 1;
    }
    return 1;
}

static const char *field_str(const cJSON *root, const char *key)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
    if (!cJSON_IsString(item) || item->valuestring == NULL ||
        item->valuestring[0] == '\0') {
        return NULL;
    }
    return item->valuestring;
}

/* `port` as a positive number, from a string (what the frontend sends) or a JSON
   number; 0 when absent or invalid. */
static int field_port(const cJSON *root)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(root, "port");
    if (cJSON_IsNumber(item) && item->valueint > 0 && item->valueint <= 65535) {
        return item->valueint;
    }
    if (cJSON_IsString(item) && item->valuestring != NULL) {
        char *end = NULL;
        long v = strtol(item->valuestring, &end, 10);
        if (end != item->valuestring && *end == '\0' && v > 0 && v <= 65535) {
            return (int)v;
        }
    }
    return 0;
}

/* Fill the login record and open the connection; the reason for a failure is
   left in c->err. */
static dbc_status open_connection(dbc_conn *c, const cJSON *root)
{
    const char *host = field_str(root, "host");
    const char *user = field_str(root, "user");
    if (host == NULL || user == NULL) {
        copy_err(c->err, sizeof c->err, "dsn needs 'host' and 'user'");
        return DBC_ERR_PARAM;
    }
    const char *encryption = mssql_encryption_option(field_str(root, "encryption"));
    if (encryption == NULL) {
        copy_err(c->err, sizeof c->err,
                 "encryption must be off, request, require or strict");
        return DBC_ERR_PARAM;
    }
    const char *instance = field_str(root, "instance");
    int port = field_port(root);
    if (instance != NULL && port != 0) {
        copy_err(c->err, sizeof c->err, "give either 'port' or 'instance', not both");
        return DBC_ERR_PARAM;
    }

    LOGINREC *login = dblogin();
    if (login == NULL) {
        copy_err(c->err, sizeof c->err, "out of memory creating the login record");
        return DBC_ERR_NOMEM;
    }
    DBSETLUSER(login, user);
    const char *password = field_str(root, "password");
    if (password != NULL) {
        DBSETLPWD(login, password);
    }
    DBSETLAPP(login, "quaero");
    /* The IPC transport is UTF-8 only: have FreeTDS convert every string. */
    DBSETLCHARSET(login, "UTF-8");
    DBSETLVERSION(login, DBVERSION_74);
    DBSETLENCRYPTION(login, encryption);
    const char *database = field_str(root, "database");
    if (database != NULL) {
        DBSETLDBNAME(login, database);
    }
    if (port != 0) {
        DBSETLPORT(login, port);
    }

    /* A named instance is addressed as host\instance. */
    char server[512];
    snprintf(server, sizeof server, instance != NULL ? "%s\\%s" : "%s", host, instance);

    g_login_err[0] = '\0';
    c->dbproc = dbopen(login, server);
    dbloginfree(login);
    if (c->dbproc == NULL) {
        copy_err(c->err, sizeof c->err,
                 g_login_err[0] != '\0' ? g_login_err : "could not connect to SQL Server");
        return DBC_ERR_CONN;
    }
    dbsetuserdata(c->dbproc, (BYTE *)c);
    dbsetinterrupt(c->dbproc, chk_interrupt, handle_interrupt);

    /* db-lib logs in without the TDS ODBC flag, so the session keeps the old
       DB-Library defaults: among them ANSI_NULL_DFLT_ON OFF, which makes a
       column declared without NULL / NOT NULL refuse NULLs. Ask for what ODBC,
       libtdswire and SSMS sessions get, so both clients behave the same. */
    dbc_result *r = NULL;
    dbc_status st = ms_drv_query(c,
                                 "SET ANSI_NULLS, ANSI_NULL_DFLT_ON, ANSI_PADDING, ANSI_WARNINGS, "
                                 "CONCAT_NULL_YIELDS_NULL, QUOTED_IDENTIFIER ON",
                                 &r);
    ms_drv_free_result(r);
    return st;
}

dbc_status ms_drv_connect(const char *dsn_json, dbc_conn **out)
{
    *out = NULL;
    dbc_conn *c = calloc(1, sizeof *c);
    if (c == NULL) {
        return DBC_ERR_NOMEM;
    }
    *out = c; /* even on failure: the core reads last_error, then disconnects */
    if (!ensure_init()) {
        copy_err(c->err, sizeof c->err, "FreeTDS db-lib failed to initialize");
        return DBC_ERR_CONN;
    }
    cJSON *root = dsn_json != NULL ? cJSON_Parse(dsn_json) : NULL;
    if (root == NULL) {
        copy_err(c->err, sizeof c->err, "dsn must be a JSON object");
        return DBC_ERR_PARAM;
    }
    dbc_status st = open_connection(c, root);
    cJSON_Delete(root);
    return st;
}

void ms_drv_disconnect(dbc_conn *c)
{
    if (c == NULL) {
        return;
    }
    if (c->dbproc != NULL) {
        dbclose(c->dbproc);
    }
    free(c);
}

const char *ms_drv_last_error(dbc_conn *c)
{
    return c != NULL ? c->err : "";
}
