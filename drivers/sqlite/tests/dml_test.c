#include "dml.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Unit tests for the pure single-row DML builder. */

static int failures = 0;

static void check(const char *label, char *got, const char *want)
{
    if (got == NULL || strcmp(got, want) != 0) {
        fprintf(stderr, "FAIL: %s\n  got:  %s\n  want: %s\n",
                label, got ? got : "(null)", want);
        failures++;
    }
    free(got);
}

static void check_null(const char *label, char *got)
{
    if (got != NULL) {
        fprintf(stderr, "FAIL: %s -> expected NULL, got '%s'\n", label, got);
        failures++;
        free(got);
    }
}

int main(void)
{
    /* INSERT with a NULL value and a value needing quote-escaping. */
    {
        const char *cols[] = { "id", "name", "note" };
        const char *vals[] = { "1", "O'Hara", NULL };
        dbc_dml_row row = { NULL, "users", 3, cols, vals, 0, NULL, NULL, NULL };
        check("insert",
              sqlite_build_dml_sql(DBC_DML_INSERT, &row),
              "INSERT INTO \"users\" (\"id\", \"name\", \"note\") "
              "VALUES ('1', 'O''Hara', NULL)");
    }

    /* UPDATE: SET assignments + a WHERE keyed on the primary key. */
    {
        const char *scols[] = { "name" };
        const char *svals[] = { "Ana" };
        const char *wcols[] = { "id" };
        const char *wvals[] = { "42" };
        dbc_dml_row row = { NULL, "users", 1, scols, svals, 1, wcols, wvals, NULL };
        check("update",
              sqlite_build_dml_sql(DBC_DML_UPDATE, &row),
              "UPDATE \"users\" SET \"name\" = 'Ana' WHERE \"id\" = '42'");
    }

    /* UPDATE with a schema qualifier and a composite key, one key part NULL. */
    {
        const char *scols[] = { "v" };
        const char *svals[] = { "x" };
        const char *wcols[] = { "a", "b" };
        const char *wvals[] = { "1", NULL };
        dbc_dml_row row = { "main", "t", 1, scols, svals, 2, wcols, wvals, NULL };
        check("update composite key with NULL",
              sqlite_build_dml_sql(DBC_DML_UPDATE, &row),
              "UPDATE \"main\".\"t\" SET \"v\" = 'x' "
              "WHERE \"a\" = '1' AND \"b\" IS NULL");
    }

    /* DELETE keyed on the primary key. */
    {
        const char *wcols[] = { "id" };
        const char *wvals[] = { "7" };
        dbc_dml_row row = { NULL, "users", 0, NULL, NULL, 1, wcols, wvals, NULL };
        check("delete",
              sqlite_build_dml_sql(DBC_DML_DELETE, &row),
              "DELETE FROM \"users\" WHERE \"id\" = '7'");
    }

    /* An identifier with an embedded double quote is escaped by doubling. */
    {
        const char *cols[] = { "we\"ird" };
        const char *vals[] = { "1" };
        dbc_dml_row row = { NULL, "t", 1, cols, vals, 0, NULL, NULL, NULL };
        check("quoted identifier",
              sqlite_build_dml_sql(DBC_DML_INSERT, &row),
              "INSERT INTO \"t\" (\"we\"\"ird\") VALUES ('1')");
    }

    /* Typed values: int/float columns emit UNQUOTED (so a BIT/bool stored as int
       sends 0/1, not '0'); text and non-numeric values stay quoted. */
    {
        const char *cols[] = { "id", "flag", "amount", "note" };
        const char *vals[] = { "5", "0", "3.14", "007" };
        dbc_type types[] = { DBC_TYPE_INT, DBC_TYPE_INT, DBC_TYPE_FLOAT, DBC_TYPE_TEXT };
        dbc_dml_row row = { NULL, "t", 4, cols, vals, 0, NULL, NULL, types };
        check("typed insert (numeric unquoted, text quoted)",
              sqlite_build_dml_sql(DBC_DML_INSERT, &row),
              "INSERT INTO \"t\" (\"id\", \"flag\", \"amount\", \"note\") "
              "VALUES (5, 0, 3.14, '007')");
    }
    {
        /* A non-numeric value in a numeric column stays quoted (no injection). */
        const char *scols[] = { "n" };
        const char *svals[] = { "1; DROP" };
        const char *wcols[] = { "id" };
        const char *wvals[] = { "1" };
        dbc_type types[] = { DBC_TYPE_INT };
        dbc_dml_row row = { NULL, "t", 1, scols, svals, 1, wcols, wvals, types };
        check("typed update (non-numeric value quoted)",
              sqlite_build_dml_sql(DBC_DML_UPDATE, &row),
              "UPDATE \"t\" SET \"n\" = '1; DROP' WHERE \"id\" = '1'");
    }

    /* --- refusals: never emit a statement that touches every row / sets nothing --- */
    {
        const char *wcols[] = { "id" };
        const char *wvals[] = { "1" };
        dbc_dml_row no_table = { NULL, NULL, 1, wcols, wvals, 1, wcols, wvals, NULL };
        check_null("no table", sqlite_build_dml_sql(DBC_DML_UPDATE, &no_table));

        dbc_dml_row update_no_where = { NULL, "t", 1, wcols, wvals, 0, NULL, NULL, NULL };
        check_null("update without where",
                   sqlite_build_dml_sql(DBC_DML_UPDATE, &update_no_where));

        dbc_dml_row delete_no_where = { NULL, "t", 0, NULL, NULL, 0, NULL, NULL, NULL };
        check_null("delete without where",
                   sqlite_build_dml_sql(DBC_DML_DELETE, &delete_no_where));

        dbc_dml_row insert_no_cols = { NULL, "t", 0, NULL, NULL, 0, NULL, NULL, NULL };
        check_null("insert without columns",
                   sqlite_build_dml_sql(DBC_DML_INSERT, &insert_no_cols));

        check_null("null row", sqlite_build_dml_sql(DBC_DML_INSERT, NULL));
    }

    if (failures == 0) {
        printf("OK: sqlite single-row DML builder (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
