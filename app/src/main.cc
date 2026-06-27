#include "webview/webview.h"

extern "C" {
#include "dbcore/dbcore.h"
#include "dbcore/ipc.h"
#include "dbcore/loader.h"
#include "dbcore/runtime.h"
#include "frontend_assets.h"
}

#include "cJSON.h"

#include <cstdio>
#include <string>
#include <vector>

#if defined(_WIN32)
#include <windows.h>
#elif defined(__APPLE__)
#include <mach-o/dyld.h>
#include <climits>
#else
#include <climits>
#include <unistd.h>
#endif

// Plugins are loaded at startup and kept alive for the whole process; their
// vtables are borrowed by the runtime registry. Unloaded after the UI closes.
static std::vector<dbc_plugin *> g_plugins;

// Absolute path of the running executable, or empty on failure.
static std::string executable_path()
{
#if defined(_WIN32)
    char buf[MAX_PATH];
    DWORD n = GetModuleFileNameA(nullptr, buf, sizeof buf);
    if (n == 0 || n >= sizeof buf) {
        return {};
    }
    return std::string(buf, n);
#elif defined(__APPLE__)
    char buf[PATH_MAX];
    uint32_t size = sizeof buf;
    if (_NSGetExecutablePath(buf, &size) != 0) {
        return {};
    }
    return std::string(buf);
#else
    char buf[PATH_MAX];
    ssize_t n = readlink("/proc/self/exe", buf, sizeof buf - 1);
    if (n <= 0) {
        return {};
    }
    buf[n] = '\0';
    return std::string(buf);
#endif
}

// Directory holding the executable (no trailing separator), or empty.
static std::string executable_dir()
{
    std::string path = executable_path();
    std::string::size_type slash = path.find_last_of("/\\");
    if (slash == std::string::npos) {
        return {};
    }
    return path.substr(0, slash);
}

// Sink: register the loaded plugin's driver and retain the handle.
static void on_plugin_loaded(dbc_plugin *plugin, void *ctx)
{
    auto rt = static_cast<dbcore_runtime *>(ctx);
    const dbc_driver_t *drv = dbc_plugin_driver(plugin);
    if (dbcore_runtime_register_driver(rt, drv) == DBC_OK) {
        g_plugins.push_back(plugin);
        std::printf("Quaero: loaded driver '%s'\n", drv->name);
    } else {
        std::fprintf(stderr, "Quaero: failed to register driver '%s'\n",
                     drv != nullptr ? drv->name : "(unknown)");
        dbc_plugin_unload(plugin);
    }
}

// Sink: report a plugin that failed to load, but keep scanning the rest.
static void on_plugin_error(const char *path, dbc_status status,
                            const char *message, void *ctx)
{
    (void)status;
    (void)ctx;
    std::fprintf(stderr, "Quaero: skipped plugin '%s': %s\n", path,
                 message != nullptr ? message : "unknown error");
}

// Discover and register driver plugins from <exe_dir>/drivers. A missing
// directory or a bad plugin is non-fatal — the app still starts (the UI will
// simply have no driver to connect with, reported honestly per connection).
static void load_drivers()
{
    dbcore_runtime *rt = dbcore_runtime_get();
    if (rt == nullptr) {
        std::fprintf(stderr, "Quaero: runtime unavailable; no drivers loaded\n");
        return;
    }
    std::string dir = executable_dir();
    if (dir.empty()) {
        std::fprintf(stderr, "Quaero: could not resolve executable directory\n");
        return;
    }
    std::string drivers = dir + "/drivers";
    int loaded = dbc_plugin_scan_dir(drivers.c_str(), on_plugin_loaded,
                                     on_plugin_error, rt);
    if (loaded < 0) {
        std::fprintf(stderr, "Quaero: no drivers directory at %s\n",
                     drivers.c_str());
    } else {
        std::printf("Quaero: %d driver(s) registered\n", loaded);
    }
}

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
    // Unbuffered stdout so startup diagnostics are visible even when the
    // shell's output is redirected to a file or journal.
    std::setvbuf(stdout, nullptr, _IONBF, 0);

    std::printf("Quaero %s — starting webview shell\n", dbcore_version());

    // Register driver plugins before the UI opens so conn.open can resolve them.
    load_drivers();

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

    for (dbc_plugin *plugin : g_plugins) {
        dbc_plugin_unload(plugin);
    }
    g_plugins.clear();
    return 0;
}
