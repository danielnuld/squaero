/* <mysql.h> on libmywire: see mysql.h for why. */
#include "mysql.h"

#include "mywire.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Client error numbers, as libmysqlclient reports them (utils/connlost.c
 * tells a lost connection by these). */
#define CR_UNKNOWN_ERROR 2000u
#define CR_CONN_HOST_ERROR 2003u
#define CR_SERVER_LOST 2013u

struct MYSQL {
    mw_conn *c;
    mw_options o;
    char *ca, *cert, *key;
    char err[512];
    unsigned int errnum;
    unsigned int field_count;
    unsigned long long affected;
    mw_result *r; /* the last query's rows, until mysql_store_result */
};

struct MYSQL_RES {
    MYSQL_FIELD *fields;
    unsigned int nfields;
    char **rows; /* each: nfields pointers, nfields lengths, then the cells */
    size_t nrows, cap, next;
    MYSQL_ROW cur;
};

static void set_err(MYSQL *db, unsigned int num, const char *msg)
{
    db->errnum = num;
    snprintf(db->err, sizeof db->err, "%s", msg);
}

/* Take libmywire's error: the server's number, or the client's for a lost
 * connection or a local failure. */
static void take_err(MYSQL *db)
{
    unsigned int n = mw_errno(db->c);
    if (mw_conn_lost(db->c))
        n = CR_SERVER_LOST;
    else if (!n)
        n = CR_UNKNOWN_ERROR;
    set_err(db, n, mw_error(db->c));
}

static char *dup_or_null(const char *s)
{
    char *d;
    if (!s)
        return NULL;
    d = malloc(strlen(s) + 1);
    if (d)
        strcpy(d, s);
    return d;
}

MYSQL *mysql_init(MYSQL *unused)
{
    (void)unused;
    return calloc(1, sizeof(MYSQL));
}

int mysql_options(MYSQL *db, int option, const void *arg)
{
    if (option == MYSQL_OPT_SSL_MODE) {
        switch (*(const unsigned int *)arg) {
        case SSL_MODE_DISABLED: db->o.tls = MW_TLS_OFF; break;
        case SSL_MODE_PREFERRED: db->o.tls = MW_TLS_PREFER; break;
        case SSL_MODE_REQUIRED: db->o.tls = MW_TLS_REQUIRE; break;
        case SSL_MODE_VERIFY_CA: db->o.tls = MW_TLS_VERIFY_CA; break;
        case SSL_MODE_VERIFY_IDENTITY: db->o.tls = MW_TLS_VERIFY_FULL; break;
        default: return 1;
        }
    }
    /* The character set is always utf8mb4; there are no plugins to find. */
    return 0;
}

int mysql_ssl_set(MYSQL *db, const char *key, const char *cert, const char *ca,
                  const char *capath, const char *cipher)
{
    (void)capath;
    (void)cipher;
    db->key = dup_or_null(key);
    db->cert = dup_or_null(cert);
    db->ca = dup_or_null(ca);
    if (db->o.tls == MW_TLS_OFF)
        db->o.tls = MW_TLS_PREFER; /* as the connector does once TLS is armed */
    return 0;
}

MYSQL *mysql_real_connect(MYSQL *db, const char *host, const char *user, const char *password,
                          const char *database, unsigned int port, const char *unix_socket,
                          unsigned long flags)
{
    (void)flags;
    if (unix_socket && (!host || !strcmp(host, "localhost"))) {
        set_err(db, CR_CONN_HOST_ERROR, "Unix sockets are not supported by this build: use a host and port");
        return NULL;
    }
    db->o.host = host ? host : "localhost";
    db->o.port = (int)port;
    db->o.user = user;
    db->o.password = password;
    db->o.database = database;
    db->o.ca_file = db->ca;
    db->o.cert_file = db->cert;
    db->o.key_file = db->key;
    db->c = mw_connect(&db->o, db->err, sizeof db->err);
    if (!db->c) {
        db->errnum = CR_CONN_HOST_ERROR; /* the driver only reads the message */
        return NULL;
    }
    return db;
}

void mysql_close(MYSQL *db)
{
    if (!db)
        return;
    mw_free(db->r);
    mw_close(db->c);
    free(db->ca);
    free(db->cert);
    free(db->key);
    free(db);
}

const char *mysql_error(MYSQL *db) { return db->err; }
unsigned int mysql_errno(MYSQL *db) { return db->errnum; }
const char *mysql_get_ssl_cipher(MYSQL *db) { return db->c ? mw_tls_cipher(db->c) : NULL; }
unsigned long mysql_thread_id(MYSQL *db) { return db->c ? mw_thread_id(db->c) : 0; }
int mysql_thread_init(void) { return 0; }
void mysql_thread_end(void) {}

