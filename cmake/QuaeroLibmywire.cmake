# Fetch libmywire and build the MySQL driver on it instead of MariaDB Connector/C
# (issue #583). libmywire is our own MySQL/MariaDB protocol client in C
# (github.com/danielnuld/libmywire, Apache-2.0); the LGPL connector cannot ship
# in the App Store, so iOS takes this one (QUAERO_MYWIRE, ON there by default).
# drivers/mysql/mywire/mysql.h gives the driver the slice of the client API it
# uses, so its sources are the same on both.
#
# OpenSSL is required (both password plugins hash, and caching_sha2_password
# needs RSA or TLS): iOS and the Windows release build the static one of
# cmake/QuaeroOpenSSL.cmake, as libdrda does; elsewhere the system's.

include(FetchContent)

set(QUAERO_LIBMYWIRE_VERSION "0.1.0")
set(QUAERO_LIBMYWIRE_SHA256 "574d7bcdeedc9ce000ef280f9514cceed12830fd006fcf5db9bf08aa9a8792ef")

function(quaero_enable_libmywire target)
  if(NOT TARGET mywire)
    if(IOS OR (WIN32 AND (QUAERO_LIBPQ OR QUAERO_MARIADB OR QUAERO_FREETDS)))
      include(QuaeroOpenSSL)
      quaero_enable_openssl()
      get_filename_component(OPENSSL_ROOT_DIR "${OPENSSL_INCLUDE_DIR}" DIRECTORY)
      set(OPENSSL_USE_STATIC_LIBS ON)
    endif()
    set(MW_BUILD_TESTS OFF)
    set(MW_WERROR OFF)
    FetchContent_Declare(libmywire
      URL "https://github.com/danielnuld/libmywire/archive/refs/tags/v${QUAERO_LIBMYWIRE_VERSION}.tar.gz"
      URL_HASH SHA256=${QUAERO_LIBMYWIRE_SHA256}
      DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
    FetchContent_MakeAvailable(libmywire)
    # Linked into a plugin, which is a shared object on Linux.
    set_target_properties(mywire PROPERTIES POSITION_INDEPENDENT_CODE ON)
    message(STATUS "MySQL driver: libmywire ${QUAERO_LIBMYWIRE_VERSION} (QUAERO_MYWIRE=ON)")
  endif()
  target_sources(${target} PRIVATE ${CMAKE_SOURCE_DIR}/drivers/mysql/mywire/mysql_mywire.c)
  target_include_directories(${target} PRIVATE ${CMAKE_SOURCE_DIR}/drivers/mysql/mywire)
  target_link_libraries(${target} PRIVATE mywire)
endfunction()
