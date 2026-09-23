# Fetch the PostgreSQL source and build a static libpq from it, then link it into
# a target — the PostgreSQL driver plugin. Enabled with -DQUAERO_LIBPQ=ON when no
# usable system libpq is available, notably the x86 Windows release: no 32-bit
# libpq ships on the build machine. Mirrors cmake/QuaeroMariaDB.cmake.
#
# PostgreSQL has no CMake build, so we cannot add_subdirectory it. Instead we
# download the source and compile the libpq subset (src/interfaces/libpq plus the
# src/common and src/port objects it depends on) into one static library, using a
# hand-authored pg_config.h for the i686 MinGW/UCRT target (cmake/libpq-win32/).
#
# Static link => the plugin (postgres.dll) carries libpq inside it: no libpq.dll
# to ship. TLS comes from OpenSSL (cmake/QuaeroOpenSSL.cmake, issue #144): libpq
# is compiled with USE_OPENSSL, so its TLS, SCRAM hashing and channel binding all
# go through it.

include(FetchContent)
include(QuaeroOpenSSL)

# Captured at include() time — the module's own directory. Inside the function
# CMAKE_CURRENT_LIST_DIR would resolve to the caller's list file.
set(_quaero_libpq_module_dir "${CMAKE_CURRENT_LIST_DIR}")

# iOS (issue #573): the Windows pg_config.h does not fit Darwin, and nobody on
# the project has a Mac to hand-write one. PostgreSQL's own configure writes it,
# run as a cross build against the same compiler and iPhone SDK as the rest; its
# LIBOBJS names the src/port replacements this libc needs. No TLS, zlib, ICU or
# readline there: USE_OPENSSL and its HAVE_* are defined below as on Windows.
function(_quaero_libpq_configure_ios pg gen out_cfg out_libobjs)
  set(_dir "${CMAKE_CURRENT_BINARY_DIR}/libpq-configure")
  set(_log "${_dir}/configure.log")
  if(NOT EXISTS "${_dir}/src/include/pg_config.h")
    file(REMOVE_RECURSE "${_dir}")
    file(MAKE_DIRECTORY "${_dir}")
    if(CMAKE_OSX_SYSROOT MATCHES "[Ss]imulator")
      set(_target "arm64-apple-ios${CMAKE_OSX_DEPLOYMENT_TARGET}-simulator")
    else()
      set(_target "arm64-apple-ios${CMAKE_OSX_DEPLOYMENT_TARGET}")
    endif()
    # PG_SYSROOT: left empty, the darwin template adds the macOS SDK.
    message(STATUS "PostgreSQL driver: configuring libpq for ${_target}")
    execute_process(
      COMMAND sh "${pg}/configure" --host=aarch64-apple-darwin
              --without-readline --without-zlib --without-icu
              "PG_SYSROOT=${CMAKE_OSX_SYSROOT}" "CC=${CMAKE_C_COMPILER}"
              "CFLAGS=-target ${_target} -isysroot ${CMAKE_OSX_SYSROOT}"
              "LDFLAGS=-target ${_target} -isysroot ${CMAKE_OSX_SYSROOT}"
      WORKING_DIRECTORY "${_dir}"
      RESULT_VARIABLE _rc OUTPUT_FILE "${_log}" ERROR_FILE "${_log}")
    if(NOT _rc EQUAL 0 OR NOT EXISTS "${_dir}/src/include/pg_config.h")
      # CI has no log to open afterwards: print the end of it.
      execute_process(COMMAND tail -n 40 "${_log}")
      execute_process(COMMAND tail -n 60 "${_dir}/config.log")
      message(FATAL_ERROR "PostgreSQL configure for iOS failed (${_rc}); see ${_log}")
    endif()
  endif()
  # The same empty install paths as Windows: libpq only reads SYSCONFDIR, and
  # an app has no system-wide pg_service.conf.
  configure_file("${_quaero_libpq_module_dir}/libpq-win32/pg_config_paths.h"
    "${gen}/pg_config_paths.h" COPYONLY)

  file(STRINGS "${_dir}/src/Makefile.global" _line REGEX "^LIBOBJS =")
  string(REGEX REPLACE "^LIBOBJS =[ ]*" "" _line "${_line}")
  string(REPLACE ".o" "" _line "${_line}")
  separate_arguments(_objs UNIX_COMMAND "${_line}")
  message(STATUS "PostgreSQL driver: src/port replacements for iOS: ${_objs}")
  set(${out_cfg} "${_dir}/src/include" PARENT_SCOPE)
  set(${out_libobjs} ${_objs} PARENT_SCOPE)
