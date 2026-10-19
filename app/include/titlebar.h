/* The app's own title bar (issue #688): the window chrome the UI draws in
   place of the system's on Windows and macOS. The UI drives it through one
   binding, quaeroWindow(command, ...args), and gets the window's state back:

     quaeroWindow("state")                  -> {"os":..,"frameless":..,"maximized":..,"backdrop":..}
     quaeroWindow("frameless", true|false)  persist + apply the user's choice
     quaeroWindow("backdrop", true|false)   Mica behind the page, if the system has it
     quaeroWindow("minimize" | "maximize" | "close")
     quaeroWindow("drag")                   start moving the window (mouse down on the bar)
     quaeroWindow("double-click")           what a title bar double click does
     quaeroWindow("system-menu")            the window menu at the cursor (Windows)
     quaeroWindow("snap", x, y, w, h)       where the maximize button is, CSS px (Windows)

   Pure pieces only — parsing, geometry, the state line — so they are tested
   without a window; the shell (main.cc, macos.mm) applies them. */
#ifndef QUAERO_APP_TITLEBAR_H
#define QUAERO_APP_TITLEBAR_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum quaero_window_command {
    QUAERO_WINDOW_UNKNOWN = 0,
    QUAERO_WINDOW_STATE,
    QUAERO_WINDOW_FRAMELESS,
    QUAERO_WINDOW_MINIMIZE,
    QUAERO_WINDOW_MAXIMIZE, /* toggles: maximize, or restore when maximized */
    QUAERO_WINDOW_CLOSE,
    QUAERO_WINDOW_DRAG,
    QUAERO_WINDOW_DOUBLE_CLICK,
    QUAERO_WINDOW_SYSTEM_MENU,
    QUAERO_WINDOW_SNAP,
    QUAERO_WINDOW_BACKDROP
} quaero_window_command;

/* The command named by `name`; QUAERO_WINDOW_UNKNOWN for NULL or anything else. */
quaero_window_command quaero_window_command_parse(const char *name);

typedef struct quaero_rect {
    int x;
    int y;
    int width;
    int height;
} quaero_rect;

/* A rectangle in CSS px (what getBoundingClientRect gives the UI) in device
   px at `dpi` (96 = 100 %). Edges are rounded, not sizes, so two buttons that
   touch in CSS still touch on screen. A negative size becomes 0; dpi 0 is 96. */
quaero_rect quaero_rect_to_device(double x, double y, double width, double height,
                                  unsigned dpi);

/* Which part of the top resize band a point is on. The band is the strip the
   frameless window's top edge resizes from; its two ends are the corners. */
typedef enum quaero_top_hit {
    QUAERO_TOP_EDGE = 0,
    QUAERO_TOP_LEFT_CORNER,
    QUAERO_TOP_RIGHT_CORNER
} quaero_top_hit;

/* `x` across a band `width` wide whose corners are `corner` wide. */
quaero_top_hit quaero_top_band_hit(int x, int width, int corner);

/* The remembered choice, one line: "custom" (the app's own title bar) or
   "system". Returns 1 or 0; anything else — NULL, empty, junk — is the
   default, the app's own (1). Surrounding whitespace is fine. */
int quaero_titlebar_parse_mode(const char *text);

/* The choice as the line the file holds: "custom\n" or "system\n". */
const char *quaero_titlebar_format_mode(int custom);

/* The state the binding resolves to, as JSON:
   {"os":"windows","frameless":true,"maximized":false,"backdrop":"mica"}.
   `os` and `backdrop` are short ASCII identifiers the shell passes in.
   Returns the characters written (no NUL), 0 when buf is NULL/too small or a
   string is NULL. 128 bytes always suffice for the shell's values. */
size_t quaero_window_state_json(const char *os, int frameless, int maximized,
                                const char *backdrop, char *buf, size_t cap);

#ifdef __cplusplus
}
#endif

#endif
