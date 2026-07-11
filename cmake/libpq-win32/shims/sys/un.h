/* mingw shim: Unix-domain sockets are not used on this build (HAVE_UNIX_SOCKETS
   is off), but PG's pqcomm.h includes <sys/un.h> unconditionally. Provide a
   minimal struct sockaddr_un so the header compiles; it is never used. */
#ifndef QUAERO_SHIM_SYS_UN_H
#define QUAERO_SHIM_SYS_UN_H
#include <winsock2.h>
#ifndef UNIX_PATH_MAX
#define UNIX_PATH_MAX 108
#endif
struct sockaddr_un {
    ADDRESS_FAMILY sun_family;
    char           sun_path[UNIX_PATH_MAX];
};
#endif
