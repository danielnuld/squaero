#include "materialize.h"

#include "result_priv.h"

#include <stdlib.h>
#include <string.h>

void dbcore_copy_error(char *errbuf, size_t errcap, const char *msg)
{
    if (errbuf == NULL || errcap == 0) {
        return;
    }
    if (msg == NULL) {
        msg = "unknown error";
    }
    size_t n = strlen(msg);
    if (n >= errcap) {
        n = errcap - 1;
    }
    memcpy(errbuf, msg, n);
    errbuf[n] = '\0';
}

/* The shared body. `keep_open` leaves `dr` alive on success so a further page
   can continue the same execution (issue #478); it is still freed on every
   failure path, so a caller holding a cursor must drop it when this fails. */
static dbc_status materialize(const dbc_driver_t *drv, dbc_conn *handle,
                              dbc_result *dr, int max_rows, int offset,
                              int keep_open, dbcore_result **out, char *errbuf,
                              size_t errcap)
{
    *out = NULL;

    int col_count = drv->col_count(dr);
    if (col_count < 0) {
        col_count = 0;
    }

    dbcore_result *res = dbcore_result_create(col_count);
    if (res == NULL) {
        drv->free_result(dr);
        dbcore_copy_error(errbuf, errcap, "out of memory");
        return DBC_ERR_NOMEM;
    }

    for (int c = 0; c < col_count; c++) {
        if (!dbcore_result_set_column(res, c, drv->col_name(dr, c),
                                      drv->col_type(dr, c))) {
            dbcore_result_free(res);
            drv->free_result(dr);
            dbcore_copy_error(errbuf, errcap, "out of memory");
            return DBC_ERR_NOMEM;
        }
    }
    dbcore_result_set_rows_affected(res, drv->rows_affected(dr));

    /* Only result-set statements have rows to iterate. */
    int rc = 0;
    if (col_count > 0) {
        const char **rowbuf = malloc((size_t)col_count * sizeof *rowbuf);
        if (rowbuf == NULL) {
            dbcore_result_free(res);
            drv->free_result(dr);
            dbcore_copy_error(errbuf, errcap, "out of memory");
            return DBC_ERR_NOMEM;
        }
        /* Skip `offset` leading rows (offset pagination, #134), then fetch up to
           max_rows rows and peek one more: if next_row still yields a row past
           the cap we report truncation accurately (the classic limit+1
           technique — here it means "a further page exists"). The peeked row is
           intentionally discarded — that one extra fetch is the cost of an
           honest flag. */
        int skipped = 0;
        while (1) {
            /* A cursor that is kept open must not consume the peeked row: the
               next page starts where this one stopped. So the cap is checked
               BEFORE fetching, and "a further page exists" is inferred from a
               full page (the same full-page heuristic the preview grid uses —
               its only cost is one empty last page on an exact multiple). */
            if (keep_open && max_rows > 0 &&
                dbcore_result_row_count(res) >= max_rows) {
                dbcore_result_set_truncated(res, 1);
                break;
            }
            if ((rc = drv->next_row(dr)) != 1) {
                break;
            }
            if (offset > 0 && skipped < offset) {
                skipped++;
                continue;
            }
            if (max_rows > 0 && dbcore_result_row_count(res) >= max_rows) {
                dbcore_result_set_truncated(res, 1);
                break;
            }
            for (int c = 0; c < col_count; c++) {
                rowbuf[c] = drv->cell_text(dr, c);
            }
            if (!dbcore_result_add_row(res, rowbuf)) {
                free(rowbuf);
                dbcore_result_free(res);
                drv->free_result(dr);
                dbcore_copy_error(errbuf, errcap, "out of memory");
                return DBC_ERR_NOMEM;
            }
        }
        free(rowbuf);
    }

    if (rc < 0) {
        dbcore_copy_error(errbuf, errcap, drv->last_error(handle));
        dbcore_result_free(res);
        drv->free_result(dr);
        return DBC_ERR_QUERY;
    }

    if (!keep_open || !dbcore_result_truncated(res)) {
        drv->free_result(dr);
    }
    *out = res;
    return DBC_OK;
}

dbc_status dbcore_materialize(const dbc_driver_t *drv, dbc_conn *handle,
                              dbc_result *dr, int max_rows, int offset,
                              dbcore_result **out, char *errbuf, size_t errcap)
{
    return materialize(drv, handle, dr, max_rows, offset, 0, out, errbuf, errcap);
}

dbc_status dbcore_materialize_page(const dbc_driver_t *drv, dbc_conn *handle,
                                   dbc_result *dr, int max_rows,
                                   dbcore_result **out, char *errbuf,
                                   size_t errcap)
{
    return materialize(drv, handle, dr, max_rows, 0, 1, out, errbuf, errcap);
}
