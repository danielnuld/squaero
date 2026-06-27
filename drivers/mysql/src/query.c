#include "internal.h"
#include "utils/types.h"

#include <stdlib.h>
#include <string.h>

/*
 * Query execution and result iteration. Results are buffered client-side with
 * mysql_store_result, so row iteration never fails mid-stream and the core can
 * read rows_affected for non-result statements without iterating.
 */

/* Run a text statement; wrap a buffered result set, or record affected rows for
   a non-result statement (INSERT/UPDATE/DDL). */
static dbc_status run(dbc_conn *c, const char *sql, dbc_result **out)
{
    *out = NULL;

    if (mysql_real_query(c->db, sql, (unsigned long)strlen(sql)) != 0) {
        return DBC_ERR_QUERY;  /* reason is on c->db via mysql_error */
    }

    dbc_result *r = calloc(1, sizeof *r);
    if (r == NULL) {
        return DBC_ERR_NOMEM;
    }

    MYSQL_RES *res = mysql_store_result(c->db);
    if (res == NULL) {
        if (mysql_field_count(c->db) != 0) {
            /* Columns were expected but the result could not be stored. */
            free(r);
            return DBC_ERR_QUERY;
        }
        /* No result set: an INSERT/UPDATE/DDL statement. */
        r->affected = (long long)mysql_affected_rows(c->db);
    } else {
        r->res = res;
        r->field_count = mysql_num_fields(res);
        r->fields = mysql_fetch_fields(res);
    }

    *out = r;
    return DBC_OK;
}

dbc_status mysql_drv_query(dbc_conn *c, const char *sql, dbc_result **out)
{
    return run(c, sql, out);
}

dbc_status mysql_drv_run_stored(dbc_conn *c, const char *sql, dbc_result **out)
{
    return run(c, sql, out);
}

void mysql_drv_free_result(dbc_result *r)
{
    if (r == NULL) {
        return;
    }
    if (r->res != NULL) {
        mysql_free_result(r->res);
    }
    free(r->synth_sql);
    free(r);
}

int mysql_drv_col_count(dbc_result *r)
{
    if (r == NULL) {
        return 0;
    }
    if (r->synthetic) {
        return 1;
    }
    return r->res != NULL ? (int)r->field_count : 0;
}

const char *mysql_drv_col_name(dbc_result *r, int col)
{
    if (r == NULL) {
        return NULL;
    }
    if (r->synthetic) {
        return "sql";
    }
    if (r->fields == NULL || col < 0 || (unsigned int)col >= r->field_count) {
        return NULL;
    }
    return r->fields[col].name;
}

dbc_type mysql_drv_col_type(dbc_result *r, int col)
{
    if (r == NULL) {
        return DBC_TYPE_NULL;
    }
    if (r->synthetic) {
        return DBC_TYPE_TEXT;
    }
    if (r->fields == NULL || col < 0 || (unsigned int)col >= r->field_count) {
        return DBC_TYPE_NULL;
    }
    return mysql_type_to_neutral((int)r->fields[col].type);
}

int mysql_drv_next_row(dbc_result *r)
{
    if (r == NULL) {
        return 0;
    }
    if (r->synthetic) {
        if (r->synth_done) {
            return 0;
        }
        r->synth_done = 1;
        return r->synth_sql != NULL ? 1 : 0;
    }
    if (r->res == NULL) {
        return 0;
    }
    r->row = mysql_fetch_row(r->res);
    return r->row != NULL ? 1 : 0;
}

const char *mysql_drv_cell_text(dbc_result *r, int col)
{
    if (r == NULL) {
        return NULL;
    }
    if (r->synthetic) {
        return col == 0 ? r->synth_sql : NULL;
    }
    if (r->row == NULL || col < 0 || (unsigned int)col >= r->field_count) {
        return NULL;
    }
    return r->row[col];  /* NULL for a SQL NULL (text protocol) */
}

long long mysql_drv_rows_affected(dbc_result *r)
{
    return r != NULL ? r->affected : 0;
}
