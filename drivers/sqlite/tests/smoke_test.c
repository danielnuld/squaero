#include "dbcore/driver.h"

#include <stdio.h>
#include <string.h>

/*
 * End-to-end smoke test: drive the SQLite driver through its own vtable (exactly
 * as the core would) against an in-memory database — DDL, DML and a SELECT with
 * a SQL NULL — plus the connect/query error paths.
 */

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

int main(void)
{
    const dbc_driver_t *drv = dbc_driver_entry();
    EXPECT(drv != NULL, "entry returns a vtable");
    EXPECT(drv->abi_version == DBC_ABI_VERSION, "abi matches");
    EXPECT(strcmp(drv->name, "sqlite") == 0, "driver name");

    /* A missing DSN path fails with an error-state handle the core can query. */
    {
        dbc_conn *bad = NULL;
        dbc_status st = drv->connect("{}", &bad);
        EXPECT(st == DBC_ERR_PARAM, "missing path -> DBC_ERR_PARAM");
        EXPECT(bad != NULL, "error-state handle returned");
        EXPECT(strlen(drv->last_error(bad)) > 0, "a reason is available");
        drv->disconnect(bad);
    }

    /* Open an in-memory database. */
    dbc_conn *c = NULL;
    EXPECT(drv->connect("{\"path\":\":memory:\"}", &c) == DBC_OK, "open :memory:");
    EXPECT(c != NULL, "connection handle");

    /* DDL: no result set, zero rows affected. */
    {
        dbc_result *r = NULL;
        dbc_status st = drv->query(c, "CREATE TABLE t (id INTEGER, name TEXT)", &r);
        EXPECT(st == DBC_OK, "CREATE TABLE");
        EXPECT(drv->col_count(r) == 0, "DDL has no result set");
        drv->free_result(r);
    }

    /* DML: two rows inserted, one with a NULL. */
    {
        dbc_result *r = NULL;
        dbc_status st = drv->query(c, "INSERT INTO t VALUES (1, 'alice'), (2, NULL)", &r);
        EXPECT(st == DBC_OK, "INSERT");
        EXPECT(drv->col_count(r) == 0, "DML has no result set");
        EXPECT(drv->rows_affected(r) == 2, "two rows affected");
        drv->free_result(r);
    }

    /* SELECT: columns, types, rows and a SQL NULL. */
    {
        dbc_result *r = NULL;
        dbc_status st = drv->query(c, "SELECT id, name FROM t ORDER BY id", &r);
        EXPECT(st == DBC_OK, "SELECT");
        EXPECT(drv->col_count(r) == 2, "two columns");
        EXPECT(strcmp(drv->col_name(r, 0), "id") == 0, "col 0 name");
        EXPECT(strcmp(drv->col_name(r, 1), "name") == 0, "col 1 name");
        EXPECT(drv->col_type(r, 0) == DBC_TYPE_INT, "id is INT");
        EXPECT(drv->col_type(r, 1) == DBC_TYPE_TEXT, "name is TEXT");

        EXPECT(drv->next_row(r) == 1, "row 0 present");
        EXPECT(strcmp(drv->cell_text(r, 0), "1") == 0, "row0 id");
        EXPECT(strcmp(drv->cell_text(r, 1), "alice") == 0, "row0 name");

        EXPECT(drv->next_row(r) == 1, "row 1 present");
        EXPECT(strcmp(drv->cell_text(r, 0), "2") == 0, "row1 id");
        EXPECT(drv->cell_text(r, 1) == NULL, "row1 name is SQL NULL");

        EXPECT(drv->next_row(r) == 0, "no more rows");
        drv->free_result(r);
    }

    /* A bad query fails and exposes SQLite's message. */
    {
        dbc_result *r = NULL;
        dbc_status st = drv->query(c, "SELECT * FROM does_not_exist", &r);
        EXPECT(st == DBC_ERR_QUERY, "bad query -> DBC_ERR_QUERY");
        EXPECT(strstr(drv->last_error(c), "no such table") != NULL,
               "error message propagated");
    }

    drv->disconnect(c);

    if (failures == 0) {
        printf("OK: sqlite driver smoke (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
