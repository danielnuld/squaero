#include "dsn_rewrite.h"

#include "cJSON.h"

char *dsn_rewrite_loopback(const char *dsn_json, int local_port)
{
    if (dsn_json == NULL || local_port < 1 || local_port > 65535) {
        return NULL;
    }

    cJSON *root = cJSON_Parse(dsn_json);
    if (!cJSON_IsObject(root)) {
        cJSON_Delete(root);
        return NULL;
    }

    /* Point the driver at the local end of the forward. AddXToObject appends a
       duplicate rather than replacing, so delete any existing keys first. A
       Unix-socket path would bypass the TCP forward entirely; drop it too. */
    cJSON_DeleteItemFromObjectCaseSensitive(root, "host");
    cJSON_DeleteItemFromObjectCaseSensitive(root, "port");
    cJSON_DeleteItemFromObjectCaseSensitive(root, "socket");
    if (cJSON_AddStringToObject(root, "host", "127.0.0.1") == NULL ||
        cJSON_AddNumberToObject(root, "port", local_port) == NULL) {
        cJSON_Delete(root);
        return NULL;
    }

    char *out = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return out;
}
