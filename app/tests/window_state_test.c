#include "window_state.h"

#include <stdio.h>
#include <string.h>

/* The saved-window-geometry line (issue #685): nominal, edge and junk input. */

static int failures = 0;

#define CHECK(cond)                                                            \
    do {                                                                       \
        if (!(cond)) {                                                         \
            fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);    \
            failures++;                                                        \
        }                                                                      \
    } while (0)

static void test_round_trip(void)
{
    quaero_window_state in = {120, -40, 1280, 800, 1};
    quaero_window_state out = {0, 0, 0, 0, 0};
    char buf[64];
    size_t n = quaero_window_state_format(&in, buf, sizeof buf);
    CHECK(n == strlen("120 -40 1280 800 1\n"));
    CHECK(strcmp(buf, "120 -40 1280 800 1\n") == 0);
    CHECK(quaero_window_state_parse(buf, &out) == 1);
    CHECK(out.x == 120 && out.y == -40 && out.width == 1280 &&
          out.height == 800 && out.maximized == 1);
}

static void test_parse_edges(void)
{
    quaero_window_state out = {1, 2, 3, 4, 5};
    /* No trailing newline, extra spaces: still one line of five ints. */
    CHECK(quaero_window_state_parse("0  0 320 320   0", &out) == 1);
    CHECK(out.width == 320 && out.maximized == 0);

    /* Rejected, and *out untouched. */
    out = (quaero_window_state){1, 2, 3, 4, 5};
    CHECK(quaero_window_state_parse(NULL, &out) == 0);
    CHECK(quaero_window_state_parse("", &out) == 0);
    CHECK(quaero_window_state_parse("10 10 800", &out) == 0);           /* short */
    CHECK(quaero_window_state_parse("10 10 800 600 0 7", &out) == 0);   /* extra */
    CHECK(quaero_window_state_parse("10 10 800 600 0 junk", &out) == 0);
    CHECK(quaero_window_state_parse("10 10 319 600 0", &out) == 0);     /* tiny */
    CHECK(quaero_window_state_parse("10 10 800 -600 0", &out) == 0);
    CHECK(quaero_window_state_parse("10 10 800 600 2", &out) == 0);     /* max */
    CHECK(quaero_window_state_parse("a b c d e", &out) == 0);
    CHECK(quaero_window_state_parse("10 10 800 600 0", NULL) == 0);
    CHECK(out.x == 1 && out.y == 2 && out.width == 3 && out.height == 4 &&
          out.maximized == 5);
}

static void test_format_edges(void)
{
    quaero_window_state in = {0, 0, 1100, 720, 0};
    char small[8];
    CHECK(quaero_window_state_format(&in, small, sizeof small) == 0);
    CHECK(small[0] == '\0');
    CHECK(quaero_window_state_format(&in, NULL, 64) == 0);
    CHECK(quaero_window_state_format(NULL, small, sizeof small) == 0);
    /* Any non-zero `maximized` is written as 1. */
    in.maximized = 7;
    char buf[64];
    CHECK(quaero_window_state_format(&in, buf, sizeof buf) > 0);
    CHECK(strcmp(buf, "0 0 1100 720 1\n") == 0);
}

int main(void)
{
    test_round_trip();
    test_parse_edges();
    test_format_edges();
    if (failures != 0) {
        return 1;
    }
    printf("OK: window_state\n");
    return 0;
}
