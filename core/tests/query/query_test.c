#include "dbcore/query.h"
#include "dbcore/result.h"

#include <stdio.h>
#include <string.h>

/* The driver owns dbc_conn / dbc_result; the stub gives them concrete shapes. */
struct dbc_conn { const char *err; };
struct dbc_result {
    int             col_count;
    const char    **names;
    const dbc_type *types;
    int             row_count;
    const char    **cells;        /* row-major; NULL entry == SQL NULL */
    long long       rows_affected;
    int             cursor;       /* -1 before the first next_row */
    int             fail_at;      /* row index where next_row returns -1, or -1 */
};

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

/* query() behavior is driven by these globals. */
static dbc_status   g_status = DBC_OK;
static dbc_result  *g_result = NULL;

static dbc_status d_query(dbc_conn *c, const char *sql, dbc_result **out)
{
    (void)c; (void)sql;
    if (g_status != DBC_OK) {
        *out = NULL;
        return g_status;
    }
    if (g_result != NULL) {
        g_result->cursor = -1;  /* rewind the canned cursor */
    }
    *out = g_result;  /* may be NULL: exercises the success-without-handle path */
    return DBC_OK;
}
static const char *d_last_error(dbc_conn *c) { return c->err; }
static void        d_free_result(dbc_result *r) { (void)r; }
static int         d_col_count(dbc_result *r) { return r->col_count; }
static const char *d_col_name(dbc_result *r, int c) { return r->names[c]; }
static dbc_type    d_col_type(dbc_result *r, int c) { return r->types[c]; }
static long long   d_rows_affected(dbc_result *r) { return r->rows_affected; }
static int d_next_row(dbc_result *r)
{
    int next = r->cursor + 1;
    if (r->fail_at >= 0 && next == r->fail_at) {
        return -1;
    }
    if (next >= r->row_count) {
        r->cursor = r->row_count;
        return 0;
    }
    r->cursor = next;
    return 1;
}
static const char *d_cell_text(dbc_result *r, int c)
{
    return r->cells[r->cursor * r->col_count + c];
}
static dbc_status d_connect(const char *d, dbc_conn **o) { (void)d; (void)o; return DBC_OK; }
static void       d_disconnect(dbc_conn *c) { (void)c; }

static dbc_driver_t make_driver(void)
{
    dbc_driver_t d = {0};
    d.abi_version   = DBC_ABI_VERSION;
    d.name          = "stub";
    d.display_name  = "Stub";
    d.connect       = d_connect;
    d.disconnect    = d_disconnect;
    d.last_error    = d_last_error;
    d.query         = d_query;
    d.free_result   = d_free_result;
    d.col_count     = d_col_count;
    d.col_name      = d_col_name;
    d.col_type      = d_col_type;
    d.next_row      = d_next_row;
    d.cell_text     = d_cell_text;
    d.rows_affected = d_rows_affected;
    return d;
}

