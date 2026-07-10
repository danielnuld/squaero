#include "dbcore/ipc.h"
#include "dbcore/op_registry.h"
#include "cJSON.h"

#include <stdio.h>

/* op.cancel reaches the driver through the op registry, not the connection
   manager, so this test drives the registry directly and calls op.cancel through
   the public dispatcher — exercising the exact wiring the app shell uses. */
struct dbc_conn { int tag; };

static int failures = 0;
#define EXPECT(cond, msg)                              \
    do {                                               \
        if (!(cond)) {                                 \
            fprintf(stderr, "FAIL: %s\n", (msg));      \
            failures++;                                \
        }                                              \
    } while (0)

static int g_cancel_calls = 0;

static dbc_status stub_cancel(dbc_conn *c)
{
    (void)c;
    g_cancel_calls++;
    return DBC_OK;
}

static dbc_driver_t cancel_driver(void)
{
    dbc_driver_t d = {0};
    d.abi_version = DBC_ABI_VERSION;
    d.name        = "cancelable";
    d.cancel      = stub_cancel;
    d.features    = DBC_FEAT_CANCEL;
    return d;
}

static cJSON *call(const char *request)
{
    char *resp = dbcore_ipc_handle(request);
    cJSON *root = cJSON_Parse(resp);
    dbcore_ipc_free(resp);
    return root;
}

static int error_code(cJSON *root)
{
    cJSON *err  = cJSON_GetObjectItemCaseSensitive(root, "error");
    cJSON *code = cJSON_GetObjectItemCaseSensitive(err, "code");
    return cJSON_IsNumber(code) ? code->valueint : 0;
}

static int canceled_flag(cJSON *root)
{
    cJSON *res = cJSON_GetObjectItemCaseSensitive(root, "result");
    return cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(res, "canceled"));
}

int main(void)
{
    dbcore_op_registry_reset();

    /* Malformed / missing connId -> invalid params. */
    {
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"op.cancel\","
                           "\"params\":{\"connId\":\"bad\"}}");
        EXPECT(error_code(root) == -32602, "malformed connId -> -32602");
        cJSON_Delete(root);

        root = call("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"op.cancel\","
                    "\"params\":{}}");
        EXPECT(error_code(root) == -32602, "missing connId -> -32602");
        cJSON_Delete(root);
    }

    /* Nothing running on the conn: a clean canceled:false, not an error. */
    {
        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"op.cancel\","
                           "\"params\":{\"connId\":\"c1\"}}");
        cJSON *res = cJSON_GetObjectItemCaseSensitive(root, "result");
        EXPECT(res != NULL, "op.cancel returns a result, not an error");
        EXPECT(!canceled_flag(root), "nothing running -> canceled:false");
        cJSON_Delete(root);
    }

    /* A running query on c5 is canceled through the dispatcher. */
    {
        dbc_driver_t   drv  = cancel_driver();
        struct dbc_conn conn = { 5 };
        dbcore_op_begin(5, &drv, &conn);

        cJSON *root = call("{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"op.cancel\","
                           "\"params\":{\"connId\":\"c5\"}}");
        EXPECT(canceled_flag(root), "running query -> canceled:true");
        EXPECT(g_cancel_calls == 1, "driver cancel invoked exactly once");
        cJSON_Delete(root);

        dbcore_op_end(5);
    }

    dbcore_op_registry_reset();

    if (failures == 0) {
        printf("OK: op.cancel IPC method (all cases)\n");
        return 0;
    }
    fprintf(stderr, "%d assertion(s) failed\n", failures);
    return 1;
}
