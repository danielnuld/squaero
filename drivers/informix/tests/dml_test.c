#include "dml.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Unit tests for the pure Informix single-row DML builder: bare identifiers,
   `database:table` qualifier, single-quoted literals with '' escaping. */

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
    /* INSERT with a NULL and a value needing '' escaping; bare identifiers. */
    {
        const char *cols[] = { "id", "name", "note" };
        const char *vals[] = { "1", "O'Hara", NULL };
        dbc_dml_row row = { NULL, "users", 3, cols, vals, 0, NULL, NULL, NULL };
        check("insert",
              informix_build_dml_sql(DBC_DML_INSERT, &row),
              "INSERT INTO users (id, name, note) VALUES ('1', 'O''Hara', NULL)");
    }

    /* UPDATE keyed on the primary key. */
    {
        const char *scols[] = { "name" };
        const char *svals[] = { "Ana" };
        const char *wcols[] = { "id" };
        const char *wvals[] = { "42" };
        dbc_dml_row row = { NULL, "users", 1, scols, svals, 1, wcols, wvals, NULL };
        check("update",
              informix_build_dml_sql(DBC_DML_UPDATE, &row),
              "UPDATE users SET name = 'Ana' WHERE id = '42'");
    }

    /* A database qualifier is applied as `db:table`; composite key with NULL. */
    {
        const char *scols[] = { "v" };
        const char *svals[] = { "x" };
        const char *wcols[] = { "a", "b" };
        const char *wvals[] = { "1", NULL };
        dbc_dml_row row = { "stores", "t", 1, scols, svals, 2, wcols, wvals, NULL };
        check("update with db qualifier + NULL key",
              informix_build_dml_sql(DBC_DML_UPDATE, &row),
              "UPDATE stores:t SET v = 'x' WHERE a = '1' AND b IS NULL");
    }

    /* A cell cleared to SQL NULL, next to one cleared to the empty string
       (issue #398): the grid can now write either and they are different values.
       The NULL is the bare keyword even in a numeric column, where the empty
       string is not a bare numeric and stays quoted. */
    {
        const char *scols[] = { "note", "qty", "name" };
        const char *svals[] = { NULL, NULL, "" };
        const char *wcols[] = { "id" };
        const char *wvals[] = { "7" };
        dbc_type types[] = { DBC_TYPE_TEXT, DBC_TYPE_INT, DBC_TYPE_TEXT };
        dbc_dml_row row = { NULL, "users", 3, scols, svals, 1, wcols, wvals, types };
        check("update setting NULL, empty string kept distinct",
              informix_build_dml_sql(DBC_DML_UPDATE, &row),
              "UPDATE users SET note = NULL, qty = NULL, name = '' "
              "WHERE id = '7'");
    }

    /* DELETE keyed on the primary key. */
    {
        const char *wcols[] = { "id" };
        const char *wvals[] = { "7" };
        dbc_dml_row row = { NULL, "users", 0, NULL, NULL, 1, wcols, wvals, NULL };
        check("delete",
              informix_build_dml_sql(DBC_DML_DELETE, &row),
              "DELETE FROM users WHERE id = '7'");
    }

    /* Typed values: int/float columns emit UNQUOTED; text and non-numeric values
       stay quoted; bool stays quoted (Informix BOOLEAN wants a t/f literal). */
    {
        const char *cols[] = { "id", "amount", "note" };
        const char *vals[] = { "5", "3.14", "007" };
        dbc_type types[] = { DBC_TYPE_INT, DBC_TYPE_FLOAT, DBC_TYPE_TEXT };
        dbc_dml_row row = { NULL, "t", 3, cols, vals, 0, NULL, NULL, types };
        check("typed insert (numeric unquoted, text quoted)",
              informix_build_dml_sql(DBC_DML_INSERT, &row),
              "INSERT INTO t (id, amount, note) VALUES (5, 3.14, '007')");
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
              informix_build_dml_sql(DBC_DML_UPDATE, &row),
              "UPDATE t SET n = '1; DROP' WHERE id = '1'");
    }

    /* Refusals: never touch every row / set nothing. */
    {
        const char *wcols[] = { "id" };
        const char *wvals[] = { "1" };
        dbc_dml_row update_no_where = { NULL, "t", 1, wcols, wvals, 0, NULL, NULL, NULL };
        check_null("update without where",
                   informix_build_dml_sql(DBC_DML_UPDATE, &update_no_where));

        dbc_dml_row delete_no_where = { NULL, "t", 0, NULL, NULL, 0, NULL, NULL, NULL };
        check_null("delete without where",
                   informix_build_dml_sql(DBC_DML_DELETE, &delete_no_where));

        dbc_dml_row insert_no_cols = { NULL, "t", 0, NULL, NULL, 0, NULL, NULL, NULL };
        check_null("insert without columns",
                   informix_build_dml_sql(DBC_DML_INSERT, &insert_no_cols));

        check_null("null row", informix_build_dml_sql(DBC_DML_INSERT, NULL));
    }

    /* DATETIME text fitted to the column's qualifier (issue #599). collength =
       digits*256 + largest*16 + smallest (YEAR 0 ... SECOND 10, FRACTION(n) 10+n). */
    {
        static const struct {
            const char *val;
            int collength;
            const char *want; /* NULL: left as it is */
        } cases[] = {
            {"2026-09-23 10:00:00.000000", 14 * 256 + 0 + 10, "2026-09-23 10:00:00"},     /* YEAR TO SECOND */
            {"2026-09-23 10:00:00.000000", 12 * 256 + 0 + 8, "2026-09-23 10:00"},         /* YEAR TO MINUTE */
            {"2026-09-23 10:00:00.123000", 17 * 256 + 0 + 13, "2026-09-23 10:00:00.123"}, /* FRACTION(3) */
            {"2026-09-23 10:00:00", 19 * 256 + 0 + 15, "2026-09-23 10:00:00.00000"},      /* FRACTION(5) */
            {"2026-09-23 00:00:00.000000", 8 * 256 + 0 + 4, "2026-09-23"},                /* YEAR TO DAY */
            {"2026-09-23 00:00:00.000000", 4 * 256 + 2 * 16 + 4, "09-23"},                /* MONTH TO DAY */
            {"10:30:15", 6 * 256 + 6 * 16 + 10, "10:30:15"},                              /* HOUR TO SECOND */
            {"10:30:00", 4 * 256 + 6 * 16 + 8, "10:30"},                                  /* HOUR TO MINUTE */
            {"2026-09-23 10:00", 14 * 256 + 0 + 10, NULL},  /* lacks the seconds: as typed */
            {"10:30:15", 14 * 256 + 0 + 10, NULL},          /* no date for YEAR TO SECOND */
            {"mañana", 14 * 256 + 0 + 10, NULL},            /* not a datetime */
            {"2026-09-23 10:00:00x", 14 * 256 + 0 + 10, NULL},
        };
        for (size_t i = 0; i < sizeof cases / sizeof cases[0]; i++) {
            char out[40] = "untouched";
            int fitted = informix_fit_datetime(cases[i].val, cases[i].collength, out, sizeof out);
            if (cases[i].want == NULL ? fitted : (!fitted || strcmp(out, cases[i].want) != 0)) {
                fprintf(stderr, "FAIL: fit '%s' (%d)\n  got:  %s (%d)\n  want: %s\n", cases[i].val,
                        cases[i].collength, out, fitted, cases[i].want ? cases[i].want : "(as typed)");
                failures++;
            }
        }
        char tiny[8];
        if (informix_fit_datetime("2026-09-23 10:00:00.000000", 14 * 256 + 10, tiny, sizeof tiny)) {
            fprintf(stderr, "FAIL: fit into a buffer too small\n");
            failures++;
        }
    }

    if (failures == 0) {
        printf("OK: informix single-row DML builder (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
