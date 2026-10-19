#include "titlebar.h"

#include <ctype.h>
#include <stdio.h>
#include <string.h>

quaero_window_command quaero_window_command_parse(const char *name)
{
    static const struct {
        const char *name;
        quaero_window_command cmd;
    } k_commands[] = {
        {"state", QUAERO_WINDOW_STATE},
        {"frameless", QUAERO_WINDOW_FRAMELESS},
        {"minimize", QUAERO_WINDOW_MINIMIZE},
        {"maximize", QUAERO_WINDOW_MAXIMIZE},
        {"close", QUAERO_WINDOW_CLOSE},
        {"drag", QUAERO_WINDOW_DRAG},
        {"double-click", QUAERO_WINDOW_DOUBLE_CLICK},
        {"system-menu", QUAERO_WINDOW_SYSTEM_MENU},
        {"snap", QUAERO_WINDOW_SNAP},
    };
    size_t i;
    if (name == NULL) {
        return QUAERO_WINDOW_UNKNOWN;
    }
    for (i = 0; i < sizeof k_commands / sizeof k_commands[0]; i++) {
        if (strcmp(name, k_commands[i].name) == 0) {
            return k_commands[i].cmd;
        }
    }
    return QUAERO_WINDOW_UNKNOWN;
}

static int to_device(double css, unsigned dpi)
{
    /* Half away from zero, without <math.h> (no -lm to link on Linux). */
    double v = css * (double)dpi / 96.0;
    return (int)(v >= 0 ? v + 0.5 : v - 0.5);
}

quaero_rect quaero_rect_to_device(double x, double y, double width, double height,
                                  unsigned dpi)
{
    quaero_rect r;
    int right;
    int bottom;
    if (dpi == 0) {
        dpi = 96;
    }
    if (width < 0) {
        width = 0;
    }
    if (height < 0) {
        height = 0;
    }
    r.x = to_device(x, dpi);
    r.y = to_device(y, dpi);
    right = to_device(x + width, dpi);
    bottom = to_device(y + height, dpi);
    r.width = right - r.x;
    r.height = bottom - r.y;
    return r;
}

quaero_top_hit quaero_top_band_hit(int x, int width, int corner)
{
    if (x < corner) {
        return QUAERO_TOP_LEFT_CORNER;
    }
    if (x >= width - corner) {
        return QUAERO_TOP_RIGHT_CORNER;
    }
    return QUAERO_TOP_EDGE;
}

int quaero_titlebar_parse_mode(const char *text)
{
    size_t n;
    if (text == NULL) {
        return 1;
    }
    while (isspace((unsigned char)*text)) {
        text++;
    }
    n = strlen(text);
    while (n > 0 && isspace((unsigned char)text[n - 1])) {
        n--;
    }
    return !(n == 6 && strncmp(text, "system", 6) == 0);
}

const char *quaero_titlebar_format_mode(int custom)
{
    return custom ? "custom\n" : "system\n";
}

size_t quaero_window_state_json(const char *os, int frameless, int maximized,
                                const char *backdrop, char *buf, size_t cap)
{
    int n;
    if (os == NULL || backdrop == NULL || buf == NULL || cap == 0) {
        return 0;
    }
    n = snprintf(buf, cap,
                 "{\"os\":\"%s\",\"frameless\":%s,\"maximized\":%s,\"backdrop\":\"%s\"}",
                 os, frameless ? "true" : "false", maximized ? "true" : "false",
                 backdrop);
    if (n < 0 || (size_t)n >= cap) {
        buf[0] = '\0';
        return 0;
    }
    return (size_t)n;
}
