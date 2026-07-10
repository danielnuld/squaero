#include "webview/webview.h"

extern "C" {
#include "dbcore/dbcore.h"
#include "dbcore/ipc.h"
#include "dbcore/loader.h"
#include "dbcore/runtime.h"
#include "frontend_assets.h"
}

#include "cJSON.h"

#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#if defined(_WIN32)
#include <windows.h>
#include <shlobj.h>
#include <shellapi.h>
#include <urlmon.h>
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

// --- Asynchronous RPC dispatch ------------------------------------------------
//
// webview delivers bound-function calls on the UI thread. Running a slow query
// there froze the whole window (issue: cancelable queries). So the bridge no
// longer dispatches on the UI thread: it hands each request to a single worker
// thread and returns immediately, leaving the JS Promise pending. The worker
// runs the pure C dispatcher and posts the response back to the UI thread with
// webview_dispatch (the same pattern as the update download_worker below).
//
// A single worker keeps the core effectively single-threaded (only the worker
// touches the runtime/connection state), so no core locking is needed. The one
// exception is op.cancel, which must NOT wait behind the slow query it targets:
// it is dispatched inline on the UI thread and only touches the thread-safe op
// registry + the driver's thread-safe cancel hook.

// A request to run on the worker: the inner JSON-RPC string plus the bound-call
// id needed to resolve the right Promise. Both are copied off webview's buffers,
// which are only valid for the duration of the bound-function call.
struct RpcJob {
    std::string id;
    std::string request;
    webview_t   w;
};

static std::deque<RpcJob>       g_rpc_jobs;
static std::mutex               g_rpc_mtx;
static std::condition_variable  g_rpc_cv;
static bool                     g_rpc_stop = false;
static std::thread              g_rpc_worker;

// Payload carried from the worker back to the UI thread to resolve one Promise.
struct RpcReturn {
    std::string id;
    std::string response;
};

// UI thread: resolve the awaiting Promise with the response JSON.
static void deliver_rpc_return(webview_t w, void *arg)
{
    auto *r = static_cast<RpcReturn *>(arg);
    webview_return(w, r->id.c_str(), 0, r->response.c_str());
    delete r;
}

// The uniform error envelope used when a request cannot even be dispatched, so
// the frontend's parseResponse/isError always sees well-formed JSON-RPC.
static const char *const k_bridge_error =
    "{\"jsonrpc\":\"2.0\",\"id\":null,"
    "\"error\":{\"code\":-32600,\"message\":\"invalid bridge call\"}}";

// True when `request` is an op.cancel call — the one method dispatched inline so
// it is not queued behind the long-running query it is meant to interrupt.
static bool is_cancel_request(const std::string &request)
{
    cJSON *r = cJSON_Parse(request.c_str());
    bool cancel = false;
    if (cJSON_IsObject(r)) {
        const cJSON *m = cJSON_GetObjectItemCaseSensitive(r, "method");
        cancel = cJSON_IsString(m) && m->valuestring != nullptr &&
                 std::strcmp(m->valuestring, "op.cancel") == 0;
    }
    cJSON_Delete(r);
    return cancel;
}

// Run one request through the pure dispatcher, honoring QUAERO_RPC_DEBUG tracing,
// and return the response JSON (owned by the caller; free with dbcore_ipc_free).
// On a hang the "RPC>" line prints with no matching "RPC<", naming the culprit.
static char *dispatch_traced(const std::string &request)
{
    static const bool trace = std::getenv("QUAERO_RPC_DEBUG") != nullptr;
    unsigned long t0 = 0;
    if (trace) {
#if defined(_WIN32)
        t0 = GetTickCount();
#endif
        std::fprintf(stderr, "RPC> %.200s\n", request.c_str());
        std::fflush(stderr);
    }
    char *response = dbcore_ipc_handle(request.c_str());
    if (trace) {
#if defined(_WIN32)
        std::fprintf(stderr, "RPC< done in %lu ms\n", GetTickCount() - t0);
#else
        std::fprintf(stderr, "RPC< done\n");
#endif
        std::fflush(stderr);
    }
    return response;
}

