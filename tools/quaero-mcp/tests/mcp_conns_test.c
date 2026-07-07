#include "mcp_conns.h"

#include <stdio.h>
#include <string.h>

static int failures = 0;
#define EXPECT(cond, msg)                             \
    do {                                              \
        if (!(cond)) {                                \
            fprintf(stderr, "FAIL: %s\n", (msg));     \
            failures++;                               \
        }                                             \
    } while (0)

int main(void)
{
    char err[128];

    /* --- opt-in filtering + flag defaults --- */
    {
        const char *json =
            "{\"version\":1,\"connections\":["
            "{\"id\":\"a\",\"name\":\"Alpha\",\"driver\":\"sqlite\","
            "  \"params\":{\"path\":\"/a.db\"},\"mcp\":true},"
            "{\"id\":\"b\",\"name\":\"Beta\",\"driver\":\"mysql\","
            "  \"params\":{\"host\":\"h\"}},"                       /* no mcp */
            "{\"id\":\"c\",\"name\":\"Gamma\",\"driver\":\"sqlite\","
            "  \"params\":{\"path\":\"/c.db\"},\"mcp\":true,\"mcpWrite\":true}"
            "]}";
        mcp_conns_t *c = mcp_conns_parse(json, err, sizeof err);
        EXPECT(c != NULL, "valid file parses");
        EXPECT(mcp_conns_count(c) == 2, "only mcp:true connections retained");

        const mcp_conn_t *a = mcp_conns_find(c, "a");
        EXPECT(a != NULL, "find by id");
        EXPECT(a && a->allow_write == 0, "mcpWrite defaults to false");
        EXPECT(a && strcmp(a->driver, "sqlite") == 0, "driver read");
        EXPECT(a && cJSON_IsObject(a->params), "params is an object");

        const mcp_conn_t *beta = mcp_conns_find(c, "b");
        EXPECT(beta == NULL, "non-opted-in connection is invisible");

        const mcp_conn_t *g = mcp_conns_find(c, "Gamma"); /* by name */
        EXPECT(g != NULL, "find by name");
        EXPECT(g && g->allow_write == 1, "mcpWrite:true honored");

        mcp_conns_free(c);
    }

    /* --- empty (no opted-in connections) is valid, not an error --- */
    {
        const char *json = "{\"version\":1,\"connections\":[]}";
        mcp_conns_t *c = mcp_conns_parse(json, err, sizeof err);
        EXPECT(c != NULL, "empty connections parses");
        EXPECT(mcp_conns_count(c) == 0, "zero connections");
        mcp_conns_free(c);
    }

    /* --- malformed inputs --- */
    {
        EXPECT(mcp_conns_parse("not json", err, sizeof err) == NULL,
               "garbage rejected");
        EXPECT(err[0] != '\0', "error message set");
        EXPECT(mcp_conns_parse("{\"version\":1}", err, sizeof err) == NULL,
               "missing connections array rejected");
        EXPECT(mcp_conns_parse(NULL, err, sizeof err) == NULL, "NULL rejected");
    }

    /* --- an opted-in but unusable entry (no driver) is skipped, not fatal --- */
    {
        const char *json =
            "{\"version\":1,\"connections\":["
            "{\"id\":\"x\",\"mcp\":true,\"params\":{}}]}"; /* no driver */
        mcp_conns_t *c = mcp_conns_parse(json, err, sizeof err);
        EXPECT(c != NULL, "parses");
        EXPECT(mcp_conns_count(c) == 0, "unusable entry skipped");
        mcp_conns_free(c);
    }

    if (failures == 0) {
        printf("mcp_conns_test: all checks passed\n");
        return 0;
    }
    fprintf(stderr, "mcp_conns_test: %d failure(s)\n", failures);
    return 1;
}
