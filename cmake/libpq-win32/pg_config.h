/*
 * pg_config.h — hand-authored for building a minimal static libpq with the
 * 32-bit (i686) winlibs MinGW-w64 / UCRT toolchain, no SSL / GSSAPI / NLS / zlib.
 * Mirrors the values PostgreSQL's configure/meson would compute for that target.
 * Only what the frontend libpq + src/common + src/port subset needs.
 */
#ifndef PG_CONFIG_H
#define PG_CONFIG_H

/* --- version --- */
#define PG_MAJORVERSION "16"
#define PG_MAJORVERSION_NUM 16
#define PG_MINORVERSION_NUM 9
#define PG_VERSION "16.9"
#define PG_VERSION_NUM 160009
#define PG_VERSION_STR "PostgreSQL 16.9 on i686-w64-mingw32, compiled by gcc, 32-bit"
#define PACKAGE_NAME "PostgreSQL"
#define PACKAGE_BUGREPORT "pgsql-bugs@lists.postgresql.org"
#define PACKAGE_STRING "PostgreSQL 16.9"
#define PACKAGE_TARNAME "postgresql"
#define PACKAGE_VERSION "16.9"
#define PACKAGE_URL "https://www.postgresql.org/"
#define CONFIGURE_ARGS " (quaero static libpq, i686 mingw)"

/* --- data sizes / alignment (ILP32 on i686; long long is 64-bit) --- */
#define SIZEOF_VOID_P 4
#define SIZEOF_LONG 4
#define SIZEOF_LONG_LONG 8
#define SIZEOF_SIZE_T 4
#define SIZEOF_BOOL 1
#define ALIGNOF_SHORT 2
#define ALIGNOF_INT 4
#define ALIGNOF_LONG 4
#define ALIGNOF_LONG_LONG_INT 8
#define ALIGNOF_DOUBLE 8
#define MAXIMUM_ALIGNOF 8
#define ALIGNOF_MAX_ALIGN_T 16

#define SIZEOF_DATUM 4
#define MAXALIGN(x) 0 /* placeholder, real one comes from c.h */
#undef MAXALIGN

/* Datum is uintptr_t; 32-bit here. */
#define USE_FLOAT8_BYVAL 0

/* --- integer types --- */
#define HAVE_LONG_LONG_INT 1
#define HAVE_INT_TIMEZONE 1
/* HAVE_INT64 / HAVE_UINT64 left UNDEFINED so c.h defines int64/uint64 itself. */

/* --- endianness --- */
/* i686 is little-endian; WORDS_BIGENDIAN intentionally undefined. */

/* --- block / segment sizes (defaults) --- */
#define BLCKSZ 8192
#define RELSEG_SIZE 131072
#define XLOG_BLCKSZ 8192
#define DEF_PGPORT 5432
#define DEF_PGPORT_STR "5432"
#define PG_KRB_SRVNAM "postgres"

/* --- threading --- */
#define ENABLE_THREAD_SAFETY 1
#define HAVE__CONFIGTHREADLOCALE 1

/* --- CRC: portable slicing-by-8 (no SSE intrinsics needed) --- */
#define USE_SLICING_BY_8_CRC32C 1

/* --- headers present on UCRT MinGW --- */
#define HAVE_CRYPT_H 0
#define HAVE_LOCALE_T 1
#define HAVE_SOCKLEN_T 1
#define HAVE_STRUCT_ADDRINFO 1
#define HAVE_STRUCT_SOCKADDR_STORAGE 1
#define HAVE_STRUCT_SOCKADDR_STORAGE_SS_FAMILY 1
#define HAVE_GETADDRINFO 1
#define HAVE_GETPEEREID 0
#define HAVE_STRUCT_SOCKADDR_UN 1
#define HAVE_UNIX_SOCKETS 0

/* --- library functions available (UCRT) --- */
#define HAVE_MEMSET 1
#define HAVE_STRDUP 1
#define HAVE_STRTOLL 1
#define HAVE_STRTOULL 1
#define HAVE_STRERROR 1
#define HAVE_VSNPRINTF 1
#define HAVE_SNPRINTF 1
#define HAVE_STRINGS_H 0
#define HAVE_STRING_H 1
#define HAVE_STDBOOL_H 1
#define HAVE__BOOL 1
#define HAVE_WCHAR_H 1
#define HAVE_WCTYPE_H 1
#define HAVE_LOCALE_H 1
#define HAVE_UTIME 1
#define HAVE_UTIME_H 1
#define HAVE_GETTIMEOFDAY 1
/* HAVE_INT8 / HAVE_UINT8 / HAVE_INT64 / HAVE_UINT64 intentionally left UNDEFINED
   so c.h emits its own int8/uint8/int64/uint64 typedefs (the guards are #ifndef). */
#define HAVE_LONG_LONG_INT_64 1
#define INT64_MODIFIER "ll"

/* --- string / misc replacements: provided by src/port fallbacks --- */
/* HAVE_STRLCPY / HAVE_STRLCAT / HAVE_STRNLEN left undefined -> use port copies. */
#define HAVE_DECL_STRLCAT 0
#define HAVE_DECL_STRLCPY 0
#define HAVE_DECL_STRNLEN 1

/* --- random source --- */
#define USE_WIN32_RANDOM 1

/* --- misc PG knobs --- */
#define FLEXIBLE_ARRAY_MEMBER /**/
#define PG_USE_STDBOOL 1
#define pg_restrict __restrict
#define MEMSET_LOOP_LIMIT 1024

#define ACCEPT_TYPE_ARG3 int
#define PG_PRINTF_ATTRIBUTE gnu_printf

/* pg_config_ext.h provides PG_INT64_TYPE. */

#endif /* PG_CONFIG_H */
