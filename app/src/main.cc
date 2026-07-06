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
#include <cstring>
#include <string>
#include <vector>

#if defined(_WIN32)
#include <windows.h>
#include <shlobj.h>
#include <WebView2.h>
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

    // One-time signal that the frontend loaded and reached the bridge (the
    // startup app.hello handshake). Useful to confirm the UI actually rendered.
    static bool first_call = true;
    if (first_call) {
        first_call = false;
        std::printf("Quaero: frontend connected to the bridge\n");
    }

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

// Load the embedded frontend bundle into the webview.
//
// On Windows we serve it from a stable https origin (https://quaero.local) via
// WebView2's virtual-host mapping, so the page has a real origin and its
// localStorage (saved connections, theme) PERSISTS across restarts. Loading via
// set_html gives an opaque origin, for which Chromium never persists
// localStorage. Any failure falls back to set_html (same as before, just no
// persistence). Non-Windows uses set_html until an equivalent is wired.
static void load_frontend(webview_t w)
{
    const char *html = reinterpret_cast<const char *>(quaero_frontend_html);
#if defined(_WIN32)
    do {
        wchar_t appdata[MAX_PATH];
        if (!SUCCEEDED(
                SHGetFolderPathW(nullptr, CSIDL_APPDATA, nullptr, 0, appdata))) {
            break;
        }
        std::wstring dir = std::wstring(appdata) + L"\\Quaero\\ui";
        SHCreateDirectoryExW(nullptr, dir.c_str(), nullptr);
        std::wstring file = dir + L"\\index.html";

        HANDLE fh = CreateFileW(file.c_str(), GENERIC_WRITE, 0, nullptr,
                                CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (fh == INVALID_HANDLE_VALUE) {
            break;
        }
        DWORD len = static_cast<DWORD>(std::strlen(html));
        DWORD written = 0;
        BOOL wrote = WriteFile(fh, html, len, &written, nullptr);
        CloseHandle(fh);
        if (!wrote || written != len) {
            break;
        }

        auto controller = static_cast<ICoreWebView2Controller *>(
            webview_get_native_handle(w,
                                      WEBVIEW_NATIVE_HANDLE_KIND_BROWSER_CONTROLLER));
        if (controller == nullptr) {
            break;
        }
        ICoreWebView2 *core = nullptr;
        if (!SUCCEEDED(controller->get_CoreWebView2(&core)) || core == nullptr) {
            break;
        }
        ICoreWebView2_3 *core3 = nullptr;
        HRESULT hr = core->QueryInterface(IID_ICoreWebView2_3,
                                          reinterpret_cast<void **>(&core3));
        core->Release();
        if (!SUCCEEDED(hr) || core3 == nullptr) {
            break;
        }
        hr = core3->SetVirtualHostNameToFolderMapping(
            L"quaero.local", dir.c_str(),
            COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
        core3->Release();
        if (!SUCCEEDED(hr)) {
            break;
        }
        webview_navigate(w, "https://quaero.local/index.html");
        std::printf("Quaero: UI served from https://quaero.local (persistent)\n");
        return;
    } while (0);
    std::fprintf(stderr,
                 "Quaero: virtual-host setup failed; falling back to set_html "
                 "(settings will not persist across restarts)\n");
#endif
    webview_set_html(w, html);
}

#if defined(_WIN32)
// Apply the embedded application icon (resource id 1, from quaero.rc — issue
// #190) to the webview window. The webview library registers its window class
// without an icon, so without this the title bar and taskbar show the generic
// default icon even though the .exe file itself carries the icon.
static void apply_window_icon(webview_t w)
{
    HWND hwnd = static_cast<HWND>(webview_get_window(w));
    if (hwnd == nullptr) {
        return;
    }
    HINSTANCE inst = GetModuleHandleW(nullptr);
    HICON big = static_cast<HICON>(
        LoadImageW(inst, MAKEINTRESOURCEW(1), IMAGE_ICON,
                   GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON),
                   LR_DEFAULTCOLOR));
    HICON small = static_cast<HICON>(
        LoadImageW(inst, MAKEINTRESOURCEW(1), IMAGE_ICON,
                   GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON),
                   LR_DEFAULTCOLOR));
    if (big != nullptr) {
        SendMessageW(hwnd, WM_SETICON, ICON_BIG, reinterpret_cast<LPARAM>(big));
    }
    if (small != nullptr) {
        SendMessageW(hwnd, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(small));
    }
}
#endif

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
#if defined(_WIN32)
    apply_window_icon(w);
#endif
    webview_set_size(w, 1100, 720, WEBVIEW_HINT_NONE);
    webview_bind(w, "quaeroRpc", rpc_handler, w);

    // Load the embedded, self-contained frontend bundle (persistent origin on
    // Windows; set_html fallback otherwise).
    load_frontend(w);

    webview_run(w);
    webview_destroy(w);

    for (dbc_plugin *plugin : g_plugins) {
        dbc_plugin_unload(plugin);
    }
    g_plugins.clear();
    return 0;
}
