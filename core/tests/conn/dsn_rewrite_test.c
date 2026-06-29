#include "dsn_rewrite.h"

#include "cJSON.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;
#define EXPECT(cond, msg)                                  \
    do {                                                   \
        if (!(cond)) {                                     \
            fprintf(stderr, "FAIL: %s\n", (msg));          \
            failures++;                                    \
        }                                                  \
    } while (0)

/* Convenience: string value of a top-level key, or NULL. */
static const char *str_of(const cJSON *root, const char *key)
{
    const cJSON *it = cJSON_GetObjectItemCaseSensitive(root, key);
    return cJSON_IsString(it) ? it->valuestring : NULL;
}

int main(void)
{
    /* --- nominal: host/port rewritten, other fields preserved --- */
    {
        const char *dsn =
            "{\"host\":\"db.internal\",\"port\":3306,\"user\":\"root\","
            "\"password\":\"s3cret\",\"database\":\"app\"}";
        char *out = dsn_rewrite_loopback(dsn, 54321);
        EXPECT(out != NULL, "rewrite returns a string");
        cJSON *root = cJSON_Parse(out);
        EXPECT(root != NULL, "result is valid json");
        EXPECT(str_of(root, "host") && strcmp(str_of(root, "host"), "127.0.0.1") == 0,
               "host rewritten to loopback");
        cJSON *port = cJSON_GetObjectItemCaseSensitive(root, "port");
        EXPECT(cJSON_IsNumber(port) && port->valueint == 54321, "port rewritten");
        EXPECT(str_of(root, "user") && strcmp(str_of(root, "user"), "root") == 0,
               "user preserved");
        EXPECT(str_of(root, "password") &&
                   strcmp(str_of(root, "password"), "s3cret") == 0,
               "password preserved");
        EXPECT(str_of(root, "database") &&
                   strcmp(str_of(root, "database"), "app") == 0,
               "database preserved");
        cJSON_Delete(root);
        free(out);
    }

    /* --- socket is dropped so the driver cannot bypass the forward --- */
    {
        const char *dsn = "{\"host\":\"db\",\"socket\":\"/var/run/mysqld.sock\"}";
        char *out = dsn_rewrite_loopback(dsn, 6000);
        EXPECT(out != NULL, "rewrite with socket returns a string");
        cJSON *root = cJSON_Parse(out);
        EXPECT(cJSON_GetObjectItemCaseSensitive(root, "socket") == NULL,
               "socket removed");
        cJSON_Delete(root);
        free(out);
    }

    /* --- host/port added when the DSN had none --- */
    {
        char *out = dsn_rewrite_loopback("{\"user\":\"u\"}", 7000);
        EXPECT(out != NULL, "rewrite of hostless dsn returns a string");
        cJSON *root = cJSON_Parse(out);
        EXPECT(str_of(root, "host") && strcmp(str_of(root, "host"), "127.0.0.1") == 0,
               "host added");
        cJSON *port = cJSON_GetObjectItemCaseSensitive(root, "port");
        EXPECT(cJSON_IsNumber(port) && port->valueint == 7000, "port added");
        cJSON_Delete(root);
        free(out);
    }

    /* --- invalid inputs --- */
    EXPECT(dsn_rewrite_loopback(NULL, 5000) == NULL, "NULL dsn => NULL");
    EXPECT(dsn_rewrite_loopback("not json", 5000) == NULL, "garbage dsn => NULL");
    EXPECT(dsn_rewrite_loopback("[1,2,3]", 5000) == NULL, "non-object dsn => NULL");
    EXPECT(dsn_rewrite_loopback("{\"host\":\"db\"}", 0) == NULL, "port 0 => NULL");
    EXPECT(dsn_rewrite_loopback("{\"host\":\"db\"}", 70000) == NULL,
           "port > 65535 => NULL");

    if (failures == 0) {
        printf("OK: dsn_rewrite (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
