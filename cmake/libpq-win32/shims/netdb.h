/* mingw shim: winsock (already pulled in by win32_port.h) provides the
   name-resolution API (getaddrinfo/getnameinfo/struct addrinfo/hostent). */
#ifndef QUAERO_SHIM_NETDB_H
#define QUAERO_SHIM_NETDB_H
#include <winsock2.h>
#include <ws2tcpip.h>
#endif
