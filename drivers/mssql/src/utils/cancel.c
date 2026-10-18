#include "cancel.h"

/* C11 <stdatomic.h> is not available on MSVC without an experimental switch,
   and these unit tests build there in CI; the interlocked intrinsics are. */
#if defined(_MSC_VER) && !defined(__clang__)
#  include <intrin.h>
static long load(volatile long *p)               { return _InterlockedCompareExchange(p, 0, 0); }
static void store(volatile long *p, long v)      { (void)_InterlockedExchange(p, v); }
static int  cas(volatile long *p, long o, long n) { return _InterlockedCompareExchange(p, n, o) == o; }
#else
static long load(volatile long *p)               { return __atomic_load_n(p, __ATOMIC_SEQ_CST); }
static void store(volatile long *p, long v)      { __atomic_store_n(p, v, __ATOMIC_SEQ_CST); }
static int  cas(volatile long *p, long o, long n)
{
    return __atomic_compare_exchange_n(p, &o, n, 0, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST);
}
#endif

enum { IDLE = 0, REQUESTED = 1, SENT = 2 };

void mssql_cancel_reset(mssql_cancel *c)
{
    store(&c->state, IDLE);
}

void mssql_cancel_request(mssql_cancel *c)
{
    /* Only from IDLE: a request already pending or sent stays as it is. */
    (void)cas(&c->state, IDLE, REQUESTED);
}

int mssql_cancel_pending(mssql_cancel *c)
{
    return load(&c->state) == REQUESTED;
}

int mssql_cancel_claim(mssql_cancel *c)
{
    return cas(&c->state, REQUESTED, SENT) ? 1 : 0;
}
