#include "window_state.h"

#include <ctype.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>

/* One int, after optional whitespace; advances *p past it. strtol rather than
   sscanf: MSVC deprecates sscanf (C4996, an error under /WX). */
static int next_int(const char **p, int *out)
{
    char *end;
    long v;
    errno = 0;
    v = strtol(*p, &end, 10);
    if (end == *p || errno == ERANGE || v < INT_MIN || v > INT_MAX) {
        return 0;
    }
    *out = (int)v;
    *p = end;
    return 1;
}

int quaero_window_state_parse(const char *text, quaero_window_state *out)
{
    quaero_window_state s;
    const char *p = text;
    if (text == NULL || out == NULL) {
        return 0;
    }
    if (!next_int(&p, &s.x) || !next_int(&p, &s.y) || !next_int(&p, &s.width) ||
        !next_int(&p, &s.height) || !next_int(&p, &s.maximized)) {
        return 0;
    }
    /* Trailing whitespace is fine; anything else is junk. */
    while (isspace((unsigned char)*p)) {
        p++;
    }
    if (*p != '\0') {
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
