// macOS helpers for the shell (issue #40), implemented in macos.mm.
#ifndef QUAERO_APP_MACOS_H
#define QUAERO_APP_MACOS_H

#include <cstring>
#include <string>

// Write the UI to ~/Library/Application Support/Squaero/ui/index.html and
// return its file:// URL, or empty on failure.
std::string mac_write_ui(const char *html);

// Open an http(s) URL in the default browser.
void mac_open_url(const char *url);

// Modal open panel; true with the chosen path, false on cancel.
bool mac_pick_file(const char *title, std::string &path);

// The menu bar (app menu + Edit, which is what makes Cmd+C/V/A work in the
// web view), the window filling the screen, and the app brought to the front.
// `window` is the NSWindow* behind webview_get_window.
void mac_setup_app(void *window);

#endif
