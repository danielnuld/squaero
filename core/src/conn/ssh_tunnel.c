/* POSIX networking (getaddrinfo/struct addrinfo/ssize_t) is hidden by strict
   -std=c11 on glibc; request the default feature set before any system header.
   Harmless on Windows/macOS. Must precede every #include. */
#define _DEFAULT_SOURCE
#define _POSIX_C_SOURCE 200112L

#include "ssh_tunnel.h"

#include "conn_util.h"

/*
 * SSH tunnel lifecycle.
 *
 * Two builds live here, selected by QUAERO_SSH:
 *
 *   - Not built (default): an honest stub. The feature reports itself
 *     unavailable and ssh_tunnel_open fails with DBC_ERR_UNSUPPORTED, so a DSN
 *     that asks for a tunnel fails loudly instead of leaking the connection past
 *     the intended SSH hop.
 *
 *   - Built (QUAERO_SSH): a real local port-forward backed by libssh2. We open
 *     an SSH session to cfg->host, authenticate, then listen on 127.0.0.1:<port>
 *     and forward every accepted connection to cfg->target_host:target_port over
 *     a direct-tcpip channel. A single background thread runs a non-blocking
 *     select() loop multiplexing the listener and all live channels, so the
 *     libssh2 session is only ever touched from that one thread.
 */

#include <string.h>

#ifndef QUAERO_SSH

int ssh_tunnel_available(void)
{
    return 0;
}

dbc_status ssh_tunnel_open(const ssh_config *cfg, ssh_tunnel **out,
                           int *out_local_port, char *err, size_t errcap)
{
    (void)cfg;
    if (out != NULL) {
        *out = NULL;
    }
    if (out_local_port != NULL) {
        *out_local_port = 0;
    }
    conn_copy_err(err, errcap,
             "SSH tunnel support is not built in (rebuild with QUAERO_SSH)");
    return DBC_ERR_UNSUPPORTED;
}

void ssh_tunnel_close(ssh_tunnel *t)
{
    (void)t;
}

#else /* QUAERO_SSH */

#include <libssh2.h>

#include <stdio.h>
#include <stdlib.h>

#ifdef _WIN32
#  include <winsock2.h>
#  include <ws2tcpip.h>
#  include <process.h>
typedef SOCKET socket_t;
#  define BAD_SOCKET INVALID_SOCKET
#  define close_socket closesocket
#  define SOCK_WOULDBLOCK (WSAGetLastError() == WSAEWOULDBLOCK)
typedef HANDLE thread_t;
#  define THREAD_FN_RET unsigned __stdcall
#  define THREAD_FN_RETURN return 0u
#else
#  include <sys/socket.h>
#  include <sys/select.h>
#  include <netinet/in.h>
#  include <arpa/inet.h>
#  include <netdb.h>
#  include <unistd.h>
#  include <fcntl.h>
#  include <errno.h>
#  include <pthread.h>
typedef int socket_t;
#  define BAD_SOCKET (-1)
#  define close_socket close
#  define SOCK_WOULDBLOCK (errno == EAGAIN || errno == EWOULDBLOCK)
typedef pthread_t thread_t;
#  define THREAD_FN_RET void *
#  define THREAD_FN_RETURN return NULL
#endif

#define FWD_BUF 16384
#define MAX_FORWARDS 32

/* Opt-in diagnostics: set QUAERO_SSH_DEBUG to trace the tunnel's milestones to
   stderr. Off by default and silent in normal operation. */
static int dbg_on(void)
{
    static int v = -1;
    if (v < 0) {
        const char *e = getenv("QUAERO_SSH_DEBUG");
        v = (e != NULL && e[0] != '\0') ? 1 : 0;
    }
    return v;
}
#define DBG(...)                                       \
    do {                                               \
        if (dbg_on()) {                                \
            fprintf(stderr, "[ssh_tunnel] " __VA_ARGS__); \
            fputc('\n', stderr);                       \
            fflush(stderr);                            \
        }                                              \
    } while (0)

/* One forwarded connection: a local socket paired with a direct-tcpip channel,
   with a small pending buffer per direction so a would-block on either side
   never drops bytes or blocks the other forwards. */
