#include "dbcore/ipc.h"

#include "cJSON.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int g_failures = 0;

#define CHECK(cond, msg)                                            \
    do {                                                            \
        if (!(cond)) {                                              \
            fprintf(stderr, "FAIL: %s (%s:%d)\n", (msg),           \
                    __FILE__, __LINE__);                            \
            g_failures++;                                           \
        }                                                           \
    } while (0)

/* Runs a request through the dispatcher and returns the parsed response.
   Caller must cJSON_Delete the result. */
static cJSON *roundtrip(const char *request)
{
    char *raw = dbcore_ipc_handle(request);
    CHECK(raw != NULL, "dispatcher returned NULL");
    if (raw == NULL) {
        return NULL;
    }
    cJSON *parsed = cJSON_Parse(raw);
    CHECK(parsed != NULL, "response was not valid JSON");
    dbcore_ipc_free(raw);
    return parsed;
}

static int error_code(const cJSON *response)
{
    const cJSON *error = cJSON_GetObjectItemCaseSensitive(response, "error");
    const cJSON *code = cJSON_GetObjectItemCaseSensitive(error, "code");
    return cJSON_IsNumber(code) ? code->valueint : 0;
}

static void test_hello(void)
{
    cJSON *r = roundtrip("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"app.hello\"}");
    if (r == NULL) return;

    const cJSON *jsonrpc = cJSON_GetObjectItemCaseSensitive(r, "jsonrpc");
    CHECK(cJSON_IsString(jsonrpc) && strcmp(jsonrpc->valuestring, "2.0") == 0,
          "hello: jsonrpc != 2.0");

    const cJSON *id = cJSON_GetObjectItemCaseSensitive(r, "id");
    CHECK(cJSON_IsNumber(id) && id->valueint == 1, "hello: id not echoed");

    const cJSON *result = cJSON_GetObjectItemCaseSensitive(r, "result");
    CHECK(cJSON_IsObject(result), "hello: missing result");

    const cJSON *name = cJSON_GetObjectItemCaseSensitive(result, "name");
    CHECK(cJSON_IsString(name) && strcmp(name->valuestring, "quaero") == 0,
          "hello: name != quaero");

    const cJSON *proto =
        cJSON_GetObjectItemCaseSensitive(result, "protocolVersion");
    CHECK(cJSON_IsNumber(proto) &&
              proto->valueint == DBCORE_IPC_PROTOCOL_VERSION,
          "hello: wrong protocolVersion");

    const cJSON *core =
        cJSON_GetObjectItemCaseSensitive(result, "coreVersion");
    CHECK(cJSON_IsString(core) && strlen(core->valuestring) > 0,
          "hello: missing coreVersion");

    cJSON_Delete(r);
}

static void test_ping_echo(void)
{
    cJSON *r = roundtrip(
        "{\"jsonrpc\":\"2.0\",\"id\":\"abc\",\"method\":\"ping\","
        "\"params\":{\"message\":\"hi\"}}");
    if (r == NULL) return;

    const cJSON *id = cJSON_GetObjectItemCaseSensitive(r, "id");
    CHECK(cJSON_IsString(id) && strcmp(id->valuestring, "abc") == 0,
          "ping: string id not echoed");

    const cJSON *result = cJSON_GetObjectItemCaseSensitive(r, "result");
    const cJSON *pong = cJSON_GetObjectItemCaseSensitive(result, "pong");
    CHECK(cJSON_IsTrue(pong), "ping: pong not true");

    const cJSON *echo = cJSON_GetObjectItemCaseSensitive(result, "echo");
    CHECK(cJSON_IsString(echo) && strcmp(echo->valuestring, "hi") == 0,
          "ping: echo missing/incorrect");

    cJSON_Delete(r);
}

static void test_ping_no_params(void)
{
    cJSON *r = roundtrip("{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"ping\"}");
    if (r == NULL) return;

    const cJSON *result = cJSON_GetObjectItemCaseSensitive(r, "result");
    const cJSON *pong = cJSON_GetObjectItemCaseSensitive(result, "pong");
    CHECK(cJSON_IsTrue(pong), "ping(no params): pong not true");

    const cJSON *echo = cJSON_GetObjectItemCaseSensitive(result, "echo");
    CHECK(echo == NULL, "ping(no params): echo should be absent");

    cJSON_Delete(r);
}

static void test_not_an_object(void)
{
    /* Valid JSON, but not a request object. */
    cJSON *r = roundtrip("123");
    if (r == NULL) return;
    CHECK(error_code(r) == -32600, "non-object request: expected -32600");
    cJSON_Delete(r);
}

static void test_parse_error(void)
{
    cJSON *r = roundtrip("{not valid json");
    if (r == NULL) return;
    CHECK(error_code(r) == -32700, "parse error: expected -32700");
    cJSON_Delete(r);
}

static void test_unknown_method(void)
{
    cJSON *r =
        roundtrip("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"does.not.exist\"}");
    if (r == NULL) return;
    CHECK(error_code(r) == -32601, "unknown method: expected -32601");
    cJSON_Delete(r);
}

static void test_missing_method(void)
{
    cJSON *r = roundtrip("{\"jsonrpc\":\"2.0\",\"id\":3}");
    if (r == NULL) return;
    CHECK(error_code(r) == -32600, "missing method: expected -32600");
    cJSON_Delete(r);
}

static void test_null_request(void)
{
    char *raw = dbcore_ipc_handle(NULL);
    CHECK(raw != NULL, "null request: returned NULL");
    if (raw == NULL) return;
    cJSON *r = cJSON_Parse(raw);
    dbcore_ipc_free(raw);
    CHECK(error_code(r) == -32600, "null request: expected -32600");
    cJSON_Delete(r);
}

int main(void)
{
    test_hello();
    test_ping_echo();
    test_ping_no_params();
    test_not_an_object();
    test_parse_error();
    test_unknown_method();
    test_missing_method();
    test_null_request();

    if (g_failures == 0) {
        printf("OK: all IPC dispatcher tests passed\n");
        return 0;
    }
    fprintf(stderr, "%d IPC test(s) failed\n", g_failures);
    return 1;
}
