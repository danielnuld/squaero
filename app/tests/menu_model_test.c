#include "menu_model.h"

#include <stdio.h>
#include <string.h>

/* The native menu model the UI sends (issue #686): nominal, edge and junk. */

static int failures = 0;

#define CHECK(cond)                                                            \
    do {                                                                       \
        if (!(cond)) {                                                         \
            fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);    \
            failures++;                                                        \
        }                                                                      \
    } while (0)

static int str_eq(const char *a, const char *b)
{
    return a != NULL && b != NULL && strcmp(a, b) == 0;
}

static void test_parse_nominal(void)
{
    quaero_menu m;
    const char *json =
        "[{\"label\":\"Archivo\",\"items\":["
        "{\"id\":\"new-tab\",\"label\":\"Nueva consulta\",\"accel\":\"Ctrl+T\"},"
        "{\"separator\":true},"
        "{\"id\":\"act:reconnect\",\"label\":\"Reconectar\",\"enabled\":false},"
        "{\"id\":\"quit\",\"label\":\"Salir\",\"enabled\":true,\"accel\":\"\"}]},"
        "{\"label\":\"Ayuda\",\"items\":[]}]";
    CHECK(quaero_menu_parse(json, &m) == 1);
    CHECK(m.count == 6);
    if (m.count == 6) {
        CHECK(m.entries[0].kind == QUAERO_MENU_TOP && str_eq(m.entries[0].label, "Archivo"));
        CHECK(m.entries[0].id == NULL && m.entries[0].accel == NULL);
        CHECK(m.entries[1].kind == QUAERO_MENU_ITEM && str_eq(m.entries[1].id, "new-tab"));
        CHECK(str_eq(m.entries[1].label, "Nueva consulta") && str_eq(m.entries[1].accel, "Ctrl+T"));
        CHECK(m.entries[1].enabled == 1); /* absent means enabled */
        CHECK(m.entries[2].kind == QUAERO_MENU_SEPARATOR && m.entries[2].label == NULL);
        CHECK(m.entries[3].kind == QUAERO_MENU_ITEM && m.entries[3].enabled == 0);
        CHECK(str_eq(m.entries[3].id, "act:reconnect") && m.entries[3].accel == NULL);
        CHECK(m.entries[4].enabled == 1 && m.entries[4].accel == NULL); /* "" is no accel */
        CHECK(m.entries[5].kind == QUAERO_MENU_TOP && str_eq(m.entries[5].label, "Ayuda"));
    }
    quaero_menu_free(&m);
    CHECK(m.entries == NULL && m.count == 0);
}

static void test_parse_hidden(void)
{
    quaero_menu m = {NULL, 7};
    CHECK(quaero_menu_parse("[]", &m) == 1);
    CHECK(m.count == 0 && m.entries == NULL);
    CHECK(quaero_menu_parse("null", &m) == 1);
    CHECK(m.count == 0);
}

static void test_parse_rejects(void)
{
    quaero_menu m;
    CHECK(quaero_menu_parse(NULL, &m) == 0);
    CHECK(m.count == 0 && m.entries == NULL);
    CHECK(quaero_menu_parse("", &m) == 0);
    CHECK(quaero_menu_parse("{\"label\":\"x\"}", &m) == 0);              /* not an array */
    CHECK(quaero_menu_parse("[{\"items\":[]}]", &m) == 0);               /* menu without label */
    CHECK(quaero_menu_parse("[{\"label\":\"F\"}]", &m) == 0);            /* menu without items */
    CHECK(quaero_menu_parse("[{\"label\":\"F\",\"items\":[{\"label\":\"x\"}]}]", &m) == 0); /* no id */
    CHECK(quaero_menu_parse("[{\"label\":\"F\",\"items\":[{\"id\":\"\",\"label\":\"x\"}]}]", &m) == 0);
    CHECK(quaero_menu_parse("[{\"label\":\"F\",\"items\":[{\"id\":\"a\"}]}]", &m) == 0);    /* no label */
    CHECK(quaero_menu_parse("[{\"label\":\"F\",\"items\":[7]}]", &m) == 0);
    CHECK(quaero_menu_parse("[{\"label\":\"F\",\"items\":[{\"id\":\"a\",\"label\":\"b\"}", &m) == 0);
    /* A bad item anywhere leaves nothing behind, not a half menu. */
    CHECK(m.count == 0 && m.entries == NULL);
    CHECK(quaero_menu_parse("[]", NULL) == 0);
    quaero_menu_free(NULL);
}

