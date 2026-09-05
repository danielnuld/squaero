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
#include <commdlg.h>
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
        webview_navigate(w, "https://quaero.local/index.html");
        std::printf("Squaero: UI served from https://quaero.local (persistent)\n");
        return;
    } while (0);
    std::fprintf(stderr,
                 "Squaero: virtual-host setup failed; falling back to set_html "
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

/* The app's own --bg, picked from the system light/dark preference — which is
   also what the interface itself defaults to, so the two agree. */
static COLORREF startup_background(void)
{
    DWORD light = 0;
    DWORD size = sizeof light;
    LSTATUS st = RegGetValueW(
        HKEY_CURRENT_USER,
        L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
        L"AppsUseLightTheme", RRF_RT_REG_DWORD, nullptr, &light, &size);
    if (st == ERROR_SUCCESS && light != 0) {
        return RGB(0xf7, 0xf7, 0xfa);  /* light theme --bg */
    }
    return RGB(0x1e, 0x1e, 0x24);      /* dark theme --bg (the default) */
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

// UI thread: resolve/reject the JS promise; on success launch the MSI and quit
// (a running squaero.exe would block the installer from replacing it).
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
#endif

    // Register driver plugins before the UI opens so conn.open can resolve them.
    load_drivers();

    webview_t w = webview_create(0, nullptr);
    if (w == nullptr) {
        std::fprintf(stderr,
                     "Squaero: failed to create the webview window "
                     "(is the WebView2/WebKit runtime available?)\n");
        return 1;
    }
    webview_set_title(w, "Squaero");
#if defined(_WIN32)
    apply_window_icon(w);
    apply_startup_background(w);
#endif
    webview_set_size(w, 1100, 720, WEBVIEW_HINT_NONE);
#if defined(_WIN32)
    // Start maximised. The chrome above and below the grid is a fixed ~495 px,
    // so at 1100x720 the data — the reason the window is open — is under a
    // third of it. The size above still decides what "restore" gives back.
    if (HWND hwnd = static_cast<HWND>(webview_get_window(w))) {
        ShowWindow(hwnd, SW_MAXIMIZE);
    }
#endif
    webview_bind(w, "quaeroRpc", rpc_handler, w);
#if defined(_WIN32)
    webview_bind(w, "quaeroOpenExternal", open_external_handler, w);
    webview_bind(w, "quaeroPickFile", pick_file_handler, w);
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
