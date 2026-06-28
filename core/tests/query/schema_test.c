#include "dbcore/schema.h"
#include "dbcore/result.h"

#include <stdio.h>
#include <string.h>

/* Stub driver: concrete shapes for the opaque handles, plus canned result. */
struct dbc_conn { const char *err; };
struct dbc_result { int cursor; };

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

/* Records which introspection method ran and with what parent. */
static const char *g_last_call = NULL;
static const char *g_last_parent = NULL;
static const char *g_last_schema = NULL;
static dbc_result  g_canned;     /* single column "name", one row "x" */

static dbc_result *fresh(void) { g_canned.cursor = -1; return &g_canned; }

static const char *d_last_error(dbc_conn *c) { return c->err; }
static void        d_free_result(dbc_result *r) { (void)r; }
static int         d_col_count(dbc_result *r) { (void)r; return 1; }
static const char *d_col_name(dbc_result *r, int c) { (void)r; (void)c; return "name"; }
static dbc_type    d_col_type(dbc_result *r, int c) { (void)r; (void)c; return DBC_TYPE_TEXT; }
static long long   d_rows_affected(dbc_result *r) { (void)r; return 0; }
static int d_next_row(dbc_result *r)
{
    if (r->cursor + 1 >= 1) { r->cursor = 1; return 0; }
    r->cursor++; return 1;
}
static const char *d_cell_text(dbc_result *r, int c) { (void)r; (void)c; return "x"; }
static dbc_status d_query(dbc_conn *c, const char *s, dbc_result **o)
{ (void)c; (void)s; *o = fresh(); return DBC_OK; }

static dbc_status d_list_databases(dbc_conn *c, dbc_result **o)
{ (void)c; g_last_call = "list_databases"; *o = fresh(); return DBC_OK; }
static dbc_status d_list_schemas(dbc_conn *c, const char *db, dbc_result **o)
{ (void)c; g_last_call = "list_schemas"; g_last_parent = db; *o = fresh(); return DBC_OK; }
static dbc_status d_list_tables(dbc_conn *c, const char *s, dbc_result **o)
{ (void)c; g_last_call = "list_tables"; g_last_parent = s; *o = fresh(); return DBC_OK; }
static dbc_status d_describe(dbc_conn *c, const char *schema, const char *t, dbc_result **o)
{ (void)c; g_last_call = "describe"; g_last_schema = schema; g_last_parent = t; *o = fresh(); return DBC_OK; }
static dbc_status d_get_ddl(dbc_conn *c, const char *schema, const char *ob, dbc_result **o)
{ (void)c; g_last_call = "get_ddl"; g_last_schema = schema; g_last_parent = ob; *o = fresh(); return DBC_OK; }

/* Build a driver with all introspection + ddl members and the given features. */
static dbc_driver_t full_driver(unsigned int features)
{
    dbc_driver_t d = {0};
    d.abi_version = DBC_ABI_VERSION;
    d.name = "stub"; d.display_name = "Stub";
    d.last_error = d_last_error;
    d.query = d_query; d.free_result = d_free_result;
    d.col_count = d_col_count; d.col_name = d_col_name; d.col_type = d_col_type;
    d.next_row = d_next_row; d.cell_text = d_cell_text; d.rows_affected = d_rows_affected;
    d.list_databases = d_list_databases;
    d.list_schemas = d_list_schemas;
    d.list_tables = d_list_tables;
    d.describe_table = d_describe;
    d.get_ddl = d_get_ddl;
    d.features = features;
    return d;
}