int mysql_real_query(MYSQL *db, const char *sql, unsigned long len)
{
    mw_result *r;
    mw_free(db->r); /* a result never stored */
    db->r = NULL;
    db->field_count = 0;
    db->affected = 0;
    db->err[0] = 0;
    db->errnum = 0;
    if (!db->c) {
        set_err(db, CR_SERVER_LOST, "not connected");
        return 1;
    }
    if (mw_query(db->c, sql, len, &r) < 0) {
        take_err(db);
        return 1;
    }
    db->field_count = (unsigned int)mw_col_count(r);
    db->affected = mw_rows_affected(r);
    if (db->field_count)
        db->r = r;
    else
        mw_free(r);
    return 0;
}

int mysql_query(MYSQL *db, const char *sql) { return mysql_real_query(db, sql, strlen(sql)); }

unsigned int mysql_field_count(MYSQL *db) { return db->field_count; }
unsigned long long mysql_affected_rows(MYSQL *db) { return db->affected; }

/* Copy the current row: pointers, lengths, then each cell with its NUL. */
static char *copy_row(mw_result *r, unsigned int n)
{
    size_t head = n * (sizeof(char *) + sizeof(unsigned long)), size = head;
    unsigned int i;
    char *p, *data;
    char **cells;
    unsigned long *lens;
    for (i = 0; i < n; i++)
        size += mw_len(r, (int)i) + 1;
    p = malloc(size);
    if (!p)
        return NULL;
    cells = (char **)p;
    lens = (unsigned long *)(p + n * sizeof(char *));
    data = p + head;
    for (i = 0; i < n; i++) {
        const char *t = mw_text(r, (int)i);
        size_t len = mw_len(r, (int)i);
        lens[i] = (unsigned long)len;
        if (!t) {
            cells[i] = NULL;
            continue;
        }
        cells[i] = data;
        memcpy(data, t, len + 1);
        data += len + 1;
    }
    return p;
}

MYSQL_RES *mysql_store_result(MYSQL *db)
{
    mw_result *r = db->r;
    MYSQL_RES *res;
    unsigned int i, n;
    int rc;
    if (!r)
        return NULL;
    db->r = NULL;
    n = db->field_count;
    res = calloc(1, sizeof *res);
    if (!res || !(res->fields = calloc(n, sizeof *res->fields)))
        goto oom;
    res->nfields = n;
    for (i = 0; i < n; i++) {
        const mw_column *col = mw_col(r, (int)i);
        res->fields[i].name = dup_or_null(col->name);
        if (!res->fields[i].name)
            goto oom;
        res->fields[i].type = col->type;
        res->fields[i].flags = col->flags;
        res->fields[i].charsetnr = col->charset;
        res->fields[i].length = col->length;
        res->fields[i].decimals = col->decimals;
    }
    while ((rc = mw_next(r)) > 0) {
        if (res->nrows == res->cap) {
            size_t cap = res->cap ? res->cap * 2 : 64;
            char **rows = realloc(res->rows, cap * sizeof *rows);
            if (!rows)
                goto oom;
            res->rows = rows;
            res->cap = cap;
        }
        if (!(res->rows[res->nrows] = copy_row(r, n)))
            goto oom;
        res->nrows++;
    }
    if (rc < 0) {
        take_err(db);
        mw_free(r);
        mysql_free_result(res);
        return NULL;
    }
    mw_free(r);
    return res;
oom:
    set_err(db, CR_UNKNOWN_ERROR, "out of memory storing the result");
    mw_free(r); /* reads the rest, so the connection stays in step */
    mysql_free_result(res);
    return NULL;
}

unsigned int mysql_num_fields(MYSQL_RES *res) { return res->nfields; }
MYSQL_FIELD *mysql_fetch_fields(MYSQL_RES *res) { return res->fields; }

MYSQL_ROW mysql_fetch_row(MYSQL_RES *res)
{
    res->cur = res->next < res->nrows ? (MYSQL_ROW)res->rows[res->next++] : NULL;
    return res->cur;
}

unsigned long *mysql_fetch_lengths(MYSQL_RES *res)
{
    return res->cur ? (unsigned long *)((char *)res->cur + res->nfields * sizeof(char *)) : NULL;
}

void mysql_free_result(MYSQL_RES *res)
{
    size_t i;
    if (!res)
        return;
    for (i = 0; i < res->nrows; i++)
        free(res->rows[i]);
    if (res->fields)
        for (i = 0; i < res->nfields; i++)
            free(res->fields[i].name);
    free(res->rows);
    free(res->fields);
    free(res);
}

unsigned long mysql_real_escape_string(MYSQL *db, char *to, const char *from, unsigned long len)
{
    return (unsigned long)mw_escape(db->c, to, from, len);
}