// Worker thread: drain the queue, dispatching each request and posting the
// response back to the UI thread. Exits when g_rpc_stop is set (window closing);
// any still-queued jobs are abandoned — their window is going away.
static void rpc_worker_loop()
{
    for (;;) {
        RpcJob job;
        {
            std::unique_lock<std::mutex> lock(g_rpc_mtx);
            g_rpc_cv.wait(lock,
                          [] { return g_rpc_stop || !g_rpc_jobs.empty(); });
            if (g_rpc_stop) {
                return;
            }
            job = std::move(g_rpc_jobs.front());
            g_rpc_jobs.pop_front();
        }

        char *response = dispatch_traced(job.request);
        const char *payload = response != nullptr ? response : k_bridge_error;
        webview_dispatch(job.w, deliver_rpc_return,
                         new RpcReturn{job.id, payload});
        if (response != nullptr) {
            dbcore_ipc_free(response);
        }
    }
}

// Bridge exposed to the frontend as window.quaeroRpc(requestJson) -> Promise.
// webview delivers the JS arguments as a JSON array string, e.g. ["{...}"]; we
// unwrap the first element and either dispatch it inline (op.cancel) or hand it
// to the worker thread, resolving the Promise once the response comes back.
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

    // Unwrap ["{...}"] -> the inner JSON-RPC request string, copied off webview's
    // transient buffer so it can outlive this call on the worker queue.
    std::string request;
    bool have_request = false;
    cJSON *args = cJSON_Parse(req);
    if (cJSON_IsArray(args)) {
        const cJSON *first = cJSON_GetArrayItem(args, 0);
        if (cJSON_IsString(first) && first->valuestring != nullptr) {
            request = first->valuestring;
            have_request = true;
        }
    }
    cJSON_Delete(args);

    if (!have_request) {
        webview_return(w, id, 0, k_bridge_error);
        return;
    }

    // op.cancel bypasses the queue: it must interrupt the query that is currently
    // occupying the worker, so it runs here on the UI thread. It only touches the
    // thread-safe op registry and the driver's thread-safe cancel hook.
    if (is_cancel_request(request)) {
        char *response = dispatch_traced(request);
        webview_return(w, id, 0, response != nullptr ? response : k_bridge_error);
        if (response != nullptr) {
            dbcore_ipc_free(response);
        }
        return;
    }

    // Everything else runs on the worker; the Promise stays pending until then.
    {
        std::lock_guard<std::mutex> lock(g_rpc_mtx);
        g_rpc_jobs.push_back(RpcJob{id, std::move(request), w});
    }
    g_rpc_cv.notify_one();
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
    // Not named `small`: the Windows SDK's <rpcndr.h> #defines `small` to `char`,
    // which turns `HICON small` into a syntax error under MSVC (MinGW is unaffected).
    HICON icon_big = static_cast<HICON>(
        LoadImageW(inst, MAKEINTRESOURCEW(1), IMAGE_ICON,
                   GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON),
                   LR_DEFAULTCOLOR));
    HICON icon_small = static_cast<HICON>(
        LoadImageW(inst, MAKEINTRESOURCEW(1), IMAGE_ICON,
                   GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON),
                   LR_DEFAULTCOLOR));
    if (icon_big != nullptr) {
        SendMessageW(hwnd, WM_SETICON, ICON_BIG, reinterpret_cast<LPARAM>(icon_big));
    }
    if (icon_small != nullptr) {
        SendMessageW(hwnd, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(icon_small));
    }
}
#endif

#if defined(_WIN32)
// Bridge: window.quaeroOpenExternal(url) opens an http(s) URL in the user's
// default browser (used by the update modal's download button). Only http/https
// is honored — never ShellExecute an arbitrary path or command.
static void open_external_handler(const char *id, const char *req, void *arg)
{
    auto w = static_cast<webview_t>(arg);
    cJSON *args = cJSON_Parse(req);
    const cJSON *first = cJSON_IsArray(args) ? cJSON_GetArrayItem(args, 0) : nullptr;
    if (cJSON_IsString(first) && first->valuestring != nullptr) {
        const char *url = first->valuestring;
        if (std::strncmp(url, "https://", 8) == 0 || std::strncmp(url, "http://", 7) == 0) {
            int wlen = MultiByteToWideChar(CP_UTF8, 0, url, -1, nullptr, 0);
            if (wlen > 0) {
                std::wstring wurl(static_cast<size_t>(wlen), L'\0');
                MultiByteToWideChar(CP_UTF8, 0, url, -1, &wurl[0], wlen);
                ShellExecuteW(nullptr, L"open", wurl.c_str(), nullptr, nullptr,
                              SW_SHOWNORMAL);
            }
        }
    }
    cJSON_Delete(args);
    webview_return(w, id, 0, "null");
}

