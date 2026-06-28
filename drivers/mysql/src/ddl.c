#include "internal.h"
#include "utils/identifier.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * DDL generation. MySQL's SHOW CREATE TABLE returns two (or, for a view, four)
 * columns where column 1 is the CREATE statement. To honor the neutral get_ddl
 * contract (a one-column "sql" result), the driver runs SHOW CREATE, reads that
 * column and returns a synthetic single-column result.
 */
dbc_status mysql_drv_get_ddl(dbc_conn *c, const char *schema, const char *object,
                             dbc_result **out)
{
    *out = NULL;

    char qobj[256];
    if (!mysql_quote_identifier(object, qobj, sizeof qobj)) {
        return DBC_ERR_PARAM;
    }

    /* Qualify with the database when given: SHOW CREATE TABLE `db`.`obj`. */
    char sql[640];
    int n;
    if (schema != NULL && schema[0] != '\0') {
        char qschema[256];
        if (!mysql_quote_identifier(schema, qschema, sizeof qschema)) {
            return DBC_ERR_PARAM;
        }
        n = snprintf(sql, sizeof sql, "SHOW CREATE TABLE %s.%s", qschema, qobj);
    } else {
        n = snprintf(sql, sizeof sql, "SHOW CREATE TABLE %s", qobj);
    }
    if (n < 0 || (size_t)n >= sizeof sql) {
        return DBC_ERR_PARAM;
    }

    if (mysql_real_query(c->db, sql, (unsigned long)strlen(sql)) != 0) {
        return DBC_ERR_QUERY;
    }
    MYSQL_RES *res = mysql_store_result(c->db);
    if (res == NULL) {
        return DBC_ERR_QUERY;
    }

    dbc_result *r = calloc(1, sizeof *r);
    if (r == NULL) {
        mysql_free_result(res);
        return DBC_ERR_NOMEM;
    }
    r->synthetic = 1;

    MYSQL_ROW row = mysql_fetch_row(res);
    if (row != NULL && mysql_num_fields(res) >= 2 && row[1] != NULL) {
        size_t len = strlen(row[1]) + 1;
        r->synth_sql = malloc(len);
        if (r->synth_sql == NULL) {
            /* Don't return DBC_OK with a silently-empty result. */
            mysql_free_result(res);
            free(r);
            return DBC_ERR_NOMEM;
        }
        memcpy(r->synth_sql, row[1], len);
    }
    mysql_free_result(res);

    *out = r;
    return DBC_OK;
}