int main(void)
{
    dbc_driver_t drv = make_driver();
    dbc_conn conn = { "" };
    dbcore_conn_ref ref = { &drv, &conn };
    char err[256];

    /* --- a SELECT with two typed columns, three rows, one SQL NULL --- */
    static const char *names2[] = { "id", "name" };
    static const dbc_type types2[] = { DBC_TYPE_INT, DBC_TYPE_TEXT };
    static const char *cells2[] = {
        "1", "alice",
        "2", NULL,      /* SQL NULL in (row 1, col 1) */
        "3", "carol",
    };
    dbc_result rs = { 2, names2, types2, 3, cells2, 0, -1, -1 };

    g_status = DBC_OK;
    g_result = &rs;
    {
        dbcore_result *res = NULL;
        dbc_status st = dbcore_query_run(&ref, "SELECT ...", 0, 0, &res, err, sizeof err);
        EXPECT(st == DBC_OK, "select runs");
        EXPECT(res != NULL, "select yields a result");
        EXPECT(dbcore_result_has_result_set(res) == 1, "select has a result set");
        EXPECT(dbcore_result_col_count(res) == 2, "two columns");
        EXPECT(strcmp(dbcore_result_col_name(res, 0), "id") == 0, "col 0 name");
        EXPECT(dbcore_result_col_type(res, 1) == DBC_TYPE_TEXT, "col 1 type");
        EXPECT(dbcore_result_row_count(res) == 3, "three rows");
        EXPECT(dbcore_result_truncated(res) == 0, "not truncated");
        EXPECT(strcmp(dbcore_result_cell(res, 0, 1), "alice") == 0, "cell(0,1)");
        EXPECT(dbcore_result_cell_is_null(res, 0, 1) == 0, "non-null cell");
        EXPECT(dbcore_result_cell(res, 1, 1) == NULL, "NULL cell is NULL");
        EXPECT(dbcore_result_cell_is_null(res, 1, 1) == 1, "NULL cell flagged");
        EXPECT(strcmp(dbcore_result_cell(res, 2, 0), "3") == 0, "cell(2,0)");
        /* out-of-range access is safe */
        EXPECT(dbcore_result_cell(res, 9, 0) == NULL, "row out of range");
        EXPECT(dbcore_result_col_name(res, 9) == NULL, "col out of range");
        dbcore_result_free(res);
    }

    /* --- max_rows cap reports truncation --- */
    {
        dbcore_result *res = NULL;
        dbc_status st = dbcore_query_run(&ref, "SELECT ...", 2, 0, &res, err, sizeof err);
        EXPECT(st == DBC_OK, "capped select runs");
        EXPECT(dbcore_result_row_count(res) == 2, "fetched only max_rows");
        EXPECT(dbcore_result_truncated(res) == 1, "truncation reported");
        dbcore_result_free(res);
    }

    /* --- offset pagination (issue #134): skip leading rows --- */
    g_result = &rs; /* the 3-row fixture: 1/alice, 2/NULL, 3/carol */
    {
        /* page 2 of size 1: offset 1 -> row "2", and a further page exists */
        dbcore_result *res = NULL;
        dbc_status st = dbcore_query_run(&ref, "SELECT ...", 1, 1, &res, err, sizeof err);
        EXPECT(st == DBC_OK, "offset select runs");
        EXPECT(dbcore_result_row_count(res) == 1, "one row after offset+limit");
        EXPECT(strcmp(dbcore_result_cell(res, 0, 0), "2") == 0, "offset skipped row 1");
        EXPECT(dbcore_result_truncated(res) == 1, "further page exists");
        dbcore_result_free(res);
    }
    {
        /* last page: offset 2, generous limit -> only row "3", no more */
        dbcore_result *res = NULL;
        dbc_status st = dbcore_query_run(&ref, "SELECT ...", 10, 2, &res, err, sizeof err);
        EXPECT(st == DBC_OK, "last-page select runs");
        EXPECT(dbcore_result_row_count(res) == 1, "one remaining row");
        EXPECT(strcmp(dbcore_result_cell(res, 0, 0), "3") == 0, "row 3 is last");
        EXPECT(dbcore_result_truncated(res) == 0, "no further page");
        dbcore_result_free(res);
    }
    {
        /* offset past the end -> empty, not truncated */
        dbcore_result *res = NULL;
        dbc_status st = dbcore_query_run(&ref, "SELECT ...", 10, 99, &res, err, sizeof err);
        EXPECT(st == DBC_OK, "beyond-end select runs");
        EXPECT(dbcore_result_row_count(res) == 0, "no rows past the end");
        EXPECT(dbcore_result_truncated(res) == 0, "not truncated past the end");
        dbcore_result_free(res);
    }

    /* --- an empty result set (columns, zero rows) --- */
    {
        dbc_result empty = { 2, names2, types2, 0, cells2, 0, -1, -1 };
        g_result = &empty;
        dbcore_result *res = NULL;
        dbc_status st = dbcore_query_run(&ref, "SELECT ... WHERE 0", 0, 0, &res, err, sizeof err);
        EXPECT(st == DBC_OK, "empty select runs");
        EXPECT(dbcore_result_has_result_set(res) == 1, "still a result set");
        EXPECT(dbcore_result_row_count(res) == 0, "zero rows");
        dbcore_result_free(res);
    }

    /* --- a statement with no result set (INSERT/UPDATE) --- */
    {
        dbc_result noset = { 0, NULL, NULL, 0, NULL, 5, -1, -1 };
        g_result = &noset;
        dbcore_result *res = NULL;
        dbc_status st = dbcore_query_run(&ref, "UPDATE ...", 0, 0, &res, err, sizeof err);
        EXPECT(st == DBC_OK, "update runs");
        EXPECT(dbcore_result_has_result_set(res) == 0, "no result set");
        EXPECT(dbcore_result_col_count(res) == 0, "zero columns");
        EXPECT(dbcore_result_row_count(res) == 0, "zero rows");
        EXPECT(dbcore_result_rows_affected(res) == 5, "rows_affected reported");
        dbcore_result_free(res);
    }

    /* --- query execution failure propagates the driver's last_error --- */
    {
        conn.err = "syntax error near SELCT";
        g_status = DBC_ERR_QUERY;
        g_result = NULL;
        dbcore_result *res = NULL;
        dbc_status st = dbcore_query_run(&ref, "SELCT", 0, 0, &res, err, sizeof err);
        EXPECT(st == DBC_ERR_QUERY, "failed query returns DBC_ERR_QUERY");
        EXPECT(res == NULL, "failed query yields no result");
        EXPECT(strcmp(err, "syntax error near SELCT") == 0, "last_error propagated");
    }

    /* --- an error while iterating rows is surfaced --- */
    {
        conn.err = "connection reset mid-fetch";
        g_status = DBC_OK;
        dbc_result flaky = { 2, names2, types2, 3, cells2, 0, -1, 2 }; /* fail at row 2 */
        g_result = &flaky;
        dbcore_result *res = NULL;
        dbc_status st = dbcore_query_run(&ref, "SELECT ...", 0, 0, &res, err, sizeof err);
        EXPECT(st == DBC_ERR_QUERY, "row-fetch error returns DBC_ERR_QUERY");
        EXPECT(res == NULL, "row-fetch error yields no result");
        EXPECT(strcmp(err, "connection reset mid-fetch") == 0, "iteration error propagated");
    }

    /* --- driver reports success but yields no result handle --- */
    {
        conn.err = "";
        g_status = DBC_OK;
        g_result = NULL;
        dbcore_result *res = NULL;
        dbc_status st = dbcore_query_run(&ref, "SELECT ...", 0, 0, &res, err, sizeof err);
        EXPECT(st == DBC_ERR_QUERY, "success+NULL handle is DBC_ERR_QUERY");
        EXPECT(res == NULL, "no result on missing handle");
        EXPECT(err[0] != '\0', "a reason is reported");
    }

    /* --- argument validation --- */
    {
        dbcore_result *res = NULL;
        EXPECT(dbcore_query_run(NULL, "x", 0, 0, &res, err, sizeof err) == DBC_ERR_PARAM, "NULL conn");
        EXPECT(dbcore_query_run(&ref, NULL, 0, 0, &res, err, sizeof err) == DBC_ERR_PARAM, "NULL sql");
        EXPECT(dbcore_query_run(&ref, "x", 0, 0, NULL, err, sizeof err) == DBC_ERR_PARAM, "NULL out");
    }

    /* --- a NULL errbuf / zero capacity must not crash --- */
    {
        conn.err = "boom";
        g_status = DBC_ERR_QUERY;
        g_result = NULL;
        dbcore_result *res = NULL;
        EXPECT(dbcore_query_run(&ref, "x", 0, 0, &res, NULL, 0) == DBC_ERR_QUERY,
               "NULL errbuf is tolerated");
        EXPECT(res == NULL, "still no result with NULL errbuf");
    }

    if (failures == 0) {
        printf("OK: query execution + result model (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
