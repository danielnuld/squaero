# Fetch and build MariaDB Connector/C (static) and link it into a target — the
# MySQL/MariaDB driver plugin. Enabled with -DQUAERO_MARIADB=ON when no system
# client library is available, notably the x86 Windows release: no 32-bit MySQL
# client ships on the build machine, and Informix forces the whole app to x86
# (its ODBC driver is 32-bit only). Mirrors cmake/QuaeroMongoc.cmake.
#
# Static link => the plugin (mysql.dll) carries the client and its auth plugins
# (mysql_native_password is compiled in) inside it: no libmariadb.dll to ship
# and no external plugin directory to locate. TLS is OFF — the connector's
# Secure Channel backend needs wincrypt constants absent from the i686 MinGW
# headers, and Quaero's saved connections do not request TLS.
#
# The connector needs a one-line source patch on 32-bit (STDCALL on the
# mysql_load_plugin declaration); see cmake/patches/mariadb-connector-c-stdcall.cmake.

include(FetchContent)

# Captured at include() time — the module's own directory. Inside the function
# below, CMAKE_CURRENT_LIST_DIR would resolve to the *caller's* list file (the
# MySQL driver), so we cannot rely on it for locating the patch script.
set(_quaero_mariadb_module_dir "${CMAKE_CURRENT_LIST_DIR}")

function(quaero_enable_mariadb target)
  set(_saved_build_testing "${BUILD_TESTING}")

  # Steer the connector's build. Static only; no tests, no libcurl.
  set(WITH_UNIT_TESTS OFF CACHE BOOL "" FORCE)
  set(WITH_CURL OFF CACHE BOOL "" FORCE)
  set(WITH_SSL OFF CACHE STRING "" FORCE)
  set(BUILD_TESTING OFF CACHE BOOL "" FORCE)

  # Built as a subproject, the connector skips its install-dir setup, leaving
  # INSTALL_PLUGINDIR empty — its INSTALL(TARGETS) rules for the dynamic auth
  # plugins then error at configure ("no LIBRARY DESTINATION"). We never install
  # it (mariadbclient is linked statically), but the rules are still evaluated,
  # so give them non-empty destinations to satisfy CMake.
  set(INSTALL_PLUGINDIR "lib/mariadb/plugin" CACHE STRING "" FORCE)
  set(INSTALL_LIBDIR "lib" CACHE STRING "" FORCE)
  set(INSTALL_INCLUDEDIR "include" CACHE STRING "" FORCE)
  set(INSTALL_BINDIR "bin" CACHE STRING "" FORCE)

  if(WIN32)
    # windows.h declares CancelIoEx (used by the socket pvio) as WINAPI only when
    # _WIN32_WINNT >= Vista; without it GCC emits an undecorated symbol the
    # kernel32 import library cannot satisfy. This normal variable is scoped to
    # the fetched subdirectory added below, not our own (already-defined) targets.
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -D_WIN32_WINNT=0x0601")
  endif()

  FetchContent_Declare(mariadb_connector
    GIT_REPOSITORY https://github.com/mariadb-corporation/mariadb-connector-c.git
    GIT_TAG v3.3.13
    GIT_SHALLOW TRUE
    PATCH_COMMAND ${CMAKE_COMMAND}
      -DMARIADB_SRC=<SOURCE_DIR>
      -P "${_quaero_mariadb_module_dir}/patches/mariadb-connector-c-stdcall.cmake")
  FetchContent_MakeAvailable(mariadb_connector)

  # Restore BUILD_TESTING so our own test tree is still configured.
  set(BUILD_TESTING "${_saved_build_testing}" CACHE BOOL "" FORCE)

  # Connector headers are third-party: include them as SYSTEM so they are not
  # subject to our strict -Werror policy. Both the checked-in headers and the
  # generated ones (mariadb_version.h, ma_config.h) are required.
  target_include_directories(${target} SYSTEM PRIVATE
    "${mariadb_connector_SOURCE_DIR}/include"
    "${mariadb_connector_BINARY_DIR}/include")
  target_link_libraries(${target} PRIVATE mariadbclient)
  if(WIN32)
    # System libraries the static client references (sockets, registry, path).
    target_link_libraries(${target} PRIVATE ws2_32 shlwapi crypt32 secur32 advapi32)
  endif()
endfunction()