endfunction()

function(quaero_enable_libpq target)
  # kwlist_d.h is generated from the SQL keyword list by a bundled Perl script.
  find_program(QUAERO_PERL NAMES perl)
  if(NOT QUAERO_PERL)
    message(FATAL_ERROR "QUAERO_LIBPQ=ON requires perl (to generate kwlist_d.h)")
  endif()

  # PostgreSQL 16.9 — matches the hand-authored pg_config.h version stamp.
  FetchContent_Declare(postgres_src
    GIT_REPOSITORY https://github.com/postgres/postgres.git
    GIT_TAG REL_16_9
    GIT_SHALLOW TRUE)
  # Download only — no add_subdirectory (PostgreSQL is not a CMake project).
  FetchContent_GetProperties(postgres_src)
  if(NOT postgres_src_POPULATED)
    message(STATUS "PostgreSQL driver: fetching PostgreSQL source for libpq (QUAERO_LIBPQ=ON)")
    FetchContent_Populate(postgres_src)
  endif()
  set(_pg "${postgres_src_SOURCE_DIR}")

  # Generate kwlist_d.h (used by src/common/keywords.c) into a build dir.
  set(_gen "${CMAKE_CURRENT_BINARY_DIR}/libpq-gen")
  file(MAKE_DIRECTORY "${_gen}")
  add_custom_command(
    OUTPUT "${_gen}/kwlist_d.h"
    COMMAND ${QUAERO_PERL} "${_pg}/src/tools/gen_keywordlist.pl" --extern
            -o "${_gen}" "${_pg}/src/include/parser/kwlist.h"
    DEPENDS "${_pg}/src/include/parser/kwlist.h"
    COMMENT "Generating kwlist_d.h for libpq"
    VERBATIM)

  quaero_enable_openssl()

  # The libpq subset (TLS through OpenSSL's API; no GSSAPI / NLS). These lists are
  # the frontend build of libpq + the src/common and src/port objects it links
  # against; unreferenced objects are dropped by the linker. With OpenSSL,
  # src/common swaps its own hash implementations for the *_openssl ones,
  # exactly as PostgreSQL's meson.build does.
  set(_libpq fe-auth-scram fe-auth fe-connect fe-exec fe-lobj fe-misc fe-print
             fe-protocol3 fe-secure fe-secure-common fe-secure-openssl fe-trace
             legacy-pqsignal libpq-events pqexpbuffer)
  set(_common scram-common saslprep cryptohash_openssl hmac_openssl
              protocol_openssl md5_common base64 encnames wchar string pg_prng ip
              link-canary fe_memutils unicode_norm stringinfo psprintf pg_get_line)
  set(_port snprintf strerror pgsleep noblock path pgstrcasecmp pg_strong_random
            pgstrsignal chklocale inet_net_ntop bsearch_arg pg_bitutils)

  if(IOS)
    _quaero_libpq_configure_ios("${_pg}" "${_gen}" _cfg_dir _libobjs)
    list(APPEND _port thread ${_libobjs})
    set(_cfg_includes "${_cfg_dir}")
    set(_pg_defs "")
    set(_pg_syslibs "")
  else()
    list(APPEND _libpq pthread-win32 win32)
    list(APPEND _port inet_aton pg_crc32c_sb8 open win32stat win32ntdll dirmod
              win32common win32error win32setlocale win32env win32security
              win32dlopen getpeereid strlcpy strlcat strnlen explicit_bzero)
    # Our config headers + socket shims. The shims stand in for POSIX headers
    # this MinGW sysroot lacks (netdb.h/sys/socket.h/...), backed by winsock.
    set(_cfg_dir "${_quaero_libpq_module_dir}/libpq-win32")
    set(_cfg_includes "${_cfg_dir}" "${_cfg_dir}/shims")
    set(_pg_defs WIN32 _WIN32_WINNT=0x0A00)
    set(_pg_syslibs ws2_32 secur32 crypt32 wldap32 shell32 advapi32)
  endif()

  set(_srcs "")
  foreach(f ${_libpq})
    list(APPEND _srcs "${_pg}/src/interfaces/libpq/${f}.c")
  endforeach()
  foreach(f ${_common})
    list(APPEND _srcs "${_pg}/src/common/${f}.c")
  endforeach()
  foreach(f ${_port})
    list(APPEND _srcs "${_pg}/src/port/${f}.c")
  endforeach()

  add_library(quaero_libpq STATIC ${_srcs} "${_gen}/kwlist_d.h")
  # Include order: our config headers first, then generated, then the
  # PostgreSQL headers.
  target_include_directories(quaero_libpq PRIVATE
    ${_cfg_includes}
    "${_gen}"
    "${_pg}/src/include"
    "${_pg}/src/interfaces/libpq"
    "${_pg}/src/port")
  # USE_OPENSSL and the HAVE_* results meson computes by probing the library:
  # OpenSSL 3.0 has every function PostgreSQL 16 checks for except CRYPTO_lock,
  # which was removed in 1.1.0 and must stay undefined.
  target_compile_definitions(quaero_libpq PRIVATE
    FRONTEND SO_MAJOR_VERSION=5 ${_pg_defs}
    USE_OPENSSL=1 OPENSSL_API_COMPAT=0x10001000L
    HAVE_X509_GET_SIGNATURE_NID=1 HAVE_SSL_CTX_SET_CERT_CB=1
    HAVE_OPENSSL_INIT_SSL=1 HAVE_BIO_METH_NEW=1 HAVE_ASN1_STRING_GET0_DATA=1
    HAVE_HMAC_CTX_NEW=1 HAVE_HMAC_CTX_FREE=1 HAVE_X509_GET_SIGNATURE_INFO=1
    HAVE_SSL_CTX_SET_NUM_TICKETS=1)
  # Third-party code: keep it out of the strict -Werror policy and quiet its own
  # warnings. -std=gnu11 overrides the project's strict -std=c11: PostgreSQL's
  # Windows port files rely on GNU/Win32 extensions that __STRICT_ANSI__ hides
  # (e.g. the PUTENVPROC typedef in win32env.c). -fwrapv/-fno-strict-aliasing
  # match PostgreSQL's own build expectations.
  target_compile_options(quaero_libpq PRIVATE
    -w -std=gnu11 -fno-strict-aliasing -fwrapv)

  # Expose libpq to the driver. Only the config dir (pg_config_ext.h, pulled in by
  # libpq-fe.h) and the libpq source dir (libpq-fe.h / postgres_ext.h) are needed —
  # not the socket shims. System libraries the static client references.
  target_link_libraries(quaero_libpq PRIVATE quaero_openssl_ssl ${_pg_syslibs})
  target_include_directories(${target} SYSTEM PRIVATE
    "${_pg}/src/interfaces/libpq"
    "${_pg}/src/include"
    "${_cfg_dir}")
  target_link_libraries(${target} PRIVATE quaero_libpq quaero_openssl_ssl ${_pg_syslibs})
endfunction()