typedef struct {
    socket_t        local;
    LIBSSH2_CHANNEL *chan;
    char            l2c[FWD_BUF];  /* local -> channel, bytes [off, len) */
    size_t          l2c_off, l2c_len;
    char            c2l[FWD_BUF];  /* channel -> local, bytes [off, len) */
    size_t          c2l_off, c2l_len;
    int             local_eof;     /* local side sent EOF */
    int             chan_eof;      /* channel side at EOF */
} forward_t;

struct ssh_tunnel {
    LIBSSH2_SESSION *session;
    socket_t         ssh_sock;
    socket_t         listen_sock;
    int              local_port;
    char            *target_host;
    int              target_port;
    forward_t       *forwards;   /* MAX_FORWARDS slots, owned by the thread */
    thread_t         thread;
    int              thread_started;
    volatile int     stop;
};

/* ---- global one-time init (process lifetime; never torn down) ------------- */

static int g_init_done = 0;

static int ensure_global_init(void)
{
    if (g_init_done) {
        return 0;
    }
#ifdef _WIN32
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        return -1;
    }
#endif
    if (libssh2_init(0) != 0) {
        return -1;
    }
    g_init_done = 1;
    return 0;
}

static void set_nonblocking(socket_t s)
{
#ifdef _WIN32
    u_long m = 1;
    ioctlsocket(s, FIONBIO, &m);
#else
    int fl = fcntl(s, F_GETFL, 0);
    if (fl >= 0) {
        fcntl(s, F_SETFL, fl | O_NONBLOCK);
    }
#endif
}

/* ---- threads -------------------------------------------------------------- */

static THREAD_FN_RET forward_thread(void *arg);

static int thread_start(ssh_tunnel *t)
{
#ifdef _WIN32
    t->thread = (HANDLE)_beginthreadex(NULL, 0, forward_thread, t, 0, NULL);
    return t->thread != NULL ? 0 : -1;
#else
    return pthread_create(&t->thread, NULL, forward_thread, t) == 0 ? 0 : -1;
#endif
}

static void thread_join(ssh_tunnel *t)
{
#ifdef _WIN32
    WaitForSingleObject(t->thread, INFINITE);
    CloseHandle(t->thread);
#else
    pthread_join(t->thread, NULL);
#endif
}

/* ---- TCP helpers ---------------------------------------------------------- */

/* Blocking connect to host:port, or BAD_SOCKET. */
static socket_t tcp_connect(const char *host, int port)
{
    char portstr[16];
    snprintf(portstr, sizeof portstr, "%d", port);

    struct addrinfo hints;
    memset(&hints, 0, sizeof hints);
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;

    struct addrinfo *res = NULL;
    if (getaddrinfo(host, portstr, &hints, &res) != 0 || res == NULL) {
        return BAD_SOCKET;
    }

    socket_t s = BAD_SOCKET;
    for (struct addrinfo *ai = res; ai != NULL; ai = ai->ai_next) {
        s = socket(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
        if (s == BAD_SOCKET) {
            continue;
        }
        if (connect(s, ai->ai_addr, (int)ai->ai_addrlen) == 0) {
            break;
        }
        close_socket(s);
        s = BAD_SOCKET;
    }
    freeaddrinfo(res);
    return s;
}

/* Listening socket on 127.0.0.1:0; writes the chosen port to *out_port. */
static socket_t listen_loopback(int *out_port)
{
    socket_t s = socket(AF_INET, SOCK_STREAM, 0);
    if (s == BAD_SOCKET) {
        return BAD_SOCKET;
    }
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof addr);
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = 0; /* ephemeral */
    if (bind(s, (struct sockaddr *)&addr, sizeof addr) != 0 ||
        listen(s, 8) != 0) {
        close_socket(s);
        return BAD_SOCKET;
    }
    socklen_t len = sizeof addr;
    if (getsockname(s, (struct sockaddr *)&addr, &len) != 0) {
        close_socket(s);
        return BAD_SOCKET;
    }
    *out_port = (int)ntohs(addr.sin_port);
    return s;
}

/* ---- authentication ------------------------------------------------------- */

