# Fetch libtdswire and build the SQL Server driver on it instead of FreeTDS
# (issue #584). libtdswire is our own TDS 7.4 client in C
# (github.com/danielnuld/libtdswire, Apache-2.0); FreeTDS is LGPL and cannot ship
# in the App Store, so iOS takes this one (QUAERO_TDSWIRE, ON there by default).
# The driver swaps connection.c and query.c for tw_connection.c and tw_query.c.
#
# OpenSSL carries TDS encryption, which even the login needs: iOS and the
# Windows release build the static one of cmake/QuaeroOpenSSL.cmake, as libdrda
# does; elsewhere the system's.

include(FetchContent)

set(QUAERO_LIBTDSWIRE_VERSION "0.1.0")
set(QUAERO_LIBTDSWIRE_SHA256 "8b7ad48b12a50020100035a489a9d18cc2c641e262340db72d1ea0c7a0d3a2f9")

function(quaero_enable_libtdswire target)
  if(NOT TARGET tdswire)
    if(IOS OR (WIN32 AND (QUAERO_LIBPQ OR QUAERO_MARIADB OR QUAERO_FREETDS)))
      include(QuaeroOpenSSL)
      quaero_enable_openssl()
      get_filename_component(OPENSSL_ROOT_DIR "${OPENSSL_INCLUDE_DIR}" DIRECTORY)
      set(OPENSSL_USE_STATIC_LIBS ON)
    endif()
    set(TW_BUILD_TESTS OFF)
    set(TW_WERROR OFF)
    FetchContent_Declare(libtdswire
      URL "https://github.com/danielnuld/libtdswire/archive/refs/tags/v${QUAERO_LIBTDSWIRE_VERSION}.tar.gz"
      URL_HASH SHA256=${QUAERO_LIBTDSWIRE_SHA256}
      DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
    FetchContent_MakeAvailable(libtdswire)
    # Linked into a plugin, which is a shared object on Linux.
    set_target_properties(tdswire PROPERTIES POSITION_INDEPENDENT_CODE ON)
    message(STATUS "SQL Server driver: libtdswire ${QUAERO_LIBTDSWIRE_VERSION} (QUAERO_TDSWIRE=ON)")
  endif()
  target_compile_definitions(${target} PRIVATE QUAERO_MSSQL_TDSWIRE)
  target_link_libraries(${target} PRIVATE tdswire)
endfunction()
