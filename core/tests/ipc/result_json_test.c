#include "result_json.h"     /* serializer under test (internal IPC header) */
#include "result_priv.h"     /* internal builder, to construct a known result */

#include "cJSON.h"

#include <stdio.h>
#include <string.h>

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

static void test_type_names(void)
{
    EXPECT(strcmp(ipc_type_name(DBC_TYPE_INT), "int") == 0, "int name");
    EXPECT(strcmp(ipc_type_name(DBC_TYPE_FLOAT), "float") == 0, "float name");
    EXPECT(strcmp(ipc_type_name(DBC_TYPE_BOOL), "bool") == 0, "bool name");
    EXPECT(strcmp(ipc_type_name(DBC_TYPE_TEXT), "text") == 0, "text name");
    EXPECT(strcmp(ipc_type_name(DBC_TYPE_BLOB), "blob") == 0, "blob name");
    EXPECT(strcmp(ipc_type_name(DBC_TYPE_DATE), "date") == 0, "date name");
    EXPECT(strcmp(ipc_type_name(DBC_TYPE_TIME), "time") == 0, "time name");
    EXPECT(strcmp(ipc_type_name(DBC_TYPE_TIMESTAMP), "timestamp") == 0, "timestamp name");
    EXPECT(strcmp(ipc_type_name(DBC_TYPE_JSON), "json") == 0, "json name");
    EXPECT(strcmp(ipc_type_name(DBC_TYPE_NULL), "null") == 0, "null name");
    EXPECT(strcmp(ipc_type_name((dbc_type)999), "null") == 0, "unknown type -> null");
}

int main(void)
{
    test_type_names();

    /* Build a result: two typed columns, three rows with a SQL NULL, a UTF-8
       value, and characters that require JSON escaping. */
    dbcore_result *r = dbcore_result_create(2);
    EXPECT(r != NULL, "result allocates");
    dbcore_result_set_column(r, 0, "id", DBC_TYPE_INT);
    dbcore_result_set_column(r, 1, "name", DBC_TYPE_TEXT);
    const char *row0[] = { "1", "caf\xc3\xa9" };        /* "café" in UTF-8 */
    const char *row1[] = { "2", NULL };                 /* SQL NULL */
    const char *row2[] = { "3", "a\"b\\c\nd" };         /* needs escaping */
    dbcore_result_add_row(r, row0);
    dbcore_result_add_row(r, row1);
    dbcore_result_add_row(r, row2);
    dbcore_result_set_rows_affected(r, 0);

    cJSON *json = ipc_result_to_json(r);
    EXPECT(json != NULL, "serialization succeeds");

    /* columns[] */
    cJSON *columns = cJSON_GetObjectItemCaseSensitive(json, "columns");
    EXPECT(cJSON_GetArraySize(columns) == 2, "two columns");
    cJSON *c0 = cJSON_GetArrayItem(columns, 0);
    EXPECT(strcmp(cJSON_GetObjectItem(c0, "name")->valuestring, "id") == 0, "col0 name");
    EXPECT(strcmp(cJSON_GetObjectItem(c0, "type")->valuestring, "int") == 0, "col0 type");
    cJSON *c1 = cJSON_GetArrayItem(columns, 1);
    EXPECT(strcmp(cJSON_GetObjectItem(c1, "type")->valuestring, "text") == 0, "col1 type");

    /* rows[] */
    cJSON *rows = cJSON_GetObjectItemCaseSensitive(json, "rows");
    EXPECT(cJSON_GetArraySize(rows) == 3, "three rows");
    cJSON *r0 = cJSON_GetArrayItem(rows, 0);
    EXPECT(strcmp(cJSON_GetArrayItem(r0, 1)->valuestring, "caf\xc3\xa9") == 0,
           "UTF-8 value preserved in the model");
    cJSON *r1 = cJSON_GetArrayItem(rows, 1);
    EXPECT(cJSON_IsNull(cJSON_GetArrayItem(r1, 1)), "SQL NULL serialized as JSON null");
    EXPECT(cJSON_IsString(cJSON_GetArrayItem(r1, 0)), "non-null sibling stays a string");

    /* meta */
    EXPECT(cJSON_IsFalse(cJSON_GetObjectItem(json, "truncated")), "truncated false");
    EXPECT(cJSON_GetObjectItem(json, "rowsAffected")->valueint == 0, "rowsAffected 0");

    /* Escaping + UTF-8 survive a print -> parse round trip losslessly. */
    char *text = cJSON_PrintUnformatted(json);
    EXPECT(text != NULL, "prints to text");
    EXPECT(strstr(text, "caf\xc3\xa9") != NULL, "UTF-8 bytes emitted (not \\u escapes)");
    EXPECT(strstr(text, "a\\\"b\\\\c\\nd") != NULL, "quote/backslash/newline escaped");
    cJSON *reparsed = cJSON_Parse(text);
    cJSON *rr2 = cJSON_GetArrayItem(cJSON_GetObjectItem(reparsed, "rows"), 2);
    EXPECT(strcmp(cJSON_GetArrayItem(rr2, 1)->valuestring, "a\"b\\c\nd") == 0,
           "escaped value round-trips exactly");

    cJSON_free(text);
    cJSON_Delete(reparsed);
    cJSON_Delete(json);

    /* truncated flag is serialized when set. */
    dbcore_result_set_truncated(r, 1);
    cJSON *json_t = ipc_result_to_json(r);
    EXPECT(cJSON_IsTrue(cJSON_GetObjectItem(json_t, "truncated")),
           "truncated true is serialized");
    cJSON_Delete(json_t);

    dbcore_result_free(r);

    if (failures == 0) {
        printf("OK: result JSON serialization (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