static void test_accel_gtk(void)
{
    char buf[64];
    CHECK(quaero_menu_accel_gtk("Ctrl+Shift+F", buf, sizeof buf) == strlen("<Control><Shift>f"));
    CHECK(strcmp(buf, "<Control><Shift>f") == 0);
    CHECK(quaero_menu_accel_gtk("Ctrl+Enter", buf, sizeof buf) > 0);
    CHECK(strcmp(buf, "<Control>Return") == 0);
    CHECK(quaero_menu_accel_gtk("Ctrl+PageDown", buf, sizeof buf) > 0);
    CHECK(strcmp(buf, "<Control>Page_Down") == 0);
    CHECK(quaero_menu_accel_gtk("Ctrl+Alt+L", buf, sizeof buf) > 0);
    CHECK(strcmp(buf, "<Control><Alt>l") == 0);
    CHECK(quaero_menu_accel_gtk("F5", buf, sizeof buf) == 2);
    CHECK(strcmp(buf, "F5") == 0);
    CHECK(quaero_menu_accel_gtk("Esc", buf, sizeof buf) > 0);
    CHECK(strcmp(buf, "Escape") == 0);
    CHECK(quaero_menu_accel_gtk("Delete", buf, sizeof buf) > 0);
    CHECK(strcmp(buf, "Delete") == 0);
    /* "+" as the key, not as a joiner. */
    CHECK(quaero_menu_accel_gtk("Ctrl++", buf, sizeof buf) > 0);
    CHECK(strcmp(buf, "<Control>+") == 0);

    /* Rejected: nothing, no key after the modifiers, too small, NULL. */
    CHECK(quaero_menu_accel_gtk("", buf, sizeof buf) == 0);
    CHECK(quaero_menu_accel_gtk(NULL, buf, sizeof buf) == 0);
    CHECK(quaero_menu_accel_gtk("Ctrl+", buf, sizeof buf) == 0);
    CHECK(buf[0] == '\0');
    CHECK(quaero_menu_accel_gtk("Ctrl+Shift+F", buf, 10) == 0);
    CHECK(quaero_menu_accel_gtk("F5", NULL, 64) == 0);
    CHECK(quaero_menu_accel_gtk("F5", buf, 0) == 0);
}

static void test_edit_commands(void)
{
    CHECK(str_eq(quaero_menu_edit_command("edit:undo"), "Undo"));
    CHECK(str_eq(quaero_menu_edit_command("edit:redo"), "Redo"));
    CHECK(str_eq(quaero_menu_edit_command("edit:cut"), "Cut"));
    CHECK(str_eq(quaero_menu_edit_command("edit:copy"), "Copy"));
    CHECK(str_eq(quaero_menu_edit_command("edit:paste"), "Paste"));
    CHECK(str_eq(quaero_menu_edit_command("edit:select-all"), "SelectAll"));
    /* Any other id is the UI's own: exact names only. */
    CHECK(quaero_menu_edit_command(NULL) == NULL);
    CHECK(quaero_menu_edit_command("") == NULL);
    CHECK(quaero_menu_edit_command("edit:") == NULL);
    CHECK(quaero_menu_edit_command("edit:Copy") == NULL);
    CHECK(quaero_menu_edit_command("copy-rows") == NULL);
    CHECK(quaero_menu_edit_command("quit") == NULL);

    CHECK(quaero_menu_edit_key("Undo") == 'Z');
    CHECK(quaero_menu_edit_key("Redo") == 'Y');
    CHECK(quaero_menu_edit_key("Cut") == 'X');
    CHECK(quaero_menu_edit_key("Copy") == 'C');
    CHECK(quaero_menu_edit_key("Paste") == 'V');
    CHECK(quaero_menu_edit_key("SelectAll") == 'A');
    CHECK(quaero_menu_edit_key(NULL) == 0);
    CHECK(quaero_menu_edit_key("edit:copy") == 0);
    CHECK(quaero_menu_edit_key("copy") == 0);
}

int main(void)
{
    test_parse_nominal();
    test_parse_hidden();
    test_parse_rejects();
    test_accel_gtk();
    test_edit_commands();
    if (failures != 0) {
        return 1;
    }
    printf("OK: menu_model\n");
    return 0;
}
