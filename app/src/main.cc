#include "webview/webview.h"

extern "C" {
#include "dbcore/dbcore.h"
#include "dbcore/ipc.h"
#include "frontend_assets.h"
}

#include "cJSON.h"

#include <cstdio>

// Bridge exposed to the frontend as window.quaeroRpc(requestJson) -> Promise.
// webview delivers the JS arguments as a JSON array string, e.g. ["{...}"];
// we unwrap the first element, hand it to the pure C dispatcher, and return
// the response JSON back to the awaiting Promise.
static void rpc_handler(const char *id, const char *req, void *arg)
{
    auto w = static_cast<webview_t>(arg);

    char *response = nullptr;
    cJSON *args = cJSON_Parse(req);
    if (cJSON_IsArray(args)) {
        const cJSON *first = cJSON_GetArrayItem(args, 0);
        if (cJSON_IsString(first) && first->valuestring != nullptr) {
            response = dbcore_ipc_handle(first->valuestring);
        }
    }

    if (response != nullptr) {
        webview_return(w, id, 0, response);
        dbcore_ipc_free(response);
    } else {
        // Keep the channel uniform: always resolve with a parseable JSON-RPC
        // envelope so the frontend's parseResponse/isError works either way.
        webview_return(w, id, 0,
                       "{\"jsonrpc\":\"2.0\",\"id\":null,"
                       "\"error\":{\"code\":-32600,"
                       "\"message\":\"invalid bridge call\"}}");
    }
    cJSON_Delete(args);
}

int main()
{
    std::printf("Quaero %s — starting webview shell\n", dbcore_version());

    webview_t w = webview_create(0, nullptr);
    if (w == nullptr) {
        std::fprintf(stderr,
                     "Quaero: failed to create the webview window "
                     "(is the WebView2/WebKit runtime available?)\n");
        return 1;
    }
    webview_set_title(w, "Quaero");
    webview_set_size(w, 1100, 720, WEBVIEW_HINT_NONE);
    webview_bind(w, "quaeroRpc", rpc_handler, w);

    // Load the embedded, self-contained frontend bundle (no loose files).
    webview_set_html(w, reinterpret_cast<const char *>(quaero_frontend_html));

    webview_run(w);
    webview_destroy(w);
    return 0;
}
