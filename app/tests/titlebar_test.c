#include "titlebar.h"

#include <stdio.h>
#include <string.h>

/* The app's own title bar (issue #688): commands, geometry, the remembered
   choice and the state line — nominal, edge and junk input. */

static int failures = 0;

#define CHECK(cond)                                                            \
    do {                                                                       \
        if (!(cond)) {                                                         \
            fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);    \
            failures++;                                                        \
        }                                                                      \
    } while (0)

static void test_commands(void)
{
    CHECK(quaero_window_command_parse("state") == QUAERO_WINDOW_STATE);
    CHECK(quaero_window_command_parse("frameless") == QUAERO_WINDOW_FRAMELESS);
    CHECK(quaero_window_command_parse("minimize") == QUAERO_WINDOW_MINIMIZE);
    CHECK(quaero_window_command_parse("maximize") == QUAERO_WINDOW_MAXIMIZE);
    CHECK(quaero_window_command_parse("close") == QUAERO_WINDOW_CLOSE);
    CHECK(quaero_window_command_parse("drag") == QUAERO_WINDOW_DRAG);
    CHECK(quaero_window_command_parse("double-click") == QUAERO_WINDOW_DOUBLE_CLICK);
    CHECK(quaero_window_command_parse("system-menu") == QUAERO_WINDOW_SYSTEM_MENU);
    CHECK(quaero_window_command_parse("snap") == QUAERO_WINDOW_SNAP);
    /* Exact names only. */
    CHECK(quaero_window_command_parse(NULL) == QUAERO_WINDOW_UNKNOWN);
    CHECK(quaero_window_command_parse("") == QUAERO_WINDOW_UNKNOWN);
    CHECK(quaero_window_command_parse("Close") == QUAERO_WINDOW_UNKNOWN);
    CHECK(quaero_window_command_parse("close ") == QUAERO_WINDOW_UNKNOWN);
    CHECK(quaero_window_command_parse("quit") == QUAERO_WINDOW_UNKNOWN);
}

static void test_rect_to_device(void)
{
    quaero_rect r = quaero_rect_to_device(1188, 0, 46, 38, 96);
    CHECK(r.x == 1188 && r.y == 0 && r.width == 46 && r.height == 38);

    /* 150 %: every edge scales. */
    r = quaero_rect_to_device(100, 10, 46, 38, 144);
    CHECK(r.x == 150 && r.y == 15 && r.width == 69 && r.height == 57);

    /* 125 % with fractional CSS edges: rounded edges keep neighbours touching. */
    {
        quaero_rect a = quaero_rect_to_device(10.4, 0, 46.3, 38, 120);
        quaero_rect b = quaero_rect_to_device(56.7, 0, 46.3, 38, 120);
        CHECK(a.x + a.width == b.x);
    }

    /* Negative sizes are empty; dpi 0 means 96. */
    r = quaero_rect_to_device(5, 5, -10, -1, 0);
    CHECK(r.x == 5 && r.y == 5 && r.width == 0 && r.height == 0);
    /* Negative positions (a rect partly off the viewport) round symmetrically. */
    r = quaero_rect_to_device(-1.5, 0, 3, 1, 96);
    CHECK(r.x == -2 && r.width == 4);
}

static void test_top_band(void)
{
    CHECK(quaero_top_band_hit(0, 1000, 16) == QUAERO_TOP_LEFT_CORNER);
    CHECK(quaero_top_band_hit(15, 1000, 16) == QUAERO_TOP_LEFT_CORNER);
    CHECK(quaero_top_band_hit(16, 1000, 16) == QUAERO_TOP_EDGE);
    CHECK(quaero_top_band_hit(983, 1000, 16) == QUAERO_TOP_EDGE);
    CHECK(quaero_top_band_hit(984, 1000, 16) == QUAERO_TOP_RIGHT_CORNER);
    CHECK(quaero_top_band_hit(999, 1000, 16) == QUAERO_TOP_RIGHT_CORNER);
    /* No corners: all edge. */
    CHECK(quaero_top_band_hit(0, 1000, 0) == QUAERO_TOP_EDGE);
    CHECK(quaero_top_band_hit(999, 1000, 0) == QUAERO_TOP_EDGE);
}

static void test_mode(void)
{
    CHECK(quaero_titlebar_parse_mode("custom\n") == 1);
    CHECK(quaero_titlebar_parse_mode("system\n") == 0);
    CHECK(quaero_titlebar_parse_mode("  system \r\n") == 0);
    /* The default is the app's own bar. */
    CHECK(quaero_titlebar_parse_mode(NULL) == 1);
    CHECK(quaero_titlebar_parse_mode("") == 1);
    CHECK(quaero_titlebar_parse_mode("System") == 1);
    CHECK(quaero_titlebar_parse_mode("systemd") == 1);
    CHECK(quaero_titlebar_parse_mode("0") == 1);
    /* Round trip. */
    CHECK(quaero_titlebar_parse_mode(quaero_titlebar_format_mode(1)) == 1);
    CHECK(quaero_titlebar_parse_mode(quaero_titlebar_format_mode(0)) == 0);
    CHECK(strcmp(quaero_titlebar_format_mode(5), "custom\n") == 0);
}

static void test_state_json(void)
{
    char buf[128];
    size_t n = quaero_window_state_json("windows", 1, 0, "mica", buf, sizeof buf);
    const char *want =
        "{\"os\":\"windows\",\"frameless\":true,\"maximized\":false,\"backdrop\":\"mica\"}";
    CHECK(n == strlen(want));
    CHECK(strcmp(buf, want) == 0);

    n = quaero_window_state_json("macos", 0, 7, "none", buf, sizeof buf);
    CHECK(strcmp(buf, "{\"os\":\"macos\",\"frameless\":false,\"maximized\":true,"
                      "\"backdrop\":\"none\"}") == 0);

    /* Too small, NULLs. */
    {
        char small[16];
        CHECK(quaero_window_state_json("windows", 1, 0, "mica", small, sizeof small) == 0);
        CHECK(small[0] == '\0');
    }
    CHECK(quaero_window_state_json(NULL, 1, 0, "mica", buf, sizeof buf) == 0);
    CHECK(quaero_window_state_json("windows", 1, 0, NULL, buf, sizeof buf) == 0);
    CHECK(quaero_window_state_json("windows", 1, 0, "mica", NULL, 64) == 0);
}

int main(void)
{
    test_commands();
    test_rect_to_device();
    test_top_band();
    test_mode();
    test_state_json();
    if (failures != 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("titlebar_test: ok\n");
    return 0;
}