static int authenticate(LIBSSH2_SESSION *s, const ssh_config *cfg)
{
    switch (cfg->auth) {
    case SSH_AUTH_PASSWORD:
        return libssh2_userauth_password(s, cfg->user, cfg->password);

    case SSH_AUTH_KEY:
        return libssh2_userauth_publickey_fromfile(
            s, cfg->user, NULL, cfg->key_path,
            cfg->key_passphrase ? cfg->key_passphrase : "");

    case SSH_AUTH_AGENT:
    default: {
        LIBSSH2_AGENT *agent = libssh2_agent_init(s);
        if (agent == NULL) {
            return -1;
        }
        int rc = -1;
        if (libssh2_agent_connect(agent) == 0 &&
            libssh2_agent_list_identities(agent) == 0) {
            struct libssh2_agent_publickey *id = NULL, *prev = NULL;
            for (;;) {
                int n = libssh2_agent_get_identity(agent, &id, prev);
                if (n != 0) { /* 1 = end of list, <0 = error */
                    break;
                }
                if (libssh2_agent_userauth(agent, cfg->user, id) == 0) {
                    rc = 0;
                    break;
                }
                prev = id;
            }
            libssh2_agent_disconnect(agent);
        }
        libssh2_agent_free(agent);
        return rc;
    }
    }
}

/* ---- forwarding loop ------------------------------------------------------ */

static void forward_drop(forward_t *f)
{
    if (f->chan != NULL) {
        libssh2_channel_free(f->chan);
        f->chan = NULL;
    }
    if (f->local != BAD_SOCKET) {
        close_socket(f->local);
        f->local = BAD_SOCKET;
    }
}

/* Pump one forward both ways. Returns 1 to keep it, 0 when fully closed. */
static int forward_pump(forward_t *f)
{
    /* local -> channel: fill the buffer, then drain it to the channel. */
    if (!f->local_eof && f->l2c_len == 0) {
#ifdef _WIN32
        int n = recv(f->local, f->l2c, (int)sizeof f->l2c, 0);
#else
        ssize_t n = recv(f->local, f->l2c, sizeof f->l2c, 0);
#endif
        if (n > 0) {
            f->l2c_off = 0;
            f->l2c_len = (size_t)n;
            DBG("local->channel %d bytes", (int)n);
        } else if (n == 0) {
            f->local_eof = 1;
        } else if (!SOCK_WOULDBLOCK) {
            f->local_eof = 1;
        }
    }
    while (f->l2c_len > f->l2c_off) {
        ssize_t w = libssh2_channel_write(f->chan, f->l2c + f->l2c_off,
                                          f->l2c_len - f->l2c_off);
        if (w == LIBSSH2_ERROR_EAGAIN) {
            DBG("channel_write EAGAIN (%d bytes pending)",
                (int)(f->l2c_len - f->l2c_off));
            break;
        }
        if (w < 0) {
            DBG("channel_write error %d", (int)w);
            f->local_eof = 1;
            f->l2c_off = f->l2c_len = 0;
            break;
        }
        DBG("wrote %d bytes to channel", (int)w);
        f->l2c_off += (size_t)w;
    }
    /* Fully drained to the channel: free the buffer so the next iteration can
       recv more from the local socket. (Forgetting this reset wedges the
       direction after the first chunk.) */
    if (f->l2c_off == f->l2c_len) {
        f->l2c_off = f->l2c_len = 0;
        if (f->local_eof) {
            libssh2_channel_send_eof(f->chan);
        }
    }

    /* channel -> local: read from the channel, then drain to the local socket. */
    if (f->c2l_len == 0 && !f->chan_eof) {
        ssize_t n = libssh2_channel_read(f->chan, f->c2l, sizeof f->c2l);
        if (n > 0) {
            f->c2l_off = 0;
            f->c2l_len = (size_t)n;
            DBG("channel->local %d bytes", (int)n);
        } else if (n == 0) {
            if (libssh2_channel_eof(f->chan)) {
                f->chan_eof = 1;
            }
        } else if (n != LIBSSH2_ERROR_EAGAIN) {
            DBG("channel read error %d", (int)n);
            f->chan_eof = 1;
        }
    }
    while (f->c2l_len > f->c2l_off) {
#ifdef _WIN32
        int w = send(f->local, f->c2l + f->c2l_off,
                     (int)(f->c2l_len - f->c2l_off), 0);
#else
        ssize_t w = send(f->local, f->c2l + f->c2l_off,
                         f->c2l_len - f->c2l_off, 0);
#endif
        if (w > 0) {
            f->c2l_off += (size_t)w;
        } else if (w < 0 && SOCK_WOULDBLOCK) {
            break;
        } else {
            f->chan_eof = 1; /* local gone */
            f->c2l_len = f->c2l_off = 0;
            break;
        }
    }
    /* Fully drained to the local socket: free the buffer so the next iteration
       reads the next chunk from the channel. */
    if (f->c2l_off == f->c2l_len) {
        f->c2l_off = f->c2l_len = 0;
    }

    /* Done when both directions are drained and closed. */
    if (f->local_eof && f->chan_eof &&
        f->l2c_len == f->l2c_off && f->c2l_len == f->c2l_off) {
        forward_drop(f);
        return 0;
    }
    return 1;
}

