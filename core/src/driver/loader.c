/* The project builds with -std=c11 (extensions off), which defines
   __STRICT_ANSI__ and hides POSIX/BSD declarations (opendir, dlopen, ...).
   Re-enable them before any system header is pulled in. */
#if !defined(_WIN32)
#  if defined(__APPLE__)
#    define _DARWIN_C_SOURCE 1
#  else
#    define _POSIX_C_SOURCE 200809L
#    define _DEFAULT_SOURCE 1
#  endif
#endif

#include "dbcore/loader.h"

#include <stdlib.h>
#include <string.h>

#if defined(_WIN32)
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
   typedef HMODULE dbc_lib_handle;
#else
#  include <dirent.h>
#  include <dlfcn.h>
   typedef void *dbc_lib_handle;
#endif

struct dbc_plugin {
    dbc_lib_handle handle;
    const dbc_driver_t *driver;
};

/* --- error buffer helper --- */

static void set_err(char *errbuf, size_t errcap, const char *msg)
{
    if (errbuf == NULL || errcap == 0) {
        return;
    }
    size_t n = strlen(msg);
    if (n >= errcap) {
        n = errcap - 1;
    }
    memcpy(errbuf, msg, n);
    errbuf[n] = '\0';
}

/* --- platform abstraction --- */

#if defined(_WIN32)

static dbc_lib_handle lib_open(const char *path)
{
    return LoadLibraryA(path);
}

static void lib_close(dbc_lib_handle h)
{
    FreeLibrary(h);
}

static dbc_driver_entry_fn lib_entry(dbc_lib_handle h)
{
    /* GetProcAddress yields a function pointer; convert through FARPROC. */
    FARPROC sym = GetProcAddress(h, DBC_DRIVER_ENTRY_SYMBOL);
    return (dbc_driver_entry_fn)(void (*)(void))sym;
}

#else

static dbc_lib_handle lib_open(const char *path)
{
    return dlopen(path, RTLD_NOW | RTLD_LOCAL);
}

static void lib_close(dbc_lib_handle h)
{
    dlclose(h);
}

static dbc_driver_entry_fn lib_entry(dbc_lib_handle h)
{
    /* POSIX guarantees dlsym returns a usable code pointer, but a direct cast
       from void* to a function pointer is not ISO C. Launder it through a
       pointer-to-pointer to satisfy -Wpedantic. */
    dbc_driver_entry_fn fn;
    void *sym = dlsym(h, DBC_DRIVER_ENTRY_SYMBOL);
    memcpy(&fn, &sym, sizeof fn);
    return fn;
}

#endif

/* --- single-file load --- */

dbc_status dbc_plugin_load(const char *path, dbc_plugin **out,
                           char *errbuf, size_t errcap)
{
    if (errbuf != NULL && errcap > 0) {
        errbuf[0] = '\0';
    }
    if (path == NULL || out == NULL) {
        set_err(errbuf, errcap, "invalid argument");
        return DBC_ERR_PARAM;
    }
    *out = NULL;

    dbc_lib_handle handle = lib_open(path);
    if (handle == NULL) {
        set_err(errbuf, errcap, "could not load library");
        return DBC_ERR_CONN;
    }

    dbc_driver_entry_fn entry = lib_entry(handle);
    if (entry == NULL) {
        set_err(errbuf, errcap, "entry symbol " DBC_DRIVER_ENTRY_SYMBOL
                                " not found");
        lib_close(handle);
        return DBC_ERR_UNSUPPORTED;
    }

    const dbc_driver_t *driver = entry();
    dbc_status st = dbc_driver_validate(driver);
    if (st != DBC_OK) {
        if (st == DBC_ERR_ABI) {
            set_err(errbuf, errcap, "incompatible driver ABI version");
        } else {
            set_err(errbuf, errcap, "driver vtable is invalid or incomplete");
        }
        lib_close(handle);
        return st;
    }

    dbc_plugin *p = malloc(sizeof *p);
    if (p == NULL) {
        set_err(errbuf, errcap, "out of memory");
        lib_close(handle);
        return DBC_ERR_NOMEM;
    }
    p->handle = handle;
    p->driver = driver;
    *out = p;
    return DBC_OK;
}

const dbc_driver_t *dbc_plugin_driver(const dbc_plugin *plugin)
{
    return plugin != NULL ? plugin->driver : NULL;
}

void dbc_plugin_unload(dbc_plugin *plugin)
{
    if (plugin == NULL) {
        return;
    }
    lib_close(plugin->handle);
    free(plugin);
}

/* --- directory scan --- */

/* Join `dir` + separator + `name` into `buf`. Returns 1 on success, 0 if it
   would not fit. */
static int join_path(char *buf, size_t cap, const char *dir, const char *name)
{
#if defined(_WIN32)
    const char sep = '\\';
#else
    const char sep = '/';
#endif
    size_t dl = strlen(dir);
    size_t nl = strlen(name);
    if (dl + 1 + nl + 1 > cap) {
        return 0;
    }
    memcpy(buf, dir, dl);
    buf[dl] = sep;
    memcpy(buf + dl + 1, name, nl);
    buf[dl + 1 + nl] = '\0';
    return 1;
}

/* Attempt to load one candidate file and route the outcome to the sinks. */
static int try_one(const char *fullpath, dbc_plugin_sink on_load,
                   dbc_plugin_error_sink on_error, void *ctx)
{
    char err[256];
    dbc_plugin *p = NULL;
    dbc_status st = dbc_plugin_load(fullpath, &p, err, sizeof err);
    if (st == DBC_OK) {
        if (on_load != NULL) {
            on_load(p, ctx);
        } else {
            dbc_plugin_unload(p);
        }
        return 1;
    }
    if (on_error != NULL) {
        on_error(fullpath, st, err, ctx);
    }
    return 0;
}

int dbc_plugin_scan_dir(const char *dir, dbc_plugin_sink on_load,
                        dbc_plugin_error_sink on_error, void *ctx)
{
    if (dir == NULL) {
        return -1;
    }

    int loaded = 0;
    char fullpath[1024];

#if defined(_WIN32)
    char pattern[1024];
    if (!join_path(pattern, sizeof pattern, dir, "*")) {
        return -1;
    }
    WIN32_FIND_DATAA fd;
    HANDLE h = FindFirstFileA(pattern, &fd);
    if (h == INVALID_HANDLE_VALUE) {
        return -1;
    }
    do {
        if (!dbc_plugin_is_candidate(fd.cFileName)) {
            continue;
        }
        if (!join_path(fullpath, sizeof fullpath, dir, fd.cFileName)) {
            if (on_error != NULL) {
                on_error(fd.cFileName, DBC_ERR_PARAM,
                         "plugin path too long; skipped", ctx);
            }
            continue;
        }
        loaded += try_one(fullpath, on_load, on_error, ctx);
    } while (FindNextFileA(h, &fd));
    FindClose(h);
#else
    DIR *d = opendir(dir);
    if (d == NULL) {
        return -1;
    }
    struct dirent *ent;
    while ((ent = readdir(d)) != NULL) {
        if (!dbc_plugin_is_candidate(ent->d_name)) {
            continue;
        }
        if (!join_path(fullpath, sizeof fullpath, dir, ent->d_name)) {
            if (on_error != NULL) {
                on_error(ent->d_name, DBC_ERR_PARAM,
                         "plugin path too long; skipped", ctx);
            }
            continue;
        }
        loaded += try_one(fullpath, on_load, on_error, ctx);
    }
    closedir(d);
#endif

    return loaded;
}