int main(void)
{
    char err[256];
    dbc_conn conn = { "boom" };

    /* --- tree routing decided by the core from (db, schema) + features --- */
    {
        /* Engine WITH schemas: db-only lists schemas. */
        dbc_driver_t drv = full_driver(DBC_FEAT_INTROSPECTION | DBC_FEAT_SCHEMAS | DBC_FEAT_DDL);
        dbcore_conn_ref ref = { &drv, &conn };
        dbcore_result *res = NULL;

        g_last_call = NULL;
        EXPECT(dbcore_schema_tree(&ref, NULL, NULL, 0, &res, err, sizeof err) == DBC_OK,
               "tree root ok");
        EXPECT(g_last_call && strcmp(g_last_call, "list_databases") == 0,
               "root -> list_databases");
        EXPECT(res && dbcore_result_col_count(res) == 1, "result materialized");
        dbcore_result_free(res); res = NULL;

        EXPECT(dbcore_schema_tree(&ref, "mydb", NULL, 0, &res, err, sizeof err) == DBC_OK,
               "tree db ok (schemas engine)");
        EXPECT(g_last_call && strcmp(g_last_call, "list_schemas") == 0,
               "db -> list_schemas when engine has schemas");
        EXPECT(g_last_parent && strcmp(g_last_parent, "mydb") == 0, "schemas parent passed");
        dbcore_result_free(res); res = NULL;

        EXPECT(dbcore_schema_tree(&ref, "mydb", "s1", 0, &res, err, sizeof err) == DBC_OK,
               "tree schema ok");
        EXPECT(g_last_call && strcmp(g_last_call, "list_tables") == 0, "schema -> list_tables");
        EXPECT(g_last_parent && strcmp(g_last_parent, "s1") == 0, "tables parent is schema");
        dbcore_result_free(res); res = NULL;

        EXPECT(dbcore_schema_describe(&ref, "mydb", "t", 0, &res, err, sizeof err) == DBC_OK, "describe ok");
        EXPECT(g_last_call && strcmp(g_last_call, "describe") == 0, "routed to describe");
        EXPECT(g_last_schema && strcmp(g_last_schema, "mydb") == 0, "describe schema passed");
        EXPECT(g_last_parent && strcmp(g_last_parent, "t") == 0, "describe table passed");
        dbcore_result_free(res); res = NULL;

        EXPECT(dbcore_schema_ddl(&ref, "mydb", "obj", 0, &res, err, sizeof err) == DBC_OK, "ddl ok");
        EXPECT(g_last_call && strcmp(g_last_call, "get_ddl") == 0, "routed to get_ddl");
        EXPECT(g_last_schema && strcmp(g_last_schema, "mydb") == 0, "ddl schema passed");
        dbcore_result_free(res); res = NULL;
    }

    /* --- schemaless engine: a db's children are its tables (not schemas) --- */
    {
        dbc_driver_t drv = full_driver(DBC_FEAT_INTROSPECTION);  /* no DBC_FEAT_SCHEMAS */
        drv.list_schemas = NULL;
        dbcore_conn_ref ref = { &drv, &conn };
        dbcore_result *res = NULL;
        g_last_call = NULL;
        EXPECT(dbcore_schema_tree(&ref, "main", NULL, 0, &res, err, sizeof err) == DBC_OK,
               "tree db ok (schemaless)");
        EXPECT(g_last_call && strcmp(g_last_call, "list_tables") == 0,
               "db -> list_tables on schemaless engine");
        EXPECT(g_last_parent && strcmp(g_last_parent, "main") == 0, "tables parent is db");
        dbcore_result_free(res); res = NULL;
    }

    /* --- capability not advertised -> DBC_ERR_UNSUPPORTED --- */
    {
        dbc_driver_t drv = full_driver(0u);  /* methods present, but no flags */
        dbcore_conn_ref ref = { &drv, &conn };
        dbcore_result *res = NULL;
        EXPECT(dbcore_schema_tree(&ref, NULL, NULL, 0, &res, err, sizeof err)
               == DBC_ERR_UNSUPPORTED, "no introspection flag -> unsupported");
        EXPECT(res == NULL, "no result on unsupported");
        EXPECT(dbcore_schema_describe(&ref, NULL, "t", 0, &res, err, sizeof err) == DBC_ERR_UNSUPPORTED,
               "describe unsupported without flag");
        EXPECT(dbcore_schema_ddl(&ref, NULL, "o", 0, &res, err, sizeof err) == DBC_ERR_UNSUPPORTED,
               "ddl unsupported without flag");
    }

    /* --- flag set but the specific method is NULL -> unsupported --- */
    {
        dbc_driver_t drv = full_driver(DBC_FEAT_INTROSPECTION | DBC_FEAT_SCHEMAS);
        drv.list_schemas = NULL;  /* claims schemas but provides no lister */
        dbcore_conn_ref ref = { &drv, &conn };
        dbcore_result *res = NULL;
        EXPECT(dbcore_schema_tree(&ref, "db", NULL, 0, &res, err, sizeof err)
               == DBC_ERR_UNSUPPORTED, "NULL list_schemas -> unsupported");
        EXPECT(res == NULL, "no result");
    }

    /* --- argument validation --- */
    {
        dbc_driver_t drv = full_driver(DBC_FEAT_INTROSPECTION | DBC_FEAT_DDL);
        dbcore_conn_ref ref = { &drv, &conn };
        dbcore_result *res = NULL;
        EXPECT(dbcore_schema_describe(&ref, NULL, NULL, 0, &res, err, sizeof err) == DBC_ERR_PARAM,
               "NULL table -> param");
        EXPECT(dbcore_schema_ddl(&ref, NULL, NULL, 0, &res, err, sizeof err) == DBC_ERR_PARAM,
               "NULL object -> param");
        EXPECT(dbcore_schema_tree(NULL, NULL, NULL, 0, &res, err, sizeof err)
               == DBC_ERR_PARAM, "NULL conn -> param");
    }

    if (failures == 0) {
        printf("OK: schema introspection layer (routing + unsupported + params)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