static THREAD_FN_RET forward_thread(void *arg)
{
    ssh_tunnel *t = (ssh_tunnel *)arg;
    forward_t *forwards = t->forwards;  /* heap-allocated; thread stacks are small */
    int nfwd = 0;

    while (!t->stop) {
        fd_set rfds, wfds;
        FD_ZERO(&rfds);
        FD_ZERO(&wfds);
        FD_SET(t->listen_sock, &rfds);
        /* Always watch ssh_sock for read; also watch it for write when libssh2
           reports it has outbound work blocked on socket writability — otherwise
           a channel_write stuck on EAGAIN never gets a chance to flush and the
           forward stalls mid-handshake. */
        FD_SET(t->ssh_sock, &rfds);
        if (libssh2_session_block_directions(t->session) &
            LIBSSH2_SESSION_BLOCK_OUTBOUND) {
            FD_SET(t->ssh_sock, &wfds);
        }
        socket_t maxfd =
            t->listen_sock > t->ssh_sock ? t->listen_sock : t->ssh_sock;
        for (int i = 0; i < nfwd; i++) {
            FD_SET(forwards[i].local, &rfds);
            if (forwards[i].c2l_len > forwards[i].c2l_off) {
                FD_SET(forwards[i].local, &wfds);
            }
            if (forwards[i].local > maxfd) {
                maxfd = forwards[i].local;
            }
        }

        struct timeval tv;
        tv.tv_sec = 0;
        tv.tv_usec = 200000; /* 200ms: bounds shutdown latency */
        int sel = select((int)(maxfd + 1), &rfds, &wfds, NULL, &tv);
        if (t->stop) {
            break;
        }
        if (sel < 0) {
#ifndef _WIN32
            if (errno == EINTR) {
                continue;
            }
#endif
            break;
        }

        /* Accept a new local connection and open a channel for it. */
        if (FD_ISSET(t->listen_sock, &rfds) && nfwd < MAX_FORWARDS) {
            socket_t ls = accept(t->listen_sock, NULL, NULL);
            if (ls != BAD_SOCKET) {
                /* Open the channel in blocking mode. A non-blocking open returns
                   EAGAIN until the server's confirmation is read off ssh_sock,
                   which a tight spin here cannot pump — so it would never
                   complete. The target is local to the SSH server, so a blocking
                   open is quick; restore non-blocking for the data pump. */
                DBG("accepted local connection; opening channel to %s:%d",
                    t->target_host, t->target_port);
                libssh2_session_set_blocking(t->session, 1);
                LIBSSH2_CHANNEL *chan = libssh2_channel_direct_tcpip(
                    t->session, t->target_host, t->target_port);
                libssh2_session_set_blocking(t->session, 0);
                if (chan != NULL) {
                    DBG("channel open ok (forward #%d)", nfwd);
                    set_nonblocking(ls);
                    forward_t *f = &forwards[nfwd++];
                    memset(f, 0, sizeof *f);
                    f->local = ls;
                    f->chan = chan;
                } else {
                    DBG("channel open FAILED (errno %d); dropping connection",
                        libssh2_session_last_errno(t->session));
                    close_socket(ls);
                }
            }
        }

        /* Pump every forward; compact out the ones that closed. */
        for (int i = 0; i < nfwd;) {
            if (forward_pump(&forwards[i]) == 0) {
                forwards[i] = forwards[nfwd - 1];
                nfwd--;
            } else {
                i++;
            }
        }
    }

    for (int i = 0; i < nfwd; i++) {
        forward_drop(&forwards[i]);
    }
    THREAD_FN_RETURN;
}

/* ---- public API ----------------------------------------------------------- */

int ssh_tunnel_available(void)
{
    return 1;
}