// Payload handed from the download worker back to the UI thread.
struct UpdateResult {
    webview_t w;
    std::string id;
    bool ok;
    std::wstring path;
};

// UI thread: resolve/reject the JS promise; on success launch the MSI and quit
// (a running quaero.exe would block the installer from replacing it).
static void finish_update(webview_t w, void *arg)
{
    auto *r = static_cast<UpdateResult *>(arg);
    if (r->ok) {
        webview_return(w, r->id.c_str(), 0, "{\"ok\":true}");
        ShellExecuteW(nullptr, L"open", r->path.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
        webview_terminate(w);
    } else {
        webview_return(w, r->id.c_str(), 1, "{\"ok\":false}");
    }
    delete r;
}

struct DownloadCtx {
    webview_t w;
    std::string id;
    std::wstring url;
};

// Worker thread: download the MSI to %TEMP%, then hand the result to the UI
// thread. Blocking download runs off the UI thread so the window stays responsive.
static void download_worker(DownloadCtx *ctx)
{
    bool ok = false;
    std::wstring path;
    wchar_t tmpdir[MAX_PATH];
    DWORD n = GetTempPathW(MAX_PATH, tmpdir);
    if (n > 0 && n < MAX_PATH) {
        path = std::wstring(tmpdir) + L"quaero-update.msi";
        ok = SUCCEEDED(
            URLDownloadToFileW(nullptr, ctx->url.c_str(), path.c_str(), 0, nullptr));
    }
    webview_dispatch(ctx->w, finish_update, new UpdateResult{ctx->w, ctx->id, ok, path});
    delete ctx;
}

// Bridge: window.quaeroDownloadAndInstall(url) downloads the release MSI and runs
// it, then closes the app. Restricted to a GitHub https .msi URL — never fetches
// or executes anything else.
static void download_install_handler(const char *id, const char *req, void *arg)
{
    auto w = static_cast<webview_t>(arg);
    cJSON *args = cJSON_Parse(req);
    const cJSON *first = cJSON_IsArray(args) ? cJSON_GetArrayItem(args, 0) : nullptr;
    bool started = false;
    if (cJSON_IsString(first) && first->valuestring != nullptr) {
        const char *url = first->valuestring;
        size_t len = std::strlen(url);
        if (std::strncmp(url, "https://github.com/", 19) == 0 && len > 4 &&
            _stricmp(url + len - 4, ".msi") == 0) {
            int wlen = MultiByteToWideChar(CP_UTF8, 0, url, -1, nullptr, 0);
            if (wlen > 0) {
                std::wstring wurl(static_cast<size_t>(wlen), L'\0');
                MultiByteToWideChar(CP_UTF8, 0, url, -1, &wurl[0], wlen);
                std::thread(download_worker, new DownloadCtx{w, id, wurl}).detach();
                started = true;
            }
        }
    }
    cJSON_Delete(args);
    if (!started) {
        webview_return(w, id, 1, "{\"ok\":false}");
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
#if defined(_WIN32)
    webview_bind(w, "quaeroOpenExternal", open_external_handler, w);
    webview_bind(w, "quaeroDownloadAndInstall", download_install_handler, w);
#endif

    // Start the RPC worker so queries run off the UI thread (the window stays
    // responsive and op.cancel can interrupt a slow query).
    g_rpc_worker = std::thread(rpc_worker_loop);

    // Load the embedded, self-contained frontend bundle (persistent origin on
    // Windows; set_html fallback otherwise).
    load_frontend(w);

    webview_run(w);

    // Window closed: stop the worker and wait for any in-flight dispatch to
    // finish before tearing down the runtime/plugins it may still be using. A
    // query already running blocks the join until it returns (the user can
    // cancel it first); queued-but-not-started jobs are abandoned.
    {
        std::lock_guard<std::mutex> lock(g_rpc_mtx);
        g_rpc_stop = true;
    }
    g_rpc_cv.notify_one();
    g_rpc_worker.join();

    webview_destroy(w);

    for (dbc_plugin *plugin : g_plugins) {
        dbc_plugin_unload(plugin);
    }
    g_plugins.clear();
    return 0;
}
