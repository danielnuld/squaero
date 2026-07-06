/*
 * quaero-rpc — a thin stdio bridge to the Quaero core's JSON-RPC dispatcher.
 *
 * It loads every driver plugin found in a directory, then reads one JSON-RPC
 * request per line from stdin, hands it to dbcore_ipc_handle, and prints the
 * response (one line) to stdout. This is the same entry point the desktop app's
 * webview bridge uses (app/src/main.cc), minus the GUI — so scripts can exercise
 * the real core + real drivers against a live database with no webview.
 *
 * Used by the reproducible smoke suite (scripts/smoke/, issue #199).
 *
 * Usage:  quaero-rpc <drivers_dir>
 *   <drivers_dir>  directory scanned for driver plugins (e.g. build/app/drivers).
 *
 * Protocol: one request JSON per input line -> one response JSON per output line.
 * Blank lines are ignored. EOF ends the session.
 */
#include "dbcore/ipc.h"
#include "dbcore/loader.h"
#include "dbcore/runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void on_loaded(dbc_plugin *plugin, void *ctx)
{
    dbcore_runtime *rt = (dbcore_runtime *)ctx;
    const dbc_driver_t *drv = dbc_plugin_driver(plugin);
    if (dbcore_runtime_register_driver(rt, drv) == DBC_OK) {
        fprintf(stderr, "quaero-rpc: loaded driver '%s'\n",
                drv != NULL ? drv->name : "(unknown)");
    } else {
        fprintf(stderr, "quaero-rpc: failed to register driver\n");
        dbc_plugin_unload(plugin);
    }
}

static void on_error(const char *path, dbc_status status, const char *message,
                     void *ctx)
{
    (void)status;
    (void)ctx;
    fprintf(stderr, "quaero-rpc: skipped plugin '%s': %s\n", path,
            message != NULL ? message : "unknown error");
}

/* Read one line (without the trailing newline) from `in` into a growing buffer.
 * Returns the line, or NULL at EOF with no data. Caller frees. */
static char *read_line(FILE *in)
{
    size_t cap = 256, len = 0;
    char *buf = (char *)malloc(cap);
    if (buf == NULL) {
        return NULL;
    }
    int c;
    while ((c = fgetc(in)) != EOF) {
        if (c == '\n') {
            break;
        }
        if (c == '\r') {
            continue;
        }
        if (len + 1 >= cap) {
            cap *= 2;
            char *grown = (char *)realloc(buf, cap);
            if (grown == NULL) {
                free(buf);
                return NULL;
            }
            buf = grown;
        }
        buf[len++] = (char)c;
    }
    if (c == EOF && len == 0) {
        free(buf);
        return NULL;
    }
    buf[len] = '\0';
    return buf;
}

int main(int argc, char **argv)
{
    if (argc < 2) {
        fprintf(stderr, "usage: quaero-rpc <drivers_dir>\n");
        return 2;
    }

    dbcore_runtime *rt = dbcore_runtime_get();
    if (rt == NULL) {
        fprintf(stderr, "quaero-rpc: runtime unavailable\n");
        return 1;
    }
    int loaded = dbc_plugin_scan_dir(argv[1], on_loaded, on_error, rt);
    if (loaded <= 0) {
        fprintf(stderr, "quaero-rpc: no drivers loaded from %s\n", argv[1]);
        /* Keep going: conn.open will fail honestly with a clear error. */
    }

    /* Line-buffered so the driving script sees each response immediately. */
    setvbuf(stdout, NULL, _IOLBF, 0);

    char *line;
    while ((line = read_line(stdin)) != NULL) {
        if (line[0] == '\0') {
            free(line);
            continue;
        }
        char *resp = dbcore_ipc_handle(line);
        if (resp != NULL) {
            fputs(resp, stdout);
            fputc('\n', stdout);
            dbcore_ipc_free(resp);
        } else {
            fputs("{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32603,"
                  "\"message\":\"null response\"}}\n",
                  stdout);
        }
        fflush(stdout);
        free(line);
    }

    dbcore_runtime_reset();
    return 0;
}
