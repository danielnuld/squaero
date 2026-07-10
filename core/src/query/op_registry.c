#include "dbcore/op_registry.h"

#include <stddef.h>

/*
 * Portable mutex wrapper. Windows uses a CRITICAL_SECTION (always available, no
 * extra link dependency); elsewhere a pthread mutex. The registry is the only
 * core state touched from two threads (the RPC worker via begin/end, the UI
 * thread via cancel), so it carries its own lock rather than leaking threading
 * concerns into the rest of the single-threaded core.
 */
#if defined(_WIN32)
#  include <windows.h>
typedef CRITICAL_SECTION qmutex;
static void qmutex_init(qmutex *m)   { InitializeCriticalSection(m); }
static void qmutex_lock(qmutex *m)   { EnterCriticalSection(m); }
static void qmutex_unlock(qmutex *m) { LeaveCriticalSection(m); }
#else
#  include <pthread.h>
typedef pthread_mutex_t qmutex;
static void qmutex_init(qmutex *m)   { pthread_mutex_init(m, NULL); }
static void qmutex_lock(qmutex *m)   { pthread_mutex_lock(m); }
static void qmutex_unlock(qmutex *m) { pthread_mutex_unlock(m); }
#endif

/*
 * A fixed slot table. With the current single-worker dispatch at most one query
 * runs at a time; the cap leaves ample room for a future per-connection worker.
 * Overflow degrades gracefully — an untracked query just cannot be canceled.
 */
#define OP_SLOTS 64

typedef struct {
    int                 in_use;
    int                 conn_id;
    const dbc_driver_t *driver;
    dbc_conn           *handle;
} op_slot;

static op_slot  g_slots[OP_SLOTS];
static qmutex   g_lock;
static int      g_lock_ready;  /* one-time init guard (see ensure_lock) */

/* Lazily initialize the lock. Called on the first begin/cancel; the very first
   call happens before any worker thread exists (drivers load at startup, the
   first query cannot precede it), so this need not itself be atomic. */
static void ensure_lock(void)
{
    if (!g_lock_ready) {
        qmutex_init(&g_lock);
        g_lock_ready = 1;
    }
}

/* Find the slot holding conn_id, or -1. Caller holds the lock. */
static int find_slot(int conn_id)
{
    for (int i = 0; i < OP_SLOTS; i++) {
        if (g_slots[i].in_use && g_slots[i].conn_id == conn_id) {
            return i;
        }
    }
    return -1;
}

void dbcore_op_begin(int conn_id, const dbc_driver_t *driver, dbc_conn *handle)
{
    if (driver == NULL || handle == NULL) {
        return;
    }
    ensure_lock();
    qmutex_lock(&g_lock);

    int idx = find_slot(conn_id);  /* reuse a stale entry for the same conn */
    if (idx < 0) {
        for (int i = 0; i < OP_SLOTS; i++) {
            if (!g_slots[i].in_use) {
                idx = i;
                break;
            }
        }
    }
    if (idx >= 0) {
        g_slots[idx].in_use  = 1;
        g_slots[idx].conn_id = conn_id;
        g_slots[idx].driver  = driver;
        g_slots[idx].handle  = handle;
    }

    qmutex_unlock(&g_lock);
}

void dbcore_op_end(int conn_id)
{
    if (!g_lock_ready) {
        return;
    }
    qmutex_lock(&g_lock);
    int idx = find_slot(conn_id);
    if (idx >= 0) {
        g_slots[idx].in_use = 0;
    }
    qmutex_unlock(&g_lock);
}

dbc_status dbcore_op_cancel(int conn_id)
{
    ensure_lock();
    qmutex_lock(&g_lock);

    int idx = find_slot(conn_id);
    if (idx < 0) {
        qmutex_unlock(&g_lock);
        return DBC_ERR_PARAM;  /* nothing running on this conn */
    }
    const dbc_driver_t *driver = g_slots[idx].driver;
    dbc_conn           *handle = g_slots[idx].handle;

    /*
     * Invoke cancel while still holding the lock so the (driver, handle) pair
     * cannot be torn down under us by a concurrent end/begin. The driver's cancel
     * is required to return promptly (it only signals the running query), so the
     * lock is not held for long. It runs concurrently with query() on the worker
     * thread — the documented exception the driver must be safe against.
     */
    dbc_status st = DBC_ERR_UNSUPPORTED;
    if (driver->cancel != NULL && (driver->features & DBC_FEAT_CANCEL)) {
        st = driver->cancel(handle);
    }

    qmutex_unlock(&g_lock);
    return st;
}

void dbcore_op_registry_reset(void)
{
    if (!g_lock_ready) {
        return;
    }
    qmutex_lock(&g_lock);
    for (int i = 0; i < OP_SLOTS; i++) {
        g_slots[i].in_use = 0;
    }
    qmutex_unlock(&g_lock);
}
