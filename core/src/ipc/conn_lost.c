#include "conn_lost.h"

#include "dbcore/stmt_class.h"

#include <string.h>

static int retry_safe(const char *method, const cJSON *params, int in_tx)
{
    if (in_tx || method == NULL || strcmp(method, "query.run") != 0) {
        return 0;
    }
    const cJSON *sql = cJSON_GetObjectItemCaseSensitive(params, "sql");
    return cJSON_IsString(sql) && stmt_classify(sql->valuestring) == STMT_READ;
}

cJSON *ipc_conn_lost_data(const char *method, const cJSON *params, int in_tx)
{
    cJSON *data = cJSON_CreateObject();
    if (data == NULL ||
        cJSON_AddTrueToObject(data, "connLost") == NULL ||
        cJSON_AddBoolToObject(data, "inTx", in_tx != 0) == NULL ||
        cJSON_AddBoolToObject(data, "retrySafe", retry_safe(method, params, in_tx)) == NULL) {
        cJSON_Delete(data);
        return NULL;
    }
    return data;
}