static void tunnel_free(ssh_tunnel *t)
{
    if (t == NULL) {
        return;
    }
    if (t->session != NULL) {
        libssh2_session_set_blocking(t->session, 1);
        libssh2_session_disconnect(t->session, "quaero tunnel closed");
        libssh2_session_free(t->session);
    }
    if (t->ssh_sock != BAD_SOCKET) {
        close_socket(t->ssh_sock);
    }
    if (t->listen_sock != BAD_SOCKET) {
        close_socket(t->listen_sock);
    }
    free(t->forwards);
    free(t->target_host);
    free(t);
}

dbc_status ssh_tunnel_open(const ssh_config *cfg, ssh_tunnel **out,
                           int *out_local_port, char *err, size_t errcap)
{
    if (out != NULL) {
        *out = NULL;
    }
    if (out_local_port != NULL) {
        *out_local_port = 0;
    }
    if (cfg == NULL || out == NULL || out_local_port == NULL ||
        cfg->host == NULL || cfg->user == NULL || cfg->target_host == NULL) {
        conn_copy_err(err, errcap, "invalid ssh tunnel configuration");
        return DBC_ERR_PARAM;
    }
    if (ensure_global_init() != 0) {
        conn_copy_err(err, errcap, "could not initialize ssh/socket library");
        return DBC_ERR_CONN;
    }

    ssh_tunnel *t = calloc(1, sizeof *t);
    if (t == NULL) {
        conn_copy_err(err, errcap, "out of memory");
        return DBC_ERR_NOMEM;
    }
    t->ssh_sock = BAD_SOCKET;
    t->listen_sock = BAD_SOCKET;
    t->target_port = cfg->target_port;
    t->forwards = calloc(MAX_FORWARDS, sizeof *t->forwards);
    t->target_host = malloc(strlen(cfg->target_host) + 1);
    if (t->forwards == NULL || t->target_host == NULL) {
        tunnel_free(t);
        conn_copy_err(err, errcap, "out of memory");
        return DBC_ERR_NOMEM;
    }
    strcpy(t->target_host, cfg->target_host);

    t->ssh_sock = tcp_connect(cfg->host, cfg->port);
    if (t->ssh_sock == BAD_SOCKET) {
        tunnel_free(t);
        conn_copy_err(err, errcap, "could not reach the SSH server");
        return DBC_ERR_CONN;
    }

    t->session = libssh2_session_init();
    if (t->session == NULL) {
        tunnel_free(t);
        conn_copy_err(err, errcap, "could not create the SSH session");
        return DBC_ERR_CONN;
    }
    DBG("connected to ssh server %s:%d; handshaking", cfg->host, cfg->port);
    libssh2_session_set_blocking(t->session, 1);
    if (libssh2_session_handshake(t->session, t->ssh_sock) != 0) {
        tunnel_free(t);
        conn_copy_err(err, errcap, "SSH handshake failed");
        return DBC_ERR_CONN;
    }

    /* NOTE: host-key verification against a known_hosts store is not yet wired
       up; the first hop is trusted on connect. Tracked as a follow-up. */

    DBG("handshake ok; authenticating user '%s' (auth %d)", cfg->user, cfg->auth);
    if (authenticate(t->session, cfg) != 0) {
        tunnel_free(t);
        conn_copy_err(err, errcap, "SSH authentication failed");
        return DBC_ERR_CONN;
    }

    t->listen_sock = listen_loopback(&t->local_port);
    if (t->listen_sock == BAD_SOCKET) {
        tunnel_free(t);
        conn_copy_err(err, errcap, "could not open the local forward port");
        return DBC_ERR_CONN;
    }
    set_nonblocking(t->listen_sock);
    libssh2_session_set_blocking(t->session, 0);

    if (thread_start(t) != 0) {
        tunnel_free(t);
        conn_copy_err(err, errcap, "could not start the tunnel thread");
        return DBC_ERR_CONN;
    }
    t->thread_started = 1;
    DBG("authenticated; listening on 127.0.0.1:%d, forward thread started",
        t->local_port);

    *out = t;
    *out_local_port = t->local_port;
    return DBC_OK;
}

void ssh_tunnel_close(ssh_tunnel *t)
{
    if (t == NULL) {
        return;
    }
    t->stop = 1;
    if (t->thread_started) {
        thread_join(t);
    }
    tunnel_free(t);
}

#endif /* QUAERO_SSH */
