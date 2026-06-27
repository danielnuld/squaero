#include "result_json.h"

const char *ipc_type_name(dbc_type type)
{
    switch (type) {
    case DBC_TYPE_INT:       return "int";
    case DBC_TYPE_FLOAT:     return "float";
    case DBC_TYPE_BOOL:      return "bool";
    case DBC_TYPE_TEXT:      return "text";
    case DBC_TYPE_BLOB:      return "blob";
    case DBC_TYPE_DATE:      return "date";
    case DBC_TYPE_TIME:      return "time";
    case DBC_TYPE_TIMESTAMP: return "timestamp";
    case DBC_TYPE_JSON:      return "json";
    case DBC_TYPE_NULL:      return "null";
    }
    return "null";
}

static cJSON *build_columns(const dbcore_result *r)
{
    cJSON *columns = cJSON_CreateArray();
    if (columns == NULL) {
        return NULL;
    }
    int n = dbcore_result_col_count(r);
    for (int c = 0; c < n; c++) {
        cJSON *col = cJSON_CreateObject();
        if (col == NULL || !cJSON_AddItemToArray(columns, col)) {
            cJSON_Delete(col);
            cJSON_Delete(columns);
            return NULL;
        }
        const char *name = dbcore_result_col_name(r, c);
        if (cJSON_AddStringToObject(col, "name", name != NULL ? name : "") == NULL ||
            cJSON_AddStringToObject(col, "type",
                                    ipc_type_name(dbcore_result_col_type(r, c))) == NULL) {
            cJSON_Delete(columns);
            return NULL;
        }
    }
    return columns;
}

static cJSON *build_rows(const dbcore_result *r)
{
    cJSON *rows = cJSON_CreateArray();
    if (rows == NULL) {
        return NULL;
    }
    int nrows = dbcore_result_row_count(r);
    int ncols = dbcore_result_col_count(r);
    for (int row = 0; row < nrows; row++) {
        cJSON *cells = cJSON_CreateArray();
        if (cells == NULL || !cJSON_AddItemToArray(rows, cells)) {
            cJSON_Delete(cells);
            cJSON_Delete(rows);
            return NULL;
        }
        for (int col = 0; col < ncols; col++) {
            /* SQL NULL -> JSON null; otherwise the text value as a JSON string
               (cJSON escapes and emits valid UTF-8). */
            cJSON *value;
            if (dbcore_result_cell_is_null(r, row, col)) {
                value = cJSON_CreateNull();
            } else {
                value = cJSON_CreateString(dbcore_result_cell(r, row, col));
            }
            if (value == NULL || !cJSON_AddItemToArray(cells, value)) {
                cJSON_Delete(value);
                cJSON_Delete(rows);
                return NULL;
            }
        }
    }
    return rows;
}

cJSON *ipc_result_to_json(const dbcore_result *r)
{
    cJSON *obj = cJSON_CreateObject();
    if (obj == NULL) {
        return NULL;
    }

    cJSON *columns = build_columns(r);
    if (columns == NULL || !cJSON_AddItemToObject(obj, "columns", columns)) {
        cJSON_Delete(columns);
        cJSON_Delete(obj);
        return NULL;
    }

    cJSON *rows = build_rows(r);
    if (rows == NULL || !cJSON_AddItemToObject(obj, "rows", rows)) {
        cJSON_Delete(rows);
        cJSON_Delete(obj);
        return NULL;
    }

    if (cJSON_AddBoolToObject(obj, "truncated",
                              dbcore_result_truncated(r)) == NULL) {
        cJSON_Delete(obj);
        return NULL;
    }
    /* cJSON stores every number as double, so rows_affected loses precision
       beyond 2^53. That ceiling is astronomically above any real row count;
       if a 64-bit-exact count is ever needed, emit it as a string field. */
    if (cJSON_AddNumberToObject(obj, "rowsAffected",
                                (double)dbcore_result_rows_affected(r)) == NULL) {
        cJSON_Delete(obj);
        return NULL;
    }
    return obj;
}
