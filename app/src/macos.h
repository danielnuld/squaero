// macOS helpers for the shell (issue #40), implemented in macos.mm.
#ifndef QUAERO_APP_MACOS_H
#define QUAERO_APP_MACOS_H

#include <cstring>
#include <string>

#include "menu_model.h"

// Write the UI to ~/Library/Application Support/Squaero/ui/index.html and
// return its file:// URL, or empty on failure.
std::string mac_write_ui(const char *html);

// Open an http(s) URL in the default browser.
void mac_open_url(const char *url);

// Modal open panel; true with the chosen path, false on cancel.
bool mac_pick_file(const char *title, std::string &path);

// The menu bar (app menu + Edit, which is what makes Cmd+C/V/A work in the
// web view), the window frame — the one remembered from the last run, else the
// whole screen — and the app brought to the front (issues #40, #685).
// `window` is the NSWindow* behind webview_get_window.
void mac_setup_app(void *window);

// The menu bar from the UI's model (A-11). The first menu is the app menu.
// Ids AppKit answers itself become native items with their standard keys —
// "edit:*" (menu_model.h) the Edit roles on the first responder, "mac:hide",
// "mac:hide-others", "mac:show-all" and "quit" — and "act:settings" gets
// Cmd+,. Every other item calls on_item with its index in the model and shows
// no key: the UI handles its own keys. An empty model leaves the bar as is.
void mac_set_menu(const quaero_menu &menu, void (*on_item)(size_t index));

// Browser behaviours out of the WKWebView (issue #685): no pinch zoom, no swipe
// back/forward, and a navigation delegate that lets through only what `allow`
// accepts (the app's own page) — a dropped file never replaces the UI.
// `webview` is the WKWebView* behind WEBVIEW_NATIVE_HANDLE_KIND_BROWSER_CONTROLLER.
void mac_harden_webview(void *webview, bool (*allow)(const char *uri));

// Title bar (window appearance) following the UI theme (issue #685).
void mac_set_dark(void *window, bool dark);

// The app's own title bar (issue #688): a transparent, full-size-content
// title bar — the traffic lights stay, over the UI's bar — or the system's.
// The choice is remembered in the user defaults; mac_setup_app applies it.
void mac_set_frameless(void *window, bool on);
bool mac_is_frameless(void *window);
bool mac_is_zoomed(void *window);

// The window commands the UI's bar sends (titlebar.h): minimize, zoom,
// close, drag (the press in progress moves the window) and the title bar
// double click, which does what System Settings says (zoom, minimize or
// nothing).
void mac_window_minimize(void *window);
void mac_window_zoom(void *window);
void mac_window_close(void *window);
void mac_window_drag(void *window);
void mac_window_double_click(void *window);

#endif
