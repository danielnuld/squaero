#include "menu_model.h"

#include "cJSON.h"

#include <ctype.h>
#include <stdlib.h>
#include <string.h>

static char *dup_string(const char *s)
{
    size_t n = strlen(s) + 1;
    char *copy = malloc(n);
    if (copy != NULL) {
        memcpy(copy, s, n);
    }
    return copy;
}

/* The string member `name`, or NULL when absent or not a string. */
static const char *string_field(const cJSON *obj, const char *name)
{
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(obj, name);
    return cJSON_IsString(v) ? v->valuestring : NULL;
}

/* Grow by one zeroed entry; NULL when out of memory. */
static quaero_menu_entry *push(quaero_menu *menu)
{
    quaero_menu_entry *grown =
        realloc(menu->entries, (menu->count + 1) * sizeof *grown);
    if (grown == NULL) {
        return NULL;
    }
    menu->entries = grown;
    memset(&grown[menu->count], 0, sizeof *grown);
    return &grown[menu->count++];
}

static int parse_item(const cJSON *item, quaero_menu *menu)
{
    const cJSON *sep = cJSON_GetObjectItemCaseSensitive(item, "separator");
    const cJSON *enabled = cJSON_GetObjectItemCaseSensitive(item, "enabled");
    const char *id;
    const char *label;
    const char *accel;
    quaero_menu_entry *e;

    if (!cJSON_IsObject(item)) {
        return 0;
    }
    if (cJSON_IsTrue(sep)) {
        e = push(menu);
        if (e == NULL) {
            return 0;
        }
        e->kind = QUAERO_MENU_SEPARATOR;
        return 1;
    }
    id = string_field(item, "id");
    label = string_field(item, "label");
    accel = string_field(item, "accel");
    if (id == NULL || *id == '\0' || label == NULL) {
        return 0;
    }
    e = push(menu);
    if (e == NULL) {
        return 0;
    }
    e->kind = QUAERO_MENU_ITEM;
    e->id = dup_string(id);
    e->label = dup_string(label);
    e->accel = accel != NULL && *accel != '\0' ? dup_string(accel) : NULL;
    e->enabled = cJSON_IsFalse(enabled) ? 0 : 1;
    return e->id != NULL && e->label != NULL && (accel == NULL || *accel == '\0' || e->accel != NULL);
}

static int parse_top(const cJSON *top, quaero_menu *menu)
{
    const char *label = string_field(top, "label");
    const cJSON *items = cJSON_GetObjectItemCaseSensitive(top, "items");
    const cJSON *item;
    quaero_menu_entry *e;

    if (!cJSON_IsObject(top) || label == NULL || !cJSON_IsArray(items)) {
        return 0;
    }
    e = push(menu);
    if (e == NULL) {
        return 0;
    }
    e->kind = QUAERO_MENU_TOP;
    e->label = dup_string(label);
    if (e->label == NULL) {
        return 0;
    }
    cJSON_ArrayForEach(item, items) {
        if (!parse_item(item, menu)) {
            return 0;
        }
    }
    return 1;
}

int quaero_menu_parse(const char *json, quaero_menu *out)
{
    cJSON *root;
    const cJSON *top;
    int ok = 1;

    if (out == NULL) {
        return 0;
    }
    out->entries = NULL;
    out->count = 0;
    if (json == NULL) {
        return 0;
    }
    root = cJSON_Parse(json);
    if (root == NULL) {
        return 0;
    }
    if (cJSON_IsArray(root)) {
        cJSON_ArrayForEach(top, root) {
            if (!parse_top(top, out)) {
                ok = 0;
                break;
            }
        }
    } else if (!cJSON_IsNull(root)) {
        ok = 0;
    }
    cJSON_Delete(root);
    if (!ok) {
        quaero_menu_free(out);
    }
    return ok;
}

void quaero_menu_free(quaero_menu *menu)
{
    size_t i;
    if (menu == NULL) {
        return;
    }
    for (i = 0; i < menu->count; i++) {
        free(menu->entries[i].label);
        free(menu->entries[i].id);
        free(menu->entries[i].accel);
    }
    free(menu->entries);
    menu->entries = NULL;
    menu->count = 0;
}

