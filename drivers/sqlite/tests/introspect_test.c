#include "dbcore/driver.h"

#include <stdio.h>
#include <string.h>

/*
 * Introspection through the driver's own vtable against an in-memory database:
 * list_tables (tables + views, sqlite_* hidden), describe_table (column
 * structure) and get_ddl (the stored CREATE statement). Confirms the
 * capability flags are advertised.
 */

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

/* Count rows and, optionally, look for `needle` in column 0. */
static int scan_col0(const dbc_driver_t *drv, dbc_result *r, const char *needle)
{
    int found = 0;
    while (drv->next_row(r) == 1) {
        const char *v = drv->cell_text(r, 0);
        if (needle != NULL && v != NULL && strcmp(v, needle) == 0) {
            found = 1;
        }
    }
    return found;
}

int main(void)
{
    const dbc_driver_t *drv = dbc_driver_entry();
    EXPECT(drv != NULL, "entry returns a vtable");
    EXPECT((drv->features & DBC_FEAT_INTROSPECTION) != 0, "introspection advertised");
    EXPECT((drv->features & DBC_FEAT_DDL) != 0, "ddl advertised");
    EXPECT(drv->list_databases != NULL, "list_databases present");
    EXPECT(drv->list_tables != NULL, "list_tables present");
    EXPECT(drv->describe_table != NULL, "describe_table present");
    EXPECT(drv->get_ddl != NULL, "get_ddl present");
    EXPECT(drv->list_schemas == NULL, "list_schemas absent (no schemas in sqlite)");

    dbc_conn *c = NULL;
    EXPECT(drv->connect("{\"path\":\":memory:\"}", &c) == DBC_OK, "open :memory:");

    dbc_result *r = NULL;
    drv->query(c, "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, "
                  "age INTEGER DEFAULT 0)", &r);
    drv->free_result(r);
    r = NULL;
    drv->query(c, "CREATE VIEW adults AS SELECT * FROM users WHERE age >= 18", &r);
    drv->free_result(r);
    r = NULL;

    /* list_databases: at least 'main'. */
    {
        EXPECT(drv->list_databases(c, &r) == DBC_OK, "list_databases ok");
        EXPECT(scan_col0(drv, r, "main") == 1, "main database listed");
        drv->free_result(r);
        r = NULL;
    }

    /* list_tables: the table and the view, columns name + type. */
    {
        EXPECT(drv->list_tables(c, NULL, &r) == DBC_OK, "list_tables ok");
        EXPECT(drv->col_count(r) == 2, "name + type columns");
        EXPECT(strcmp(drv->col_name(r, 0), "name") == 0, "col0 is name");
        int saw_users = 0, saw_view = 0;
        while (drv->next_row(r) == 1) {
            const char *name = drv->cell_text(r, 0);
            const char *type = drv->cell_text(r, 1);
            if (name && strcmp(name, "users") == 0 && type && strcmp(type, "table") == 0) {
                saw_users = 1;
            }
            if (name && strcmp(name, "adults") == 0 && type && strcmp(type, "view") == 0) {
                saw_view = 1;
            }
        }
        EXPECT(saw_users, "users table listed as table");
        EXPECT(saw_view, "adults listed as view");
        drv->free_result(r);
        r = NULL;
    }

    /* describe_table: one row per column with name/type/notnull/default/pk. */
    {
        EXPECT(drv->describe_table(c, NULL, "users", &r) == DBC_OK, "describe ok");
        EXPECT(drv->col_count(r) == 5, "5 describe columns");
        int rows = 0, pk_seen = 0, notnull_seen = 0;
        while (drv->next_row(r) == 1) {
            rows++;
            const char *name = drv->cell_text(r, 0);
            const char *nn = drv->cell_text(r, 2);   /* notnull */
            const char *pk = drv->cell_text(r, 4);   /* pk */
            if (name && strcmp(name, "id") == 0 && pk && strcmp(pk, "1") == 0) {
                pk_seen = 1;
            }
            if (name && strcmp(name, "name") == 0 && nn && strcmp(nn, "1") == 0) {
                notnull_seen = 1;
            }
        }
        EXPECT(rows == 3, "three columns described");
        EXPECT(pk_seen, "id marked as primary key");
        EXPECT(notnull_seen, "name marked NOT NULL");
        drv->free_result(r);
        r = NULL;
    }

    /* get_ddl: the stored CREATE statement of the table. */
    {
        EXPECT(drv->get_ddl(c, NULL, "users", &r) == DBC_OK, "get_ddl ok");
        EXPECT(drv->next_row(r) == 1, "ddl row present");
        const char *sql = drv->cell_text(r, 0);
        EXPECT(sql != NULL && strstr(sql, "CREATE TABLE") != NULL, "ddl is a CREATE");
        EXPECT(sql != NULL && strstr(sql, "users") != NULL, "ddl names the table");
        drv->free_result(r);
        r = NULL;
    }

    /* get_ddl for an unknown object: success with no rows (honest empty). */
    {
        EXPECT(drv->get_ddl(c, NULL, "nope", &r) == DBC_OK, "get_ddl unknown ok");
        EXPECT(drv->next_row(r) == 0, "no rows for unknown object");
        drv->free_result(r);
        r = NULL;
    }

    drv->disconnect(c);

    if (failures == 0) {
        printf("OK: sqlite introspection (list/describe/ddl)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
