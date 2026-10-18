/* The remembered window geometry (issue #685): one text line, "x y w h max",
   kept in the per-user config directory by the shell. Pure parse/format here so
   the format is tested without a window; reading the file, validating the
   monitor and applying the placement are the shell's (platform) job. */
#ifndef QUAERO_APP_WINDOW_STATE_H
#define QUAERO_APP_WINDOW_STATE_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct quaero_window_state {
    int x;
    int y;
    int width;
    int height;
    int maximized; /* 0 or 1 */
} quaero_window_state;

/* Smallest size the parser accepts: anything less is not a window the app can
   be used in, so a corrupt or hand-edited file falls back to the default. */
#define QUAERO_WINDOW_MIN_SIZE 320

/* Parse "x y w h max" into *out. Returns 1 on success; 0 (and leaves *out
   untouched) on NULL, malformed text, a size under QUAERO_WINDOW_MIN_SIZE or a
   `max` that is not 0/1. Trailing whitespace/newline is fine; extra fields
   are not. */
int quaero_window_state_parse(const char *text, quaero_window_state *out);

/* Format *state as "x y w h max\n" into buf. Returns the number of characters
   written (excluding the NUL), or 0 when buf is too small or NULL. 64 bytes
   always suffice. */
size_t quaero_window_state_format(const quaero_window_state *state, char *buf,
                                  size_t cap);

#ifdef __cplusplus
}
#endif

#endif
