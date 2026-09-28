#include "dml.h"

#include <stdlib.h>
#include <string.h>

/* A small growable output buffer; `oom` latches an allocation failure so the
   caller can bail once at the end instead of checking every append. */
typedef struct {
    char  *data;
    size_t len;
    size_t cap;
    int    oom;
} sbuf;

static void sb_putc(sbuf *b, char ch)
{
    if (b->oom) {
        return;
    }
    if (b->len + 1 >= b->cap) {
        size_t cap = b->cap == 0 ? 64 : b->cap * 2;
        char *grown = realloc(b->data, cap);
        if (grown == NULL) {
            b->oom = 1;
            return;
        }
        b->data = grown;
        b->cap = cap;
    }
    b->data[b->len++] = ch;
}

static void sb_puts(sbuf *b, const char *s)
{
    for (; *s != '\0'; s++) {
        sb_putc(b, *s);
    }
}

/* Append `name` as a bare (unquoted) identifier — see the header for why. */
static void sb_ident(sbuf *b, const char *name)
{
    sb_puts(b, name);
}

/* Append `val` as a SQL literal: NULL keyword for NULL, else a single-quoted
   string with embedded single quotes doubled. */
static void sb_literal(sbuf *b, const char *val)
{
    if (val == NULL) {
        sb_puts(b, "NULL");
        return;
    }
    sb_putc(b, '\'');
    for (const char *p = val; *p != '\0'; p++) {
        if (*p == '\'') {
            sb_putc(b, '\'');
        }
        sb_putc(b, *p);
    }
    sb_putc(b, '\'');
}

/* True when a value of neutral type `type` is a bare numeric literal safe to emit
   UNQUOTED (int/float only; the value is a plain optionally-signed decimal, so an
   unquoted value can never carry a quote/semicolon — no injection risk). Anything
   else is quoted. `bool` is excluded (Informix BOOLEAN wants a t/f literal). */
static int dml_is_bare_numeric(dbc_type type, const char *val)
{
    if (val == NULL || val[0] == '\0') {
        return 0;
    }
    if (type != DBC_TYPE_INT && type != DBC_TYPE_FLOAT) {
        return 0;
    }
    const char *p = val;
    if (*p == '+' || *p == '-') {
        p++;
    }
    int digits = 0, dot = 0;
    for (; *p != '\0'; p++) {
        if (*p >= '0' && *p <= '9') {
            digits = 1;
        } else if (*p == '.' && !dot && type == DBC_TYPE_FLOAT) {
            dot = 1;
        } else {
            return 0;
        }
    }
    return digits;
}

/* Append a set value: NULL, a bare numeric literal for a numeric column, or an
   escaped string literal otherwise. */
static void sb_value(sbuf *b, const char *val, dbc_type type)
{
    if (val != NULL && dml_is_bare_numeric(type, val)) {
        sb_puts(b, val);
        return;
    }
    sb_literal(b, val);
}

/* Append `[database:]table` (the database is Informix's `db:` qualifier). */
static void sb_qualified(sbuf *b, const dbc_dml_row *row)
{
    if (row->schema != NULL && row->schema[0] != '\0') {
        sb_ident(b, row->schema);
        sb_putc(b, ':');
    }
    sb_ident(b, row->table);
}

static void sb_where(sbuf *b, const dbc_dml_row *row)
{
    for (int i = 0; i < row->n_where; i++) {
        if (i > 0) {
            sb_puts(b, " AND ");
        }
        sb_ident(b, row->where_cols[i]);
        if (row->where_vals[i] == NULL) {
            sb_puts(b, " IS NULL");
        } else {
            sb_puts(b, " = ");
            sb_literal(b, row->where_vals[i]);
        }
    }
}

