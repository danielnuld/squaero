# Fetch libdrda and link it into a target — the Informix driver plugin (issue
# #557). libdrda is a native DRDA client in C (github.com/danielnuld/libdrda,
# Apache-2.0): it reaches Informix's drsoctcp/drsocssl listener directly, so no
# IBM Client SDK is needed at build or run time, on any platform.
#
# A plain CMake project, so FetchContent (unlike FreeTDS): only its static
# library is built, not its tool or tests. Linked statically, the plugin
# carries it inside.
#
# TLS: the x86 Windows release already builds a static OpenSSL for MySQL,
# PostgreSQL and SQL Server (cmake/QuaeroOpenSSL.cmake) and libdrda reuses it.
# Elsewhere the system OpenSSL is used when present; without one libdrda builds
# without TLS, refuses every TLS mode, and the driver does not advertise
# DBC_FEAT_SSL (QUAERO_DRDA_TLS).

include(FetchContent)

set(QUAERO_LIBDRDA_VERSION "0.2.0")
set(QUAERO_LIBDRDA_SHA256 "98884969641f4df56f110716da89a45fb878c6960a7cf278bb6b2f2e9a9d8f83")

function(quaero_enable_libdrda target)
  if(NOT TARGET drda)
    if(WIN32 AND (QUAERO_LIBPQ OR QUAERO_MARIADB OR QUAERO_FREETDS))
      include(QuaeroOpenSSL)
      quaero_enable_openssl()
      get_filename_component(OPENSSL_ROOT_DIR "${OPENSSL_INCLUDE_DIR}" DIRECTORY)
      set(OPENSSL_USE_STATIC_LIBS ON)
      set(DRDA_WITH_OPENSSL ON)
    else()
      find_package(OpenSSL 1.1.1 QUIET)
      set(DRDA_WITH_OPENSSL ${OPENSSL_FOUND})
    endif()
    set(DRDA_BUILD_TOOLS OFF)
    set(DRDA_BUILD_TESTS OFF)
    set(DRDA_WERROR OFF)
    FetchContent_Declare(libdrda
      URL "https://github.com/danielnuld/libdrda/archive/refs/tags/v${QUAERO_LIBDRDA_VERSION}.tar.gz"
      URL_HASH SHA256=${QUAERO_LIBDRDA_SHA256}
      DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
    FetchContent_MakeAvailable(libdrda)
    # Linked into a plugin, which is a shared object on Linux.
    set_target_properties(drda PROPERTIES POSITION_INDEPENDENT_CODE ON)
    set(QUAERO_DRDA_TLS ${DRDA_WITH_OPENSSL} CACHE INTERNAL "libdrda was built with TLS")
    if(DRDA_WITH_OPENSSL)
      message(STATUS "Informix driver: libdrda ${QUAERO_LIBDRDA_VERSION} with TLS")
    else()
      message(STATUS "Informix driver: libdrda ${QUAERO_LIBDRDA_VERSION} WITHOUT TLS (no OpenSSL)")
    endif()
  endif()
  target_link_libraries(${target} PRIVATE drda)
  if(QUAERO_DRDA_TLS)
    target_compile_definitions(${target} PRIVATE QUAERO_IFX_TLS)
  endif()
endfunction()
