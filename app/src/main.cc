#include "webview/webview.h"

extern "C" {
#include "dbcore/dbcore.h"
#include "dbcore/ipc.h"
#include "dbcore/loader.h"
#include "dbcore/runtime.h"
#include "frontend_assets.h"
#include "menu_model.h"
#include "window_state.h"
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
#include <commdlg.h>
#include <shlobj.h>
#include <shellapi.h>
#include <urlmon.h>
#include <dwmapi.h>
#include <WebView2.h>
#elif defined(__APPLE__)
#include <mach-o/dyld.h>
#include <climits>
#include "macos.h"
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
        std::printf("Squaero: loaded driver '%s'\n", drv->name);
    } else {
        std::fprintf(stderr, "Squaero: failed to register driver '%s'\n",
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
    std::fprintf(stderr, "Squaero: skipped plugin '%s': %s\n", path,
                 message != nullptr ? message : "unknown error");
}

// Discover and register driver plugins from <exe_dir>/drivers. A missing
// directory or a bad plugin is non-fatal — the app still starts (the UI will
// simply have no driver to connect with, reported honestly per connection).
static void load_drivers()
{
    dbcore_runtime *rt = dbcore_runtime_get();
    if (rt == nullptr) {
        std::fprintf(stderr, "Squaero: runtime unavailable; no drivers loaded\n");
        return;
    }
    std::string dir = executable_dir();
    if (dir.empty()) {
        std::fprintf(stderr, "Squaero: could not resolve executable directory\n");
        return;
    }
    std::string drivers = dir + "/drivers";
    int loaded = dbc_plugin_scan_dir(drivers.c_str(), on_plugin_loaded,
                                     on_plugin_error, rt);
    if (loaded < 0) {
        std::fprintf(stderr, "Squaero: no drivers directory at %s\n",
                     drivers.c_str());
    } else {
        std::printf("Squaero: %d driver(s) registered\n", loaded);
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

// The first argument of a bound call when it is a string, else empty.
static std::string first_string_arg(const char *req)
{
    std::string out;
    cJSON *args = cJSON_Parse(req);
    const cJSON *first = cJSON_IsArray(args) ? cJSON_GetArrayItem(args, 0) : nullptr;
    if (cJSON_IsString(first) && first->valuestring != nullptr) {
        out = first->valuestring;
    }
    cJSON_Delete(args);
    return out;
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
        // Never the raw request (issue #302): conn.open carries the DSN, and
        // this is the variable someone turns on when things are going wrong —
        // when the log ends up in a file, an issue, or a colleague's inbox. The
        // 200-character cut this replaces protected nothing: a DSN fits easily.
        char *safe = dbcore_ipc_redact(request.c_str());
        std::fprintf(stderr, "RPC> %s\n", safe != nullptr ? safe : "<request withheld>");
        dbcore_ipc_free(safe);
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
#if defined(_WIN32)
/* Defined with the window setup below; called from here on the first bridge
   call, which is the moment the interface exists. */
void reveal_ui(webview_t w);
#endif

static void rpc_handler(const char *id, const char *req, void *arg)
{
    auto w = static_cast<webview_t>(arg);

    // One-time signal that the frontend loaded and reached the bridge (the
    // startup app.hello handshake). Useful to confirm the UI actually rendered.
    static bool first_call = true;
    if (first_call) {
        first_call = false;
        std::printf("Squaero: frontend connected to the bridge\n");
#if defined(_WIN32)
        // The interface has booted: swap the window's own background for it.
        reveal_ui(w);
#endif
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
// persistence).
//
// On Linux set_html is worse: WebKitGTK loads it as about:blank, origin null,
// and localStorage THROWS (SecurityError) — nothing the user saves survives
// (measured, issue #40). A file:// page has the origin "file://", which WebKit
// persists; the origin carries no path, so where the file lives can change.
// The storage itself is per program — $XDG_DATA_HOME/squaero/storage, named
// after g_set_prgname in main() — so other WebKitGTK apps never see it.

// The one URL the UI lives at (issue #685). The app is a single page that never
// navigates, so every other navigation the engine is asked for — a file dropped
// on the window, a mouse back button, a stray link — is a browser behaviour and
// is cancelled. "about:" covers the set_html fallback (about:blank).
static std::string g_app_uri = "about:blank";

static bool is_app_navigation(const std::string &uri)
{
    return uri == g_app_uri || uri.rfind("about:", 0) == 0;
}

static void load_frontend(webview_t w)
{
    const char *html = reinterpret_cast<const char *>(quaero_frontend_html);
#if defined(__linux__)
    do {
        // $XDG_DATA_HOME/squaero/ui, rewritten on every launch like Windows'.
        char *dir = g_build_filename(g_get_user_data_dir(), "squaero", "ui", nullptr);
        char *file = g_build_filename(dir, "index.html", nullptr);
        char *uri = nullptr;
        if (g_mkdir_with_parents(dir, 0700) == 0 &&
            g_file_set_contents(file, html, -1, nullptr)) {
            uri = g_filename_to_uri(file, nullptr, nullptr);
        }
        g_free(dir);
        g_free(file);
        if (uri == nullptr) {
            break;
        }
        g_app_uri = uri;
        webview_navigate(w, uri);
        std::printf("Squaero: UI served from %s (persistent)\n", uri);
        g_free(uri);
        return;
    } while (0);
    std::fprintf(stderr,
                 "Squaero: could not write the UI to the data directory; falling "
                 "back to set_html (settings will not be saved)\n");
#endif
#if defined(__APPLE__)
    // WKWebView gives set_html no origin either, so the same file:// page as
    // on Linux: ~/Library/Application Support/Squaero/ui (issue #40).
    {
        std::string uri = mac_write_ui(html);
        if (!uri.empty()) {
            g_app_uri = uri;
            webview_navigate(w, uri.c_str());
            std::printf("Squaero: UI served from %s (persistent)\n", uri.c_str());
            return;
        }
        std::fprintf(stderr,
                     "Squaero: could not write the UI to Application Support; "
                     "falling back to set_html (settings will not be saved)\n");
    }
#endif
#if defined(_WIN32)
    do {
        wchar_t appdata[MAX_PATH];
        if (!SUCCEEDED(
                SHGetFolderPathW(nullptr, CSIDL_APPDATA, nullptr, 0, appdata))) {
            break;
        }
        // Only the index.html served as https://quaero.local, rewritten on every
        // launch — so this folder CAN move with the rename (issue #466). What
        // must not change is the host name below: the origin is what
        // localStorage is keyed by, and it is a name, not a path.
        std::wstring dir = std::wstring(appdata) + L"\\Squaero\\ui";
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
        g_app_uri = "https://quaero.local/index.html";
        webview_navigate(w, g_app_uri.c_str());
        std::printf("Squaero: UI served from https://quaero.local (persistent)\n");
        return;
    } while (0);
    std::fprintf(stderr,
                 "Squaero: virtual-host setup failed; falling back to set_html "
                 "(settings will not persist across restarts)\n");
#endif
    webview_set_html(w, html);
}

#if defined(_WIN32) || defined(__linux__)
// --- Native menu bar (issue #686) ---------------------------------------------
//
// The UI owns the menu: it sends the model (menu_model.h) through quaeroSetMenu
// whenever its language, its state or the setting changes, and the shell only
// builds the toolkit's menu from it. A click comes back as a `quaero-menu`
// CustomEvent carrying the action id, which the UI runs through the same
// handler its command palette and shortcuts use. The accelerators are display
// only — the UI already handles the keys itself — except "quit", which is the
// window's own and never reaches the page. macOS keeps its menu in macos.mm.

static quaero_menu g_menu = {nullptr, 0};
static webview_t   g_menu_webview = nullptr;

static void run_menu_action(size_t index)
{
    if (g_menu_webview == nullptr || index >= g_menu.count ||
        g_menu.entries[index].kind != QUAERO_MENU_ITEM) {
        return;
    }
    const char *id = g_menu.entries[index].id;
    if (std::strcmp(id, "quit") == 0) {
        webview_terminate(g_menu_webview);
        return;
    }
    // A JSON string literal is a JS string literal, so cJSON does the quoting.
    cJSON *str = cJSON_CreateString(id);
    char *quoted = cJSON_PrintUnformatted(str);
    if (quoted != nullptr) {
        std::string js = "window.dispatchEvent(new CustomEvent('quaero-menu',{detail:";
        js += quoted;
        js += "}))";
        webview_eval(g_menu_webview, js.c_str());
        cJSON_free(quoted);
    }
    cJSON_Delete(str);
}
#endif

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

/* The system's apps-use-light-theme preference; dark when unreadable, which is
   also what the interface itself defaults to, so the two agree. */
static bool system_prefers_light(void)
{
    DWORD light = 0;
    DWORD size = sizeof light;
    LSTATUS st = RegGetValueW(
        HKEY_CURRENT_USER,
        L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
        L"AppsUseLightTheme", RRF_RT_REG_DWORD, nullptr, &light, &size);
    return st == ERROR_SUCCESS && light != 0;
}

/* The app's own --bg for the system preference. */
static COLORREF startup_background(void)
{
    if (system_prefers_light()) {
        return RGB(0xf7, 0xf7, 0xfa);  /* light theme --bg */
    }
    return RGB(0x1e, 0x1e, 0x24);      /* dark theme --bg (the default) */
}

/* Title bar following the theme (issue #685). 20 is DWMWA_USE_IMMERSIVE_DARK_MODE
   since Windows 10 20H1; 19 is the value the attribute had before that, tried
   when 20 is refused. Spelled as numbers: older SDKs do not name them. */
static void apply_title_bar_theme(HWND hwnd, bool dark)
{
    if (hwnd == nullptr) {
        return;
    }
    BOOL value = dark ? TRUE : FALSE;
    if (FAILED(DwmSetWindowAttribute(hwnd, 20, &value, sizeof value))) {
        DwmSetWindowAttribute(hwnd, 19, &value, sizeof value);
    }
}

// Wide (UTF-16) to UTF-8, for URIs WebView2 hands back.
static std::string narrow(const wchar_t *wide)
{
    int len = WideCharToMultiByte(CP_UTF8, 0, wide, -1, nullptr, 0, nullptr, nullptr);
    if (len <= 1) {
        return {};
    }
    std::string utf8(static_cast<size_t>(len) - 1, '\0');
    WideCharToMultiByte(CP_UTF8, 0, wide, -1, &utf8[0], len, nullptr, nullptr);
    return utf8;
}

// UTF-8 to wide (UTF-16), for the menu labels the UI sends.
static std::wstring widen(const char *utf8)
{
    int len = MultiByteToWideChar(CP_UTF8, 0, utf8, -1, nullptr, 0);
    if (len <= 1) {
        return {};
    }
    std::wstring wide(static_cast<size_t>(len) - 1, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, utf8, -1, &wide[0], len);
    return wide;
}

// The Win32 menu bar (issue #686). Each item's command id is its index in the
// model offset by k_menu_cmd_base, which WM_COMMAND (shell_wndproc) maps back.
// The accelerator is only the text after the tab: no accelerator table, so the
// key reaches the page once, through the UI's own shortcut handling.
//
// Known limitation: a Win32 menu bar follows the system's light/dark setting
// for menus, not the app's theme — there is no documented API to darken it.
static const UINT k_menu_cmd_base = 1000;

static HMENU build_menu_bar(const quaero_menu &m)
{
    HMENU bar = CreateMenu();
    HMENU sub = nullptr;
    for (size_t i = 0; i < m.count; i++) {
        const quaero_menu_entry &e = m.entries[i];
        if (e.kind == QUAERO_MENU_TOP) {
            sub = CreatePopupMenu();
            AppendMenuW(bar, MF_POPUP, reinterpret_cast<UINT_PTR>(sub), widen(e.label).c_str());
        } else if (sub == nullptr) {
            continue;  // an item before any menu: the parser does not produce it
        } else if (e.kind == QUAERO_MENU_SEPARATOR) {
            AppendMenuW(sub, MF_SEPARATOR, 0, nullptr);
        } else {
            std::wstring text = widen(e.label);
            if (e.accel != nullptr) {
                text += L"\t" + widen(e.accel);
            }
            AppendMenuW(sub, MF_STRING | (e.enabled ? MF_ENABLED : MF_GRAYED),
                        k_menu_cmd_base + i, text.c_str());
        }
    }
    return bar;
}

/* Replace the window's menu bar with the current model; an empty model takes
   it away. The client area changes height either way, and the webview library
   fits its child to the client area on WM_SIZE, so one is sent. */
static void apply_menu_bar(HWND hwnd)
{
    if (hwnd == nullptr) {
        return;
    }
    HMENU prev = GetMenu(hwnd);
    SetMenu(hwnd, g_menu.count > 0 ? build_menu_bar(g_menu) : nullptr);
    if (prev != nullptr) {
        DestroyMenu(prev);
    }
    RECT r;
    if (GetClientRect(hwnd, &r)) {
        SendMessageW(hwnd, WM_SIZE, SIZE_RESTORED, MAKELPARAM(r.right, r.bottom));
    }
}

// NavigationStarting: cancel anything that is not the app's own page (#685) —
// what a file dropped on the window, or a mouse back/forward button, asks for.
// One static instance for the process, hence the no-op reference counting.
class NavigationGuard final : public ICoreWebView2NavigationStartingEventHandler {
public:
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void **obj) override
    {
        static const IID k_iid_unknown = {0, 0, 0, {0xC0, 0, 0, 0, 0, 0, 0, 0x46}};
        if (obj == nullptr) {
            return E_POINTER;
        }
        if (IsEqualIID(riid, k_iid_unknown) ||
            IsEqualIID(riid, IID_ICoreWebView2NavigationStartingEventHandler)) {
            *obj = this;
            return S_OK;
        }
        *obj = nullptr;
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return 1; }
    ULONG STDMETHODCALLTYPE Release() override { return 1; }
    HRESULT STDMETHODCALLTYPE Invoke(ICoreWebView2 *,
                                     ICoreWebView2NavigationStartingEventArgs *args) override
    {
        LPWSTR uri = nullptr;
        if (SUCCEEDED(args->get_Uri(&uri)) && uri != nullptr) {
            std::string utf8 = narrow(uri);
            CoTaskMemFree(uri);
            if (!is_app_navigation(utf8)) {
                args->put_Cancel(TRUE);
                std::fprintf(stderr, "Squaero: blocked navigation to %s\n", utf8.c_str());
            }
        }
        return S_OK;
    }
};

static NavigationGuard g_navigation_guard;

/* Take the browser out of the window (issue #685): no accelerator keys (reload,
   print, find, zoom, back/forward — text editing keys such as Ctrl+C/V/X/A/Z
   are NOT accelerators and keep working), no Ctrl+wheel zoom, no status-bar
   link preview, no swipe navigation, and no default context menu — the UI draws
   its own (frontend contextMenu.ts) and already suppresses the native one.
   DevTools are decided by the `debug` flag webview_create received. Each
   setting is best-effort: a runtime too old for an interface simply keeps that
   one browser behaviour. */
static void apply_browser_settings(webview_t w)
{
    auto controller = static_cast<ICoreWebView2Controller *>(
        webview_get_native_handle(w, WEBVIEW_NATIVE_HANDLE_KIND_BROWSER_CONTROLLER));
    if (controller == nullptr) {
        return;
    }
    ICoreWebView2 *core = nullptr;
    if (FAILED(controller->get_CoreWebView2(&core)) || core == nullptr) {
        return;
    }
    ICoreWebView2Settings *settings = nullptr;
    if (SUCCEEDED(core->get_Settings(&settings)) && settings != nullptr) {
        settings->put_IsZoomControlEnabled(FALSE);
        settings->put_IsStatusBarEnabled(FALSE);
        settings->put_AreDefaultContextMenusEnabled(FALSE);
        ICoreWebView2Settings3 *s3 = nullptr;
        if (SUCCEEDED(settings->QueryInterface(IID_ICoreWebView2Settings3,
                                               reinterpret_cast<void **>(&s3))) &&
            s3 != nullptr) {
            s3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
            s3->Release();
        }
        ICoreWebView2Settings6 *s6 = nullptr;
        if (SUCCEEDED(settings->QueryInterface(IID_ICoreWebView2Settings6,
                                               reinterpret_cast<void **>(&s6))) &&
            s6 != nullptr) {
            s6->put_IsSwipeNavigationEnabled(FALSE);
            s6->Release();
        }
        settings->Release();
    }
    EventRegistrationToken token;
    core->add_NavigationStarting(&g_navigation_guard, &token);
    core->Release();
}

// --- Remembered window placement (issue #685) ---------------------------------
//
// %APPDATA%\Squaero\window holds one "x y w h max" line (window_state.h). The
// normal (un-maximised) rectangle plus whether the window was maximised is
// exactly what WINDOWPLACEMENT carries, so that is what is saved and restored.

static std::wstring window_state_path()
{
    wchar_t appdata[MAX_PATH];
    if (!SUCCEEDED(SHGetFolderPathW(nullptr, CSIDL_APPDATA, nullptr, 0, appdata))) {
        return {};
    }
    std::wstring dir = std::wstring(appdata) + L"\\Squaero";
    SHCreateDirectoryExW(nullptr, dir.c_str(), nullptr);
    return dir + L"\\window";
}

static void save_window_state(HWND hwnd)
{
    WINDOWPLACEMENT wp = {};
    wp.length = sizeof wp;
    if (!GetWindowPlacement(hwnd, &wp)) {
        return;
    }
    const RECT r = wp.rcNormalPosition;
    quaero_window_state s = {r.left, r.top, r.right - r.left, r.bottom - r.top,
                             wp.showCmd == SW_SHOWMAXIMIZED ? 1 : 0};
    char line[64];
    std::wstring path = window_state_path();
    if (quaero_window_state_format(&s, line, sizeof line) == 0 || path.empty()) {
        return;
    }
    FILE *f = _wfopen(path.c_str(), L"wb");
    if (f != nullptr) {
        std::fputs(line, f);
        std::fclose(f);
    }
}

/* Restore the saved placement, or start maximised when there is none — or when
   the saved rectangle is on no monitor any more (a laptop undocked from the
   screen it was last used on): MONITOR_DEFAULTTONULL says so without guessing. */
static void restore_window_state(HWND hwnd)
{
    quaero_window_state s;
    bool have = false;
    std::wstring path = window_state_path();
    if (!path.empty()) {
        if (FILE *f = _wfopen(path.c_str(), L"rb")) {
            char line[64] = {0};
            size_t n = std::fread(line, 1, sizeof line - 1, f);
            line[n] = '\0';
            std::fclose(f);
            have = quaero_window_state_parse(line, &s) != 0;
        }
    }
    RECT r = {};
    if (have) {
        r = RECT{s.x, s.y, s.x + s.width, s.y + s.height};
        have = MonitorFromRect(&r, MONITOR_DEFAULTTONULL) != nullptr;
    }
    if (!have) {
        // Start maximised. The chrome above and below the grid is a fixed
        // ~495 px, so at 1100x720 the data — the reason the window is open —
        // is under a third of it. The default size still decides what
        // "restore" gives back.
        ShowWindow(hwnd, SW_MAXIMIZE);
        return;
    }
    WINDOWPLACEMENT wp = {};
    wp.length = sizeof wp;
    wp.rcNormalPosition = r;
    wp.showCmd = s.maximized ? SW_SHOWMAXIMIZED : SW_SHOWNORMAL;
    SetWindowPlacement(hwnd, &wp);
}

/* The webview library owns the window procedure (it destroys the window on
   WM_CLOSE), so the placement is read just before, from a subclass that then
   hands every message on. */
static WNDPROC g_prev_wndproc = nullptr;

static LRESULT CALLBACK shell_wndproc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    if (msg == WM_CLOSE) {
        save_window_state(hwnd);
    }
    // A menu bar item (issue #686): HIWORD 0 and no control handle is a menu.
    if (msg == WM_COMMAND && HIWORD(wp) == 0 && lp == 0 && LOWORD(wp) >= k_menu_cmd_base) {
        run_menu_action(static_cast<size_t>(LOWORD(wp) - k_menu_cmd_base));
        return 0;
    }
    return CallWindowProcW(g_prev_wndproc, hwnd, msg, wp, lp);
}

static void watch_window_close(HWND hwnd)
{
    g_prev_wndproc = reinterpret_cast<WNDPROC>(SetWindowLongPtrW(
        hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(shell_wndproc)));
}

/* Set once the interface has booted and the browser surface is on screen. */
static bool g_ui_visible = false;

/* Show or hide the browser surface. Hidden, the window paints its class brush;
   visible, WebView2 covers the whole client area. */
static void set_webview_visible(webview_t w, BOOL visible)
{
    auto controller = static_cast<ICoreWebView2Controller *>(
        webview_get_native_handle(w, WEBVIEW_NATIVE_HANDLE_KIND_BROWSER_CONTROLLER));
    if (controller != nullptr) {
        controller->put_IsVisible(visible);
    }
}

/* Put the window in front of whatever the user was looking at.
   
   Windows refuses SetForegroundWindow to a process that does not already own
   the foreground — which, at launch, this one does not: the window is created
   and shown before the message loop runs, so the activation that ShowWindow
   would normally do never lands and the window ends up maximised BEHIND
   everything, on the taskbar, looking to the user as if it had opened
   minimised. Attaching to the current foreground thread's input queue for the
   length of the call is the documented way around the rule; it is what every
   desktop app that must show itself at startup does. */
static void bring_to_front(HWND hwnd)
{
    if (IsIconic(hwnd)) {
        ShowWindow(hwnd, SW_RESTORE);
    }
    HWND fg = GetForegroundWindow();
    DWORD fg_thread = GetWindowThreadProcessId(fg, nullptr);
    DWORD self = GetCurrentThreadId();
    bool attached = fg_thread != 0 && fg_thread != self &&
                    AttachThreadInput(fg_thread, self, TRUE);
    SetForegroundWindow(hwnd);
    BringWindowToTop(hwnd);
    if (attached) {
        AttachThreadInput(fg_thread, self, FALSE);
    }
}

/* Reveal the interface: called when the frontend makes its first RPC call (it
   has booted and painted) and, as a backstop, from a timer — a frontend that
   never calls must not leave a permanently blank window.

   This is also where the window claims the foreground, rather than at creation:
   here the message loop is running and the app has something to show, so being
   raised is what the user asked for by launching it. */
void reveal_ui(webview_t w)
{
    if (g_ui_visible) {
        return;
    }
    g_ui_visible = true;
    set_webview_visible(w, TRUE);
    HWND hwnd = static_cast<HWND>(webview_get_window(w));
    if (hwnd != nullptr) {
        bring_to_front(hwnd);
    }
}

static webview_t g_reveal_target = nullptr;

static void CALLBACK reveal_timer(HWND hwnd, UINT, UINT_PTR id, DWORD)
{
    KillTimer(hwnd, id);
    if (g_reveal_target != nullptr) {
        reveal_ui(g_reveal_target);
    }
}

// The window is on screen a couple of seconds before the interface is: the
// bundle is one self-contained ~1.2 MB document, and nothing in it paints until
// it has run — measured at ~2.5 s from launch. All that time WebView2 painted
// its own default (#121212), which reads as a black, broken window.
//
// So the browser surface starts HIDDEN and the window paints the app's own --bg
// through its class brush; the surface is revealed when the frontend makes its
// first RPC call. That is the splash screen, without a splash window to build,
// show and tear down — the "loading" state is the app's own background, and the
// interface simply appears in it.
//
// DefaultBackgroundColor is set as well: it costs two lines and covers a
// reload, where the surface is already visible. It does NOT cover the first
// boot — measured: the runtime keeps painting #121212 regardless until the
// document itself paints.
//
// The brush lives for the process: it is one GDI object, and the class outlives
// every place we could sensibly free it.
static void apply_startup_background(webview_t w)
{
    HWND hwnd = static_cast<HWND>(webview_get_window(w));
    if (hwnd == nullptr) {
        return;
    }
    /* Hidden while the brush is swapped, so the first frame the user sees is
       already the app's colour instead of the class's original white. */
    ShowWindow(hwnd, SW_HIDE);
    COLORREF color = startup_background();
    HBRUSH brush = CreateSolidBrush(color);
    if (brush != nullptr) {
        SetClassLongPtrW(hwnd, GCLP_HBRBACKGROUND,
                         reinterpret_cast<LONG_PTR>(brush));
        InvalidateRect(hwnd, nullptr, TRUE);
    }

    auto controller = static_cast<ICoreWebView2Controller *>(
        webview_get_native_handle(w, WEBVIEW_NATIVE_HANDLE_KIND_BROWSER_CONTROLLER));
    if (controller == nullptr) {
        return;
    }
    ICoreWebView2Controller2 *controller2 = nullptr;
    HRESULT hr = controller->QueryInterface(IID_ICoreWebView2Controller2,
                                            reinterpret_cast<void **>(&controller2));
    if (!SUCCEEDED(hr) || controller2 == nullptr) {
        std::printf("Squaero: webview background not settable (older runtime)\n");
        return;  /* older WebView2 runtime: the class brush alone still helps */
    }
    COREWEBVIEW2_COLOR bg = {255, GetRValue(color), GetGValue(color), GetBValue(color)};
    controller2->put_DefaultBackgroundColor(bg);
    controller2->Release();

    /* Hide the surface until the interface has booted; the window shows the
       brush above meanwhile. The timer is the backstop for a frontend that
       never calls back — five seconds is well past the ~2.5 s it takes. */
    set_webview_visible(w, FALSE);
    ShowWindow(hwnd, SW_SHOW);
    g_reveal_target = w;
    SetTimer(hwnd, 1, 5000, reveal_timer);
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

// Bridge: window.quaeroPickFile(title) opens the native "open file" dialog and
// resolves to the chosen absolute path, or to null when the user cancels. The
// connection form uses it for the fields that hold a path (SSH key, TLS
// certificates, the SQLite file): a webview <input type="file"> only ever hands
// JS the file name, never the path the core needs.
static void pick_file_handler(const char *id, const char *req, void *arg)
{
    auto w = static_cast<webview_t>(arg);
    cJSON *args = cJSON_Parse(req);
    const cJSON *first = cJSON_IsArray(args) ? cJSON_GetArrayItem(args, 0) : nullptr;
    std::wstring wtitle;
    if (cJSON_IsString(first) && first->valuestring != nullptr) {
        int wlen = MultiByteToWideChar(CP_UTF8, 0, first->valuestring, -1, nullptr, 0);
        if (wlen > 0) {
            wtitle.resize(static_cast<size_t>(wlen) - 1);
            MultiByteToWideChar(CP_UTF8, 0, first->valuestring, -1, &wtitle[0], wlen);
        }
    }
    cJSON_Delete(args);

    wchar_t path[MAX_PATH * 4] = {0};
    OPENFILENAMEW ofn = {0};
    ofn.lStructSize = sizeof ofn;
    ofn.hwndOwner = static_cast<HWND>(webview_get_window(w));
    ofn.lpstrFile = path;
    ofn.nMaxFile = static_cast<DWORD>(sizeof path / sizeof path[0]);
    ofn.lpstrFilter = L"Todos los archivos\0*.*\0\0";
    ofn.lpstrTitle = wtitle.empty() ? nullptr : wtitle.c_str();
    // NOCHANGEDIR: the dialog must not move the process working directory —
    // driver plugins are resolved relative to it.
    ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_EXPLORER | OFN_NOCHANGEDIR;

    std::string result = "null";
    if (GetOpenFileNameW(&ofn)) {
        int len = WideCharToMultiByte(CP_UTF8, 0, path, -1, nullptr, 0, nullptr, nullptr);
        if (len > 0) {
            std::string utf8(static_cast<size_t>(len) - 1, '\0');
            WideCharToMultiByte(CP_UTF8, 0, path, -1, &utf8[0], len, nullptr, nullptr);
            cJSON *str = cJSON_CreateString(utf8.c_str());
            char *json = cJSON_PrintUnformatted(str);
            if (json != nullptr) {
                result = json;
                cJSON_free(json);
            }
            cJSON_Delete(str);
        }
    }
    webview_return(w, id, 0, result.c_str());
}

// Payload handed from the download worker back to the UI thread.
struct UpdateResult {
    webview_t w;
    std::string id;
    bool ok;
    std::wstring path;
};

/*
 * Hand the MSI to Windows Installer through something that OUTLIVES us, and
 * start the app again when it is done (issue #485).
 *
 * The app has to quit for the install — a running squaero.exe cannot be
 * replaced — so whatever reopens it cannot be the app itself. It is a detached
 * cmd, which lives outside the install directory and therefore does not block
 * the very upgrade it is waiting for: it runs msiexec, waits for it, and then
 * starts the exe again from the path this process was running from, which is
 * the path the upgrade replaces in place.
 *
 * `&`, not `&&`: an install the user cancels, or one that fails, still has to
 * give the app back. From here it closed for an update, and coming back is the
 * end of that sentence either way.
 *
 * The quoting is cmd's `/s` rule — the first quote after /c and the last one are
 * stripped, everything between is taken verbatim — which is what keeps a path
 * with spaces in one piece. Falls back to the old behaviour (open the MSI, do
 * not come back) if the process cannot be created: installing and not
 * reopening beats not installing.
 */
static void install_and_reopen(const std::wstring &msi)
{
    wchar_t exe[MAX_PATH];
    DWORD n = GetModuleFileNameW(nullptr, exe, MAX_PATH);
    if (n == 0 || n >= MAX_PATH) {
        ShellExecuteW(nullptr, L"open", msi.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
        return;
    }
    std::wstring cmd = L"cmd.exe /s /c \"msiexec.exe /i \"" + msi + L"\" & start \"\" \"" +
                       std::wstring(exe) + L"\"\"";
    STARTUPINFOW si{};
    si.cb = sizeof si;
    PROCESS_INFORMATION pi{};
    if (CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW,
                       nullptr, nullptr, &si, &pi)) {
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
        return;
    }
    ShellExecuteW(nullptr, L"open", msi.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
}

// UI thread: resolve/reject the JS promise; on success install and quit (a
// running squaero.exe would block the installer from replacing it), leaving
// behind the process that opens the app again afterwards.
static void finish_update(webview_t w, void *arg)
{
    auto *r = static_cast<UpdateResult *>(arg);
    if (r->ok) {
        webview_return(w, r->id.c_str(), 0, "{\"ok\":true}");
        install_and_reopen(r->path);
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

#if defined(__linux__) || defined(__APPLE__)
// The Linux and macOS counterparts of the Windows bridges above (issue #40).
// There is no quaeroDownloadAndInstall: a .deb or a .dmg is not updated in
// place, so the update modal sends the user to the release page instead.

// Bridge: window.quaeroOpenExternal(url) — http(s) only, through GIO (which
// asks the desktop, or its portal, for the default browser) or NSWorkspace.
static void open_external_handler(const char *id, const char *req, void *arg)
{
    auto w = static_cast<webview_t>(arg);
    std::string url = first_string_arg(req);
    if (url.rfind("https://", 0) == 0 || url.rfind("http://", 0) == 0) {
#if defined(__APPLE__)
        mac_open_url(url.c_str());
#else
        g_app_info_launch_default_for_uri(url.c_str(), nullptr, nullptr);
#endif
    }
    webview_return(w, id, 0, "null");
}

// A chosen path as the bridge's JSON result: a JSON string, or null.
static std::string path_result(const char *path)
{
    std::string result = "null";
    if (path != nullptr) {
        cJSON *str = cJSON_CreateString(path);
        char *json = cJSON_PrintUnformatted(str);
        if (json != nullptr) {
            result = json;
            cJSON_free(json);
        }
        cJSON_Delete(str);
    }
    return result;
}

#if defined(__linux__)
// --- Browser behaviours out of the WebKitGTK window (issue #685) ---------------

// decide-policy: refuse any navigation that is not the app's own page — a file
// dropped on the window would otherwise replace the UI with that file.
static gboolean on_decide_policy(WebKitWebView *, WebKitPolicyDecision *decision,
                                 WebKitPolicyDecisionType type, gpointer)
{
    if (type != WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION &&
        type != WEBKIT_POLICY_DECISION_TYPE_NEW_WINDOW_ACTION) {
        return FALSE;
    }
    WebKitNavigationAction *action = webkit_navigation_policy_decision_get_navigation_action(
        WEBKIT_NAVIGATION_POLICY_DECISION(decision));
    const char *uri = webkit_uri_request_get_uri(webkit_navigation_action_get_request(action));
    if (uri != nullptr && is_app_navigation(uri)) {
        return FALSE;
    }
    std::fprintf(stderr, "Squaero: blocked navigation to %s\n", uri != nullptr ? uri : "?");
    webkit_policy_decision_ignore(decision);
    return TRUE;
}

static void apply_browser_settings(webview_t w)
{
    auto *view = static_cast<WebKitWebView *>(
        webview_get_native_handle(w, WEBVIEW_NATIVE_HANDLE_KIND_BROWSER_CONTROLLER));
    if (view == nullptr) {
        return;
    }
    // WebKitGTK binds no reload/print/zoom/back keys of its own (those are the
    // browser's, not the engine's); developer extras follow webview_create's
    // debug flag. What the engine does do on its own is navigate.
    g_signal_connect(view, "decide-policy", G_CALLBACK(on_decide_policy), nullptr);
}

// --- Remembered window size (issue #685) ---------------------------------------
//
// $XDG_CONFIG_HOME/squaero/window, "x y w h max" (window_state.h). Size and
// maximised state only: GTK4 has no window positioning (Wayland), so x and y are
// written as 0 and ignored.

static char *window_state_file()
{
    return g_build_filename(g_get_user_config_dir(), "squaero", "window", nullptr);
}

static void save_window_state(GtkWindow *win)
{
    int width = 0;
    int height = 0;
#if GTK_MAJOR_VERSION >= 4
    // The un-maximised size GTK keeps up to date as the user resizes — the value
    // its documentation says to save and feed back to set_default_size.
    gtk_window_get_default_size(win, &width, &height);
#else
    // ponytail: on GTK3 a maximised window reports its maximised size here;
    // restoring then un-maximising gives a large window. Track the last
    // un-maximised size on configure-event if that ever matters.
    gtk_window_get_size(win, &width, &height);
#endif
    quaero_window_state s = {0, 0, width, height, gtk_window_is_maximized(win) ? 1 : 0};
    char line[64];
    if (quaero_window_state_format(&s, line, sizeof line) == 0) {
        return;
    }
    char *file = window_state_file();
    char *dir = g_path_get_dirname(file);
    if (g_mkdir_with_parents(dir, 0700) == 0) {
        g_file_set_contents(file, line, -1, nullptr);
    }
    g_free(dir);
    g_free(file);
}

#if GTK_MAJOR_VERSION >= 4
static gboolean on_close_request(GtkWindow *win, gpointer)
{
    save_window_state(win);
    return FALSE;  // keep closing
}
#else
static gboolean on_delete_event(GtkWidget *win, GdkEvent *, gpointer)
{
    save_window_state(GTK_WINDOW(win));
    return FALSE;  // keep closing
}
#endif

static void restore_window_state(GtkWindow *win)
{
    quaero_window_state s;
    char *file = window_state_file();
    char *text = nullptr;
    bool have = g_file_get_contents(file, &text, nullptr, nullptr) &&
                quaero_window_state_parse(text, &s) != 0;
    g_free(text);
    g_free(file);
    if (have) {
        gtk_window_set_default_size(win, s.width, s.height);
    }
    if (!have || s.maximized) {
        gtk_window_maximize(win);
    }
#if GTK_MAJOR_VERSION >= 4
    g_signal_connect(win, "close-request", G_CALLBACK(on_close_request), nullptr);
#else
    g_signal_connect(win, "delete-event", G_CALLBACK(on_delete_event), nullptr);
#endif
}

// --- The GTK menu bar (issue #686) ---------------------------------------------
//
// webview puts the WebKitWebView straight into the window; the menu bar needs a
// row above it, so once, at startup, the view moves into a vertical box. From
// then on apply_menu_bar swaps the bar at the top of that box: GtkMenuBar on
// GTK3, a GtkPopoverMenuBar over a GMenuModel with one GSimpleAction per item
// on GTK4. The accelerators are shown (gtk_accel_label_set_accel / the "accel"
// attribute) but bound to nothing: the keys stay the UI's.

static GtkWidget *g_menu_box = nullptr;
static GtkWidget *g_menu_bar = nullptr;

static void install_menu_host(GtkWindow *win)
{
#if GTK_MAJOR_VERSION >= 4
    GtkWidget *view = gtk_window_get_child(win);
    if (view == nullptr) {
        return;
    }
    g_object_ref(view);
    gtk_window_set_child(win, nullptr);
    g_menu_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_widget_set_vexpand(view, TRUE);
    gtk_box_append(GTK_BOX(g_menu_box), view);
    gtk_window_set_child(win, g_menu_box);
    g_object_unref(view);
#else
    GtkWidget *view = gtk_bin_get_child(GTK_BIN(win));
    if (view == nullptr) {
        return;
    }
    g_object_ref(view);
    gtk_container_remove(GTK_CONTAINER(win), view);
    g_menu_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_box_pack_start(GTK_BOX(g_menu_box), view, TRUE, TRUE, 0);
    gtk_container_add(GTK_CONTAINER(win), g_menu_box);
    gtk_widget_show_all(g_menu_box);
    g_object_unref(view);
#endif
}

#if GTK_MAJOR_VERSION >= 4
static void on_menu_action(GSimpleAction *, GVariant *, gpointer data)
{
    run_menu_action(GPOINTER_TO_SIZE(data));
}

static GtkWidget *build_menu_bar(GtkWindow *win, const quaero_menu &m)
{
    GMenu *bar = g_menu_new();
    GMenu *sub = nullptr;
    GMenu *section = nullptr;  // a separator in a GMenuModel is a new section
    GSimpleActionGroup *group = g_simple_action_group_new();
    for (size_t i = 0; i < m.count; i++) {
        const quaero_menu_entry &e = m.entries[i];
        if (e.kind == QUAERO_MENU_TOP) {
            sub = g_menu_new();
            section = g_menu_new();
            g_menu_append_section(sub, nullptr, G_MENU_MODEL(section));
            g_menu_append_submenu(bar, e.label, G_MENU_MODEL(sub));
            g_object_unref(section);
            g_object_unref(sub);
        } else if (sub == nullptr) {
            continue;
        } else if (e.kind == QUAERO_MENU_SEPARATOR) {
            section = g_menu_new();
            g_menu_append_section(sub, nullptr, G_MENU_MODEL(section));
            g_object_unref(section);
        } else {
            char name[32];
            std::snprintf(name, sizeof name, "i%zu", i);
            GSimpleAction *action = g_simple_action_new(name, nullptr);
            g_simple_action_set_enabled(action, e.enabled ? TRUE : FALSE);
            g_signal_connect(action, "activate", G_CALLBACK(on_menu_action), GSIZE_TO_POINTER(i));
            g_action_map_add_action(G_ACTION_MAP(group), G_ACTION(action));
            g_object_unref(action);

            std::string detailed = std::string("menu.") + name;
            GMenuItem *item = g_menu_item_new(e.label, detailed.c_str());
            char accel[64];
            if (e.accel != nullptr && quaero_menu_accel_gtk(e.accel, accel, sizeof accel) > 0) {
                g_menu_item_set_attribute(item, "accel", "s", accel);
            }
            g_menu_append_item(section, item);
            g_object_unref(item);
        }
    }
    // Replaces the previous model's group under the same prefix.
    gtk_widget_insert_action_group(GTK_WIDGET(win), "menu", G_ACTION_GROUP(group));
    g_object_unref(group);
    GtkWidget *widget = gtk_popover_menu_bar_new_from_model(G_MENU_MODEL(bar));
    g_object_unref(bar);
    return widget;
}
#else
static void on_menu_item(GtkMenuItem *, gpointer data)
{
    run_menu_action(GPOINTER_TO_SIZE(data));
}

static GtkWidget *build_menu_bar(GtkWindow *, const quaero_menu &m)
{
    GtkWidget *bar = gtk_menu_bar_new();
    GtkWidget *sub = nullptr;
    for (size_t i = 0; i < m.count; i++) {
        const quaero_menu_entry &e = m.entries[i];
        if (e.kind == QUAERO_MENU_TOP) {
            GtkWidget *top = gtk_menu_item_new_with_label(e.label);
            sub = gtk_menu_new();
            gtk_menu_item_set_submenu(GTK_MENU_ITEM(top), sub);
            gtk_menu_shell_append(GTK_MENU_SHELL(bar), top);
        } else if (sub == nullptr) {
            continue;
        } else if (e.kind == QUAERO_MENU_SEPARATOR) {
            gtk_menu_shell_append(GTK_MENU_SHELL(sub), gtk_separator_menu_item_new());
        } else {
            GtkWidget *item = gtk_menu_item_new_with_label(e.label);
            char accel[64];
            if (e.accel != nullptr && quaero_menu_accel_gtk(e.accel, accel, sizeof accel) > 0) {
                guint key = 0;
                GdkModifierType mods = static_cast<GdkModifierType>(0);
                gtk_accelerator_parse(accel, &key, &mods);
                GtkWidget *label = gtk_bin_get_child(GTK_BIN(item));
                if (key != 0 && GTK_IS_ACCEL_LABEL(label)) {
                    gtk_accel_label_set_accel(GTK_ACCEL_LABEL(label), key, mods);
                }
            }
            gtk_widget_set_sensitive(item, e.enabled ? TRUE : FALSE);
            g_signal_connect(item, "activate", G_CALLBACK(on_menu_item), GSIZE_TO_POINTER(i));
            gtk_menu_shell_append(GTK_MENU_SHELL(sub), item);
        }
    }
    gtk_widget_show_all(bar);
    return bar;
}
#endif

/* Put the current model's bar at the top of the box; an empty model leaves the
   box with the view alone (the bar hidden, as the setting asks). */
static void apply_menu_bar(GtkWindow *win)
{
    if (g_menu_box == nullptr) {
        return;
    }
    if (g_menu_bar != nullptr) {
#if GTK_MAJOR_VERSION >= 4
        gtk_box_remove(GTK_BOX(g_menu_box), g_menu_bar);
#else
        gtk_widget_destroy(g_menu_bar);
#endif
        g_menu_bar = nullptr;
    }
    if (g_menu.count == 0) {
        return;
    }
    g_menu_bar = build_menu_bar(win, g_menu);
#if GTK_MAJOR_VERSION >= 4
    gtk_box_prepend(GTK_BOX(g_menu_box), g_menu_bar);
#else
    gtk_box_pack_start(GTK_BOX(g_menu_box), g_menu_bar, FALSE, FALSE, 0);
    gtk_box_reorder_child(GTK_BOX(g_menu_box), g_menu_bar, 0);
#endif
}
#endif

#if defined(__APPLE__)
// Bridge: window.quaeroPickFile(title) — NSOpenPanel, modal to the app.
static void pick_file_handler(const char *id, const char *req, void *arg)
{
    auto w = static_cast<webview_t>(arg);
    std::string title = first_string_arg(req);
    std::string path;
    bool picked = mac_pick_file(title.c_str(), path);
    webview_return(w, id, 0, path_result(picked ? path.c_str() : nullptr).c_str());
}
#elif GTK_MAJOR_VERSION >= 4
struct PickFileCtx {
    webview_t w;
    std::string id;
};

// GTK: the dialog finished — resolve with the chosen path, or null on cancel.
static void pick_file_done(GObject *source, GAsyncResult *res, gpointer data)
{
    auto *ctx = static_cast<PickFileCtx *>(data);
    char *path = nullptr;
    GFile *file = gtk_file_dialog_open_finish(GTK_FILE_DIALOG(source), res, nullptr);
    if (file != nullptr) {
        path = g_file_get_path(file);
        g_object_unref(file);
    }
    webview_return(ctx->w, ctx->id.c_str(), 0, path_result(path).c_str());
    g_free(path);
    g_object_unref(source);
    delete ctx;
}

// Bridge: window.quaeroPickFile(title) — the GTK file dialog (4.10+), modal to
// the app window; resolves asynchronously, so the UI thread never blocks.
static void pick_file_handler(const char *id, const char *req, void *arg)
{
    auto w = static_cast<webview_t>(arg);
    std::string title = first_string_arg(req);
    GtkFileDialog *dialog = gtk_file_dialog_new();
    if (!title.empty()) {
        gtk_file_dialog_set_title(dialog, title.c_str());
    }
    gtk_file_dialog_open(dialog, GTK_WINDOW(webview_get_window(w)), nullptr,
                         pick_file_done, new PickFileCtx{w, id});
}
#else
// GTK 3, for WebKitGTK 4.1 — the snap (issue #40): its GNOME 46 platform ships
// no WebKitGTK 6.0. The native chooser goes through the desktop portal when
// confined, which is how a snap reaches files outside its sandbox. It runs a
// nested main loop, so the window stays painted while it is open.
static void pick_file_handler(const char *id, const char *req, void *arg)
{
    auto w = static_cast<webview_t>(arg);
    std::string title = first_string_arg(req);
    GtkFileChooserNative *dialog = gtk_file_chooser_native_new(
        title.empty() ? nullptr : title.c_str(), GTK_WINDOW(webview_get_window(w)),
        GTK_FILE_CHOOSER_ACTION_OPEN, nullptr, nullptr);
    char *path = nullptr;
    if (gtk_native_dialog_run(GTK_NATIVE_DIALOG(dialog)) == GTK_RESPONSE_ACCEPT) {
        path = gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dialog));
    }
    webview_return(w, id, 0, path_result(path).c_str());
    g_free(path);
    g_object_unref(dialog);
}
#endif
#endif

// --- Shell bindings the UI drives (issue #685) ---------------------------------
//
// Not IPC: nothing here reaches the core. These are the window's own chrome,
// which only the UI knows the state of (its theme, what it is showing).

// Bridge: window.quaeroSetTitle(title) — the native window title. Empty falls
// back to the product name, so the title bar is never blank.
static void set_title_handler(const char *id, const char *req, void *arg)
{
    auto w = static_cast<webview_t>(arg);
    std::string title = first_string_arg(req);
    webview_set_title(w, title.empty() ? "Squaero" : title.c_str());
    webview_return(w, id, 0, "null");
}

// Bridge: window.quaeroSetTheme("dark" | "light") — the title bar (and on
// Linux the GTK chrome) follows the theme the UI resolved. Anything that is not
// "dark" is light.
static void set_theme_handler(const char *id, const char *req, void *arg)
{
    auto w = static_cast<webview_t>(arg);
    const bool dark = first_string_arg(req) == "dark";
#if defined(_WIN32)
    apply_title_bar_theme(static_cast<HWND>(webview_get_window(w)), dark);
#elif defined(__linux__)
    g_object_set(gtk_settings_get_default(), "gtk-application-prefer-dark-theme",
                 dark ? TRUE : FALSE, nullptr);
#elif defined(__APPLE__)
    mac_set_dark(webview_get_window(w), dark);
#endif
    webview_return(w, id, 0, "null");
}

#if defined(_WIN32) || defined(__linux__)
// Bridge: window.quaeroSetMenu(json) — the native menu bar (issue #686), built
// from the model the UI sends (menu_model.h); "[]" takes the bar away. A model
// the parser refuses is reported and the bar is left as it was — never half a
// menu. Resolves to true when applied, false when refused.
static void set_menu_handler(const char *id, const char *req, void *arg)
{
    auto w = static_cast<webview_t>(arg);
    quaero_menu next;
    if (!quaero_menu_parse(first_string_arg(req).c_str(), &next)) {
        std::fprintf(stderr, "Squaero: ignored a malformed menu model\n");
        webview_return(w, id, 0, "false");
        return;
    }
    quaero_menu_free(&g_menu);
    g_menu = next;
    g_menu_webview = w;
#if defined(_WIN32)
    apply_menu_bar(static_cast<HWND>(webview_get_window(w)));
#else
    apply_menu_bar(GTK_WINDOW(webview_get_window(w)));
#endif
    webview_return(w, id, 0, "true");
}
#endif

#if defined(_WIN32)
// Carrying the user's data across the rename (issues #466, #476).
//
// With no user-data folder given, WebView2 derives one from the EXE FILE NAME:
// %APPDATA%\quaero.exe\EBWebView. Renaming the executable therefore opens a
// BRAND NEW, EMPTY profile — and localStorage lives in that profile, so every
// connection, snippet, notebook and setting is still on disk under a name
// nothing reads any more, which looks exactly like the app wiping itself.
//
// v0.23.0 tried to take the folder over with WEBVIEW2_USER_DATA_FOLDER and
// migrate into it. That variable is read by the WebView2 LOADER DLL, and this
// app links the runtime directly — so it was honoured on a dev machine where a
// stray loader was on the search path, and ignored by the installed build,
// which is the one that mattered. The data was copied into a folder the app
// never opened. Do not fight the runtime: copy into the path it actually picks.
//
// Only `Local Storage` moves: it is the ~90 KB that IS the user's data, against
// 80 MB of Chromium cache that regenerates itself. The old folder is left
// untouched — it costs nothing as a fallback, and deleting someone's data is not
// a decision an upgrade should make.
static void migrate_user_data()
{
    wchar_t appdata[MAX_PATH];
    if (!SUCCEEDED(SHGetFolderPathW(nullptr, CSIDL_APPDATA, nullptr, 0, appdata))) {
        return;  // no roaming profile: nothing to migrate from or to
    }
    const std::wstring base = std::wstring(appdata);
    const std::wstring mine = base + L"\\squaero.exe\\EBWebView\\Default";
    const std::wstring marker = base + L"\\squaero.exe\\migrated-from-quaero";
    const std::wstring theirs = base + L"\\quaero.exe\\EBWebView\\Default\\Local Storage";

    // Done once, ever. The marker is what says so — not the presence of the
    // destination, which the app itself creates on its first launch.
    if (GetFileAttributesW(marker.c_str()) != INVALID_FILE_ATTRIBUTES) {
        return;
    }
    if (GetFileAttributesW(theirs.c_str()) == INVALID_FILE_ATTRIBUTES) {
        return;  // nothing from the old name: a fresh install
    }

    // Never overwrite a profile that has real data of its own. A leveldb only
    // writes .ldb files once it has compacted, so their presence means this
    // install has been used for a while — at which point the old profile is the
    // stale one and taking it back would be the destructive move.
    WIN32_FIND_DATAW found;
    const std::wstring compacted = mine + L"\\Local Storage\\leveldb\\*.ldb";
    HANDLE h = FindFirstFileW(compacted.c_str(), &found);
    if (h != INVALID_HANDLE_VALUE) {
        FindClose(h);
        return;
    }

    SHCreateDirectoryExW(nullptr, mine.c_str(), nullptr);
    // SHFileOperationW wants double-NUL-terminated path lists.
    std::wstring from = theirs;
    from.push_back(L'\0');
    std::wstring to = mine;
    to.push_back(L'\0');
    SHFILEOPSTRUCTW op = {};
    op.wFunc = FO_COPY;
    op.pFrom = from.c_str();
    op.pTo = to.c_str();
    op.fFlags = FOF_NO_UI;
    if (SHFileOperationW(&op) == 0 && !op.fAnyOperationsAborted) {
        // The marker also stops a second attempt from undoing work done since.
        HANDLE mk = CreateFileW(marker.c_str(), GENERIC_WRITE, 0, nullptr,
                                CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (mk != INVALID_HANDLE_VALUE) {
            CloseHandle(mk);
        }
        std::printf("Squaero: carried the previous profile's data over from "
                    "%%APPDATA%%\\quaero.exe (the old folder is left as it is)\n");
    } else {
        std::fprintf(stderr,
                     "Squaero: could not carry over the previous profile; the "
                     "app starts with empty settings and the old data is still "
                     "in %%APPDATA%%\\quaero.exe\n");
    }
}
#endif

int main()
{
    // Unbuffered stdout so startup diagnostics are visible even when the
    // shell's output is redirected to a file or journal.
    std::setvbuf(stdout, nullptr, _IONBF, 0);

    std::printf("Squaero %s — starting webview shell\n", dbcore_version());

#if defined(_WIN32)
    // MUST run before webview_create: it fills the profile the WebView2
    // environment is about to open, and the user's data lives in that profile.
    migrate_user_data();
#elif defined(__linux__)
    // The Wayland app id and X11 WM_CLASS: what ties the window to
    // squaero.desktop, and so to its icon and its launcher entry.
    g_set_prgname("squaero");
#endif

    // Register driver plugins before the UI opens so conn.open can resolve them.
    load_drivers();

    // Developer tools (F12 / inspector) only in a Debug build (issue #685).
#if defined(QUAERO_DEV_TOOLS)
    const int dev_tools = 1;
#else
    const int dev_tools = 0;
#endif
    webview_t w = webview_create(dev_tools, nullptr);
    if (w == nullptr) {
        // This is a GUI-subsystem process: stderr goes nowhere, so a bare exit
        // looks to the user like nothing happened at all (reported from a fresh
        // Windows Sandbox). On a clean machine the reason is practically always
        // a missing Edge WebView2 runtime, so say so where it can be read.
#if defined(_WIN32)
        MessageBoxW(nullptr,
                    L"Squaero no pudo abrir su ventana.\n\n"
                    L"Suele faltar el entorno de ejecucion WebView2 de "
                    L"Microsoft Edge. Instalalo desde\n\n"
                    L"https://go.microsoft.com/fwlink/p/?LinkId=2124703\n\n"
                    L"y vuelve a abrir Squaero.",
                    L"Squaero", MB_OK | MB_ICONERROR);
#endif
        std::fprintf(stderr,
                     "Squaero: failed to create the webview window "
                     "(is the WebView2/WebKit runtime available?)\n");
        return 1;
    }
    webview_set_title(w, "Squaero");
#if defined(_WIN32)
    apply_window_icon(w);
    apply_startup_background(w);
    apply_browser_settings(w);
#elif defined(__linux__)
    apply_browser_settings(w);
#elif defined(__APPLE__)
    mac_harden_webview(
        webview_get_native_handle(w, WEBVIEW_NATIVE_HANDLE_KIND_BROWSER_CONTROLLER),
        [](const char *uri) { return is_app_navigation(uri); });
#endif
    // The default size is what "restore" gives back when nothing was remembered
    // (and what the first launch opens maximised from).
    webview_set_size(w, 1100, 720, WEBVIEW_HINT_NONE);
#if defined(_WIN32)
    if (HWND hwnd = static_cast<HWND>(webview_get_window(w))) {
        // The title bar follows the system until the UI reports its theme.
        apply_title_bar_theme(hwnd, !system_prefers_light());
        restore_window_state(hwnd);
        watch_window_close(hwnd);
    }
#elif defined(__linux__)
    gtk_window_set_default_icon_name("squaero");
    restore_window_state(GTK_WINDOW(webview_get_window(w)));
    install_menu_host(GTK_WINDOW(webview_get_window(w)));
#elif defined(__APPLE__)
    mac_setup_app(webview_get_window(w));
#endif
    webview_bind(w, "quaeroRpc", rpc_handler, w);
#if defined(_WIN32) || defined(__linux__) || defined(__APPLE__)
    webview_bind(w, "quaeroOpenExternal", open_external_handler, w);
    webview_bind(w, "quaeroPickFile", pick_file_handler, w);
#endif
    webview_bind(w, "quaeroSetTitle", set_title_handler, w);
    webview_bind(w, "quaeroSetTheme", set_theme_handler, w);
#if defined(_WIN32) || defined(__linux__)
    // macOS keeps its AppKit menu (macos.mm): the binding's absence is how the
    // UI knows there is no bar of its own to fill or hide there.
    webview_bind(w, "quaeroSetMenu", set_menu_handler, w);
#endif
#if defined(_WIN32)
    webview_bind(w, "quaeroDownloadAndInstall", download_install_handler, w);
#endif

    // Start the RPC worker so queries run off the UI thread (the window stays
    // responsive and op.cancel can interrupt a slow query).
    g_rpc_worker = std::thread(rpc_worker_loop);

    // Load the embedded, self-contained frontend bundle (persistent origin on
    // Windows and Linux; set_html fallback otherwise).
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
#if defined(_WIN32) || defined(__linux__)
    quaero_menu_free(&g_menu);
#endif

    for (dbc_plugin *plugin : g_plugins) {
        dbc_plugin_unload(plugin);
    }
    g_plugins.clear();
    return 0;
}