char *informix_build_dml_sql(dbc_dml_kind kind, const dbc_dml_row *row)
{
    if (row == NULL || row->table == NULL || row->table[0] == '\0') {
        return NULL;
    }
    if (kind == DBC_DML_INSERT && row->n_set <= 0) {
        return NULL;
    }
    if (kind == DBC_DML_UPDATE && (row->n_set <= 0 || row->n_where <= 0)) {
        return NULL;
    }
    if (kind == DBC_DML_DELETE && row->n_where <= 0) {
        return NULL;
    }

    sbuf b = {0};

    switch (kind) {
    case DBC_DML_INSERT:
        sb_puts(&b, "INSERT INTO ");
        sb_qualified(&b, row);
        sb_puts(&b, " (");
        for (int i = 0; i < row->n_set; i++) {
            if (i > 0) {
                sb_puts(&b, ", ");
            }
            sb_ident(&b, row->set_cols[i]);
        }
        sb_puts(&b, ") VALUES (");
        for (int i = 0; i < row->n_set; i++) {
            if (i > 0) {
                sb_puts(&b, ", ");
            }
            sb_value(&b, row->set_vals[i],
                     row->set_types != NULL ? row->set_types[i] : DBC_TYPE_TEXT);
        }
        sb_putc(&b, ')');
        break;

    case DBC_DML_UPDATE:
        sb_puts(&b, "UPDATE ");
        sb_qualified(&b, row);
        sb_puts(&b, " SET ");
        for (int i = 0; i < row->n_set; i++) {
            if (i > 0) {
                sb_puts(&b, ", ");
            }
            sb_ident(&b, row->set_cols[i]);
            sb_puts(&b, " = ");
            sb_value(&b, row->set_vals[i],
                     row->set_types != NULL ? row->set_types[i] : DBC_TYPE_TEXT);
        }
        sb_puts(&b, " WHERE ");
        sb_where(&b, row);
        break;

    case DBC_DML_DELETE:
        sb_puts(&b, "DELETE FROM ");
        sb_qualified(&b, row);
        sb_puts(&b, " WHERE ");
        sb_where(&b, row);
        break;

    default:
        free(b.data);
        return NULL;
    }

    sb_putc(&b, '\0');
    if (b.oom) {
        free(b.data);
        return NULL;
    }
    return b.data;
}

/* ---- DATETIME literals (issue #599) ------------------------------------ */

/* n digits at p into f (NUL-terminated); 1 on success. */
static int take_digits(const char **p, int n, char *f)
{
    for (int i = 0; i < n; i++) {
        if ((*p)[i] < '0' || (*p)[i] > '9') {
            return 0;
        }
        f[i] = (*p)[i];
    }
    f[n] = '\0';
    *p += n;
    return 1;
}

int informix_fit_datetime(const char *val, int collength, char *out, size_t cap)
{
    /* Fields by index: 0 year, 1 month, 2 day, 3 hour, 4 minute, 5 second,
       6 fraction. */
    char f[7][8] = {{0}};
    int first, last;
    const char *p = val;
    if (val == NULL || out == NULL) {
        return 0;
    }
    if (take_digits(&p, 4, f[0]) && *p == '-') {
        p++;
        if (!take_digits(&p, 2, f[1]) || *p++ != '-' || !take_digits(&p, 2, f[2])) {
            return 0;
        }
        first = 0;
        last = 2;
        if (*p == ' ') {
            p++;
            if (!take_digits(&p, 2, f[3])) {
                return 0;
            }
            last = 3;
        }
    } else {
        p = val;
        if (!take_digits(&p, 2, f[3])) {
            return 0;
        }
        first = last = 3;
    }
    if (last == 3) {
        if (*p++ != ':' || !take_digits(&p, 2, f[4]) || *p++ != ':' || !take_digits(&p, 2, f[5])) {
            return 0;
        }
        last = 5;
        if (*p == '.') {
            int n = 0;
            p++;
            while (p[n] >= '0' && p[n] <= '9' && n < 7) {
                f[6][n] = p[n];
                n++;
            }
            if (n == 0) {
                return 0;
            }
            f[6][n] = '\0';
            p += n;
            last = 6;
        }
    }
    if (*p != '\0') {
        return 0;
    }

    int largest = (collength % 256) / 16, smallest = collength % 16;
    static const int k_index[16] = {0, -1, 1, -1, 2, -1, 3, -1, 4, -1, 5, 6, 6, 6, 6, 6};
    int from = largest <= 15 ? k_index[largest] : -1;
    int to = smallest <= 15 ? k_index[smallest] : -1;
    int scale = smallest >= 11 ? smallest - 10 : 0;
    if (from < 0 || to < 0 || from > to || from < first || (to == 6 ? 5 : to) > last) {
        return 0; /* not a qualifier we know, or the value lacks its fields */
    }

    static const char k_sep[7] = {0, '-', '-', ' ', ':', ':', '.'};
    size_t len = 0;
    for (int i = from; i <= to; i++) {
        char field[8];
        if (i == 6) {
            /* FRACTION(scale): the value's digits, cut or padded with zeros. */
            size_t have = strlen(f[6]);
            for (int k = 0; k < scale; k++) {
                field[k] = (size_t)k < have ? f[6][k] : '0';
            }
            field[scale] = '\0';
        } else {
            memcpy(field, f[i], sizeof field);
        }
        size_t need = strlen(field) + (i > from ? 1 : 0);
        if (len + need + 1 > cap) {
            return 0;
        }
        if (i > from) {
            out[len++] = k_sep[i];
        }
        memcpy(out + len, field, strlen(field));
        len += strlen(field);
    }
    out[len] = '\0';
    return 1;
}
