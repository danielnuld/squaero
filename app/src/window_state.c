#include "window_state.h"

#include <stdio.h>

int quaero_window_state_parse(const char *text, quaero_window_state *out)
{
    quaero_window_state s;
    int consumed = 0;
    if (text == NULL || out == NULL) {
        return 0;
    }
    if (sscanf(text, "%d %d %d %d %d %n", &s.x, &s.y, &s.width, &s.height,
               &s.maximized, &consumed) != 5) {
        return 0;
    }
    /* "%n" lands after the trailing whitespace: anything left is junk. */
    if (text[consumed] != '\0') {
        return 0;
    }
    if (s.width < QUAERO_WINDOW_MIN_SIZE || s.height < QUAERO_WINDOW_MIN_SIZE) {
        return 0;
    }
    if (s.maximized != 0 && s.maximized != 1) {
        return 0;
    }
    *out = s;
    return 1;
}

size_t quaero_window_state_format(const quaero_window_state *state, char *buf,
                                  size_t cap)
{
    int n;
    if (state == NULL || buf == NULL || cap == 0) {
        return 0;
    }
    n = snprintf(buf, cap, "%d %d %d %d %d\n", state->x, state->y, state->width,
                 state->height, state->maximized ? 1 : 0);
    if (n < 0 || (size_t)n >= cap) {
        if (cap > 0) {
            buf[0] = '\0';
        }
        return 0;
    }
    return (size_t)n;
}
