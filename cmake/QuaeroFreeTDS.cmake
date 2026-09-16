# Download and build FreeTDS's static db-lib and link it into a target — the SQL
# Server driver plugin (issue #49). Enabled with -DQUAERO_FREETDS=ON where no
# system FreeTDS exists or it is too old: the x86 Windows release (Informix forces the
# whole app to x86, and no 32-bit FreeTDS ships) and the Linux .deb (#40).
#
# An ExternalProject, not FetchContent: FreeTDS's CMakeLists reads its own files
# through CMAKE_SOURCE_DIR, so it only configures as a top-level project. It is
# configured with this build's toolchain and only its `db-lib` target is built —
# not its shared libraries, ODBC driver, tools or tests.
#
# Static link => mssql.dll carries db-lib inside it: no DLL to ship and no
# freetds.conf to find — the driver sets everything on the login record.
# TLS (the DSN's `encryption`) comes from the same static OpenSSL the MySQL and
# PostgreSQL plugins use (cmake/QuaeroOpenSSL.cmake).
# License: LGPL-2.0-or-later.

include(ExternalProject)
include(QuaeroOpenSSL)

set(QUAERO_FREETDS_VERSION "1.5.19")
set(QUAERO_FREETDS_SHA256 "ff70d0c8ae8dd23e7b1314274d6e9d30b479998415760b3fa656754b737c2bd6")

function(quaero_enable_freetds target)
  if(WIN32)
    quaero_enable_openssl()
    get_filename_component(_ossl_prefix "${OPENSSL_INCLUDE_DIR}" DIRECTORY)
    set(_ossl_args -DOPENSSL_ROOT_DIR=${_ossl_prefix} -DOPENSSL_USE_STATIC_LIBS=ON)
    # db-lib's Windows dependencies (sockets, SSPI, the crypto API) follow it.
    set(_ossl_link quaero_openssl_ssl ws2_32 secur32 crypt32 advapi32 shell32)
  else()
    # Linux (issue #40): distributions' FreeTDS is often older than the 1.4 the
    # driver needs, but their OpenSSL is fine — a package dependency like every
    # other client library, so it links shared.
    find_package(OpenSSL REQUIRED)
    set(_ossl_args "")
    set(_ossl_link OpenSSL::SSL OpenSSL::Crypto)
  endif()

  set(_src "${CMAKE_BINARY_DIR}/_deps/freetds-src")
  set(_bin "${CMAKE_BINARY_DIR}/_deps/freetds-build")
  # In link order: db-lib uses tds, and both use the two helper libraries.
  set(_libs
    "${_bin}/src/dblib/libdb-lib.a"
    "${_bin}/src/tds/libtds.a"
    "${_bin}/src/utils/libtdsutils.a"
    "${_bin}/src/replacements/libreplacements.a")

  if(NOT TARGET quaero_freetds_build)
    # The toolchain path may be relative to the source tree (it is in CI); the
    # external project configures from elsewhere, so hand it an absolute one.
    set(_toolchain "")
    if(CMAKE_TOOLCHAIN_FILE)
      get_filename_component(_tc "${CMAKE_TOOLCHAIN_FILE}" ABSOLUTE BASE_DIR "${CMAKE_SOURCE_DIR}")
      set(_toolchain "-DCMAKE_TOOLCHAIN_FILE=${_tc}")
    endif()
    ExternalProject_Add(quaero_freetds_build
      URL "https://www.freetds.org/files/stable/freetds-${QUAERO_FREETDS_VERSION}.tar.gz"
      URL_HASH SHA256=${QUAERO_FREETDS_SHA256}
      DOWNLOAD_EXTRACT_TIMESTAMP TRUE
      SOURCE_DIR "${_src}"
      BINARY_DIR "${_bin}"
      CMAKE_ARGS
        ${_toolchain}
        -DCMAKE_BUILD_TYPE=Release
        -DCMAKE_POLICY_VERSION_MINIMUM=3.5
        -DWITH_OPENSSL=ON
        ${_ossl_args}
        # Linked into a plugin, which is a shared object on Linux.
        -DCMAKE_POSITION_INDEPENDENT_CODE=ON
        -DENABLE_ODBC_WIDE=OFF
        -DENABLE_KRB5=OFF
      BUILD_COMMAND ${CMAKE_COMMAND} --build <BINARY_DIR> --target db-lib
      INSTALL_COMMAND ""
      BUILD_BYPRODUCTS ${_libs})
  endif()

  add_dependencies(${target} quaero_freetds_build)
  # Headers: the public ones ship in the source tree, tds_sysdep_public.h is
  # generated into the build tree.
  target_include_directories(${target} SYSTEM PRIVATE "${_src}/include" "${_bin}/include")
  # The FreeTDS libraries twice: replacements calls back into tdsutils
  # (utf8_table, tds_socket_set_nodelay), which comes before it, and a static
  # link only resolves forward — the second pass picks up what the first left. OpenSSL's target last:
  # it carries its own system libraries after it.
  target_link_libraries(${target} PRIVATE ${_libs} ${_libs} ${_ossl_link})
endfunction()
