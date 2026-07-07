#include "mcp_conns.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct mcp_conns {
    cJSON *root;       /* owns the parsed document; records borrow from it */
    mcp_conn_t *items; /* MCP-enabled connections */
    size_t count;
};

static int json_true(const cJSON *obj, const char *key)
{
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(obj, key);
    return cJSON_IsBool(v) ? cJSON_IsTrue(v) : 0;
}

static const char *json_str(const cJSON *obj, const char *key)
{
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(obj, key);
    return (cJSON_IsString(v) && v->valuestring != NULL) ? v->valuestring : NULL;
}

mcp_conns_t *mcp_conns_parse(const char *json, char *err, size_t errlen)
{
    if (err != NULL && errlen > 0) {
        err[0] = '\0';
    }
    if (json == NULL) {
        if (err != NULL) {
            snprintf(err, errlen, "no connections JSON");
        }
        return NULL;
    }
    cJSON *root = cJSON_Parse(json);
    if (root == NULL) {
        if (err != NULL) {
            snprintf(err, errlen, "invalid JSON");
        }
        return NULL;
    }
    const cJSON *list = cJSON_GetObjectItemCaseSensitive(root, "connections");
    if (!cJSON_IsArray(list)) {
        if (err != NULL) {
            snprintf(err, errlen, "missing \"connections\" array");
        }
        cJSON_Delete(root);
        return NULL;
    }

    mcp_conns_t *c = (mcp_conns_t *)calloc(1, sizeof *c);
    if (c == NULL) {
        cJSON_Delete(root);
        return NULL;
    }
    c->root = root;

    int total = cJSON_GetArraySize(list);
    if (total > 0) {
        c->items = (mcp_conn_t *)calloc((size_t)total, sizeof *c->items);
        if (c->items == NULL) {
            free(c);
            cJSON_Delete(root);
            return NULL;
        }
    }

    const cJSON *entry = NULL;
    cJSON_ArrayForEach(entry, list)
    {
        if (!cJSON_IsObject(entry) || !json_true(entry, "mcp")) {
            continue; /* opt-in only */
        }
        const char *driver = json_str(entry, "driver");
        const cJSON *params = cJSON_GetObjectItemCaseSensitive(entry, "params");
        if (driver == NULL || !cJSON_IsObject(params)) {
            continue; /* unusable without a driver + DSN */
        }
        mcp_conn_t *rec = &c->items[c->count++];
        rec->id = json_str(entry, "id");
        rec->name = json_str(entry, "name");
        rec->driver = driver;
        rec->params = params;
        rec->allow_write = json_true(entry, "mcpWrite");
    }
    return c;
}

mcp_conns_t *mcp_conns_load_file(const char *path, char *err, size_t errlen)
{
    if (err != NULL && errlen > 0) {
        err[0] = '\0';
    }
    FILE *f = fopen(path, "rb");
    if (f == NULL) {
        if (err != NULL) {
            snprintf(err, errlen, "cannot open %s", path);
        }
        return NULL;
    }
    if (fseek(f, 0, SEEK_END) != 0) {
        fclose(f);
        if (err != NULL) {
            snprintf(err, errlen, "cannot read %s", path);
        }
        return NULL;
    }
    long size = ftell(f);
    if (size < 0 || size > 8 * 1024 * 1024) { /* sane cap for a config file */
        fclose(f);
        if (err != NULL) {
            snprintf(err, errlen, "connections file too large or unreadable");
        }
        return NULL;
    }
    rewind(f);
    char *buf = (char *)malloc((size_t)size + 1);
    if (buf == NULL) {
        fclose(f);
        return NULL;
    }
    size_t got = fread(buf, 1, (size_t)size, f);
    fclose(f);
    buf[got] = '\0';

    mcp_conns_t *c = mcp_conns_parse(buf, err, errlen);
    free(buf);
    return c;
}

size_t mcp_conns_count(const mcp_conns_t *c)
{
    return c != NULL ? c->count : 0;
}

const mcp_conn_t *mcp_conns_at(const mcp_conns_t *c, size_t i)
{
    if (c == NULL || i >= c->count) {
        return NULL;
    }
    return &c->items[i];
}

const mcp_conn_t *mcp_conns_find(const mcp_conns_t *c, const char *id_or_name)
{
    if (c == NULL || id_or_name == NULL) {
        return NULL;
    }
    for (size_t i = 0; i < c->count; i++) {
        if (c->items[i].id != NULL && strcmp(c->items[i].id, id_or_name) == 0) {
            return &c->items[i];
        }
    }
    for (size_t i = 0; i < c->count; i++) {
        if (c->items[i].name != NULL &&
            strcmp(c->items[i].name, id_or_name) == 0) {
            return &c->items[i];
        }
    }
    return NULL;
}

void mcp_conns_free(mcp_conns_t *c)
{
    if (c == NULL) {
        return;
    }
    free(c->items);
    cJSON_Delete(c->root);
    free(c);
}