/* Append `s` to buf[*len..] if it fits (with the NUL); 0 when it does not. */
static int append(char *buf, size_t cap, size_t *len, const char *s)
{
    size_t n = strlen(s);
    if (*len + n + 1 > cap) {
        return 0;
    }
    memcpy(buf + *len, s, n + 1);
    *len += n;
    return 1;
}

/* The key names the UI uses (shortcuts.ts) that GDK spells differently. */
static const char *gdk_key_name(const char *key, size_t n)
{
    static const struct {
        const char *ui;
        const char *gdk;
    } names[] = {
        {"Enter", "Return"},    {"Esc", "Escape"},        {"PageDown", "Page_Down"},
        {"PageUp", "Page_Up"},  {"Backspace", "BackSpace"}, {"Space", "space"},
    };
    size_t i;
    for (i = 0; i < sizeof names / sizeof names[0]; i++) {
        if (strlen(names[i].ui) == n && strncmp(names[i].ui, key, n) == 0) {
            return names[i].gdk;
        }
    }
    return NULL;
}

size_t quaero_menu_accel_gtk(const char *accel, char *buf, size_t cap)
{
    size_t len = 0;
    const char *p;
    int have_key = 0;

    if (accel == NULL || *accel == '\0' || buf == NULL || cap == 0) {
        return 0;
    }
    buf[0] = '\0';
    p = accel;
    while (*p != '\0') {
        const char *end = strchr(p, '+');
        size_t n = end != NULL ? (size_t)(end - p) : strlen(p);
        /* A trailing "+" or a leading one is the key "+" itself, not a joiner. */
        if (n == 0) {
            n = 1;
            end = p + 1;
        }
        const int is_last = end == NULL || *end == '\0';
        const char *mod = NULL;
        if (!is_last) {
            if (n == 4 && strncmp(p, "Ctrl", 4) == 0) {
                mod = "<Control>";
            } else if (n == 5 && strncmp(p, "Shift", 5) == 0) {
                mod = "<Shift>";
            } else if (n == 3 && strncmp(p, "Alt", 3) == 0) {
                mod = "<Alt>";
            }
        }
        if (mod != NULL) {
            if (!append(buf, cap, &len, mod)) {
                return 0;
            }
        } else {
            const char *gdk = gdk_key_name(p, n);
            if (gdk != NULL) {
                if (!append(buf, cap, &len, gdk)) {
                    return 0;
                }
            } else if (n == 1) {
                /* A single letter is a lowercase keyval; Shift is the modifier. */
                char one[2] = {(char)tolower((unsigned char)*p), '\0'};
                if (!append(buf, cap, &len, one)) {
                    return 0;
                }
            } else {
                if (len + n + 1 > cap) {
                    return 0;
                }
                memcpy(buf + len, p, n);
                len += n;
                buf[len] = '\0';
            }
            have_key = 1;
        }
        if (end == NULL) {
            break;
        }
        p = end + (*end == '+' ? 1 : 0);
    }
    if (!have_key) {
        buf[0] = '\0';
        return 0;
    }
    return len;
}

static const struct {
    const char *id;
    const char *command;
    char key;
} k_edit_commands[] = {
    {"edit:undo", "Undo", 'Z'},
    {"edit:redo", "Redo", 'Y'},
    {"edit:cut", "Cut", 'X'},
    {"edit:copy", "Copy", 'C'},
    {"edit:paste", "Paste", 'V'},
    {"edit:select-all", "SelectAll", 'A'},
};

const char *quaero_menu_edit_command(const char *id)
{
    size_t i;
    for (i = 0; id != NULL && i < sizeof k_edit_commands / sizeof k_edit_commands[0]; i++) {
        if (strcmp(id, k_edit_commands[i].id) == 0) {
            return k_edit_commands[i].command;
        }
    }
    return NULL;
}

char quaero_menu_edit_key(const char *command)
{
    size_t i;
    for (i = 0; command != NULL && i < sizeof k_edit_commands / sizeof k_edit_commands[0]; i++) {
        if (strcmp(command, k_edit_commands[i].command) == 0) {
            return k_edit_commands[i].key;
        }
    }
    return 0;
}
