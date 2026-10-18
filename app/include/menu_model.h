/* The native menu bar's model (issue #686). The UI owns the menu — its labels,
   its language, which actions exist and whether they are enabled — and sends it
   as JSON through the quaeroSetMenu binding:

     [{"label":"File","items":[
        {"id":"new-tab","label":"New query","accel":"Ctrl+T","enabled":true},
        {"separator":true},
        {"id":"quit","label":"Exit"}]}, ...]

   Parsed here into one flat list so the Win32 (HMENU) and GTK builders in the
   shell walk the same thing: a TOP entry opens a menu, the ITEM and SEPARATOR
   entries after it are its contents. The entry's index is what a native item
   carries (a WM_COMMAND id, a GAction name) to find its action id again. Pure:
   no window, no toolkit; the shell applies it. */
#ifndef QUAERO_APP_MENU_MODEL_H
#define QUAERO_APP_MENU_MODEL_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum quaero_menu_kind {
    QUAERO_MENU_TOP = 0,
    QUAERO_MENU_ITEM = 1,
    QUAERO_MENU_SEPARATOR = 2
} quaero_menu_kind;

typedef struct quaero_menu_entry {
    quaero_menu_kind kind;
    char *label; /* TOP, ITEM: UTF-8; SEPARATOR: NULL */
    char *id;    /* ITEM: the action id the UI runs; else NULL */
    char *accel; /* ITEM: display text as the UI spelled it ("Ctrl+Shift+F"), or NULL */
    int enabled; /* ITEM: 0/1 (absent in the JSON means 1) */
} quaero_menu_entry;

typedef struct quaero_menu {
    quaero_menu_entry *entries;
    size_t count;
} quaero_menu;

/* Parse the JSON array into *out (the caller frees with quaero_menu_free).
   Returns 1 on success — "[]" and "null" succeed with zero entries, which is
   how the UI hides the bar — and 0 on NULL, malformed JSON or a menu/item that
   lacks its label or id, leaving *out empty. A top-level menu needs "label"
   and "items"; an item needs "id" and "label"; a separator is {"separator":true}. */
int quaero_menu_parse(const char *json, quaero_menu *out);

/* Free what quaero_menu_parse allocated and zero *menu. NULL-safe. */
void quaero_menu_free(quaero_menu *menu);

/* The UI's accelerator text in gtk_accelerator_parse's spelling, for display
   only: "Ctrl+Shift+F" -> "<Control><Shift>f", "Ctrl+PageDown" ->
   "<Control>Page_Down", "F5" -> "F5". Returns the characters written (no NUL),
   or 0 when accel is NULL/empty, has no key, or buf is too small. */
size_t quaero_menu_accel_gtk(const char *accel, char *buf, size_t cap);

#ifdef __cplusplus
}
#endif

#endif
