/*
 * quaero-mcp — a Model Context Protocol server over Quaero's core (issue #184).
 *
 * Exposes saved databases to MCP clients (Claude Code and others) as a small set
 * of read-only-by-default tools, reusing libdbcore and the real driver plugins.
 * It speaks MCP (JSON-RPC 2.0) over stdio: one JSON message per line in, one per
 * line out — the transport Claude Code uses for `claude mcp add ... -- <cmd>`.
 *
 * Security is opt-in and read-only by default; see docs/MCP.md and mcp_conns.h.
 *
 * Usage:
 *   quaero-mcp --connections <file.json> [--drivers <dir>]
 * Environment fallbacks: QUAERO_MCP_CONNECTIONS, QUAERO_MCP_DRIVERS.
 * If --drivers is omitted, a "drivers" directory next to the executable is used.
 */
#include "mcp_conns.h"
#include "mcp_server.h"

#include "dbcore/loader.h"
#include "dbcore/runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef QUAERO_MCP_VERSION
#define QUAERO_MCP_VERSION "0"
#endif

static void on_loaded(dbc_plugin *plugin, void *ctx)
{
    dbcore_runtime *rt = (dbcore_runtime *)ctx;
    const dbc_driver_t *drv = dbc_plugin_driver(plugin);
    if (dbcore_runtime_register_driver(rt, drv) == DBC_OK) {
        fprintf(stderr, "quaero-mcp: loaded driver '%s'\n",
                drv != NULL ? drv->name : "(unknown)");
    } else {
        fprintf(stderr, "quaero-mcp: failed to register driver\n");
        dbc_plugin_unload(plugin);
    }
}

static void on_error(const char *path, dbc_status status, const char *message,
                     void *ctx)
{
    (void)status;
    (void)ctx;
    fprintf(stderr, "quaero-mcp: skipped plugin '%s': %s\n", path,
            message != NULL ? message : "unknown error");
}

/* Read one newline-terminated line (CR stripped). NULL at EOF. Caller frees. */
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

/* Derive "<dir of argv0>/drivers" into `out`. Falls back to "drivers". */
static void default_drivers_dir(const char *argv0, char *out, size_t outlen)
{
    const char *slash = NULL;
    for (const char *p = argv0; *p != '\0'; p++) {
        if (*p == '/' || *p == '\\') {
            slash = p;
        }
    }
    if (slash != NULL) {
        size_t dirlen = (size_t)(slash - argv0);
        snprintf(out, outlen, "%.*s/drivers", (int)dirlen, argv0);
    } else {
        snprintf(out, outlen, "drivers");
    }
}

int main(int argc, char **argv)
{
    const char *conns_path = getenv("QUAERO_MCP_CONNECTIONS");
    const char *drivers_dir = getenv("QUAERO_MCP_DRIVERS");
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--connections") == 0 && i + 1 < argc) {
            conns_path = argv[++i];
        } else if (strcmp(argv[i], "--drivers") == 0 && i + 1 < argc) {
            drivers_dir = argv[++i];
        } else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            fprintf(stderr,
                    "usage: quaero-mcp --connections <file.json> "
                    "[--drivers <dir>]\n");
            return 0;
        }
    }
    if (conns_path == NULL) {
        fprintf(stderr, "quaero-mcp: --connections <file.json> is required "
                        "(or set QUAERO_MCP_CONNECTIONS)\n");
        return 2;
    }

    char err[256];
    mcp_conns_t *conns = mcp_conns_load_file(conns_path, err, sizeof err);
    if (conns == NULL) {
        fprintf(stderr, "quaero-mcp: %s\n", err);
        return 1;
    }
    fprintf(stderr, "quaero-mcp: %lu MCP-enabled connection(s)\n",
            (unsigned long)mcp_conns_count(conns));

    dbcore_runtime *rt = dbcore_runtime_get();
    if (rt == NULL) {
        fprintf(stderr, "quaero-mcp: runtime unavailable\n");
        mcp_conns_free(conns);
        return 1;
    }
    char dbuf[1024];
    if (drivers_dir == NULL) {
        default_drivers_dir(argv[0], dbuf, sizeof dbuf);
        drivers_dir = dbuf;
    }
    int loaded = dbc_plugin_scan_dir(drivers_dir, on_loaded, on_error, rt);
    if (loaded <= 0) {
        fprintf(stderr,
                "quaero-mcp: no drivers loaded from %s (connections will fail "
                "to open)\n",
                drivers_dir);
    }

    mcp_server_t *srv = mcp_server_new(conns);
    if (srv == NULL) {
        fprintf(stderr, "quaero-mcp: out of memory\n");
        mcp_conns_free(conns);
        dbcore_runtime_reset();
        return 1;
    }
    mcp_server_set_info(srv, "quaero", QUAERO_MCP_VERSION);

    /* Newline-delimited JSON both ways; flush each reply immediately. */
    setvbuf(stdout, NULL, _IOLBF, 0);
    char *line;
    while ((line = read_line(stdin)) != NULL) {
        if (line[0] == '\0') {
            free(line);
            continue;
        }
        char *resp = mcp_server_handle(srv, line);
        free(line);
        if (resp != NULL) { /* NULL = notification, no reply */
            fputs(resp, stdout);
            fputc('\n', stdout);
            fflush(stdout);
            free(resp);
        }
    }

    mcp_server_free(srv);
    mcp_conns_free(conns);
    dbcore_runtime_reset();
    return 0;
}
