# Informix driver.
#
# The driver reaches Informix through the ODBC Driver Manager: it links the
# system ODBC library (odbc32 on Windows, unixODBC's libodbc elsewhere) and
# selects the registered "IBM INFORMIX ODBC DRIVER" at runtime via the
# connection string. No proprietary IBM CSDK library is linked, so the plugin
# builds wherever ODBC dev files are present. The CSDK itself is 32-bit on the
# target machine — see cmake/toolchain-i686-mingw.cmake — so Quaero is built x86.
#
# The pure helpers (native + ODBC type mapping, connection-string builder) never
# depend on ODBC and are always built and unit-tested, so a checkout without ODBC
# still configures and builds green.

# --- pure unit tests (always) ---------------------------------------------
if(BUILD_TESTING)
  add_executable(informix_types_test
    tests/types_test.c
    src/utils/types.c)
  target_include_directories(informix_types_test PRIVATE
    src/utils ${CMAKE_SOURCE_DIR}/core/include)
  quaero_set_warnings(informix_types_test)
  add_test(NAME informix_types_test COMMAND informix_types_test)

  add_executable(informix_odbc_types_test
    tests/odbc_types_test.c
    src/utils/odbc_types.c)
  target_include_directories(informix_odbc_types_test PRIVATE
    src/utils ${CMAKE_SOURCE_DIR}/core/include)
  quaero_set_warnings(informix_odbc_types_test)
  add_test(NAME informix_odbc_types_test COMMAND informix_odbc_types_test)

  add_executable(informix_connstr_test
    tests/connstr_test.c
    src/utils/connstr.c)
  target_include_directories(informix_connstr_test PRIVATE src/utils)
  quaero_set_warnings(informix_connstr_test)
  add_test(NAME informix_connstr_test COMMAND informix_connstr_test)

  add_executable(informix_dml_test
    tests/dml_test.c
    src/utils/dml.c)
  target_include_directories(informix_dml_test PRIVATE
    src/utils ${CMAKE_SOURCE_DIR}/core/include)
  quaero_set_warnings(informix_dml_test)
  add_test(NAME informix_dml_test COMMAND informix_dml_test)
endif()

# --- driver plugin (only when ODBC dev files are present) -----------------
if(WIN32)
  # The Windows ODBC Driver Manager (odbc32) ships with the OS/SDK and its
  # import library with the toolchain; the linker resolves it via -lodbc32, so
  # link it by name rather than probing with find_library. sql.h/sqlext.h come
  # with the toolchain too.
  set(ODBC_LIBRARY odbc32)
  set(ODBC_HEADER_OK TRUE)
else()
  find_path(ODBC_INCLUDE_DIR NAMES sql.h)
  find_library(ODBC_LIBRARY NAMES odbc unixodbc)
  set(ODBC_HEADER_OK ${ODBC_INCLUDE_DIR})
endif()

if(ODBC_LIBRARY AND ODBC_HEADER_OK)
  message(STATUS "Informix driver: using ODBC (${ODBC_LIBRARY})")
  add_library(informix_driver MODULE
    src/entry.c
    src/connection.c
    src/query.c
    src/metadata.c
    src/edit.c
    src/utils/types.c
    src/utils/odbc_types.c
    src/utils/connstr.c
    src/utils/dml.c)
  target_include_directories(informix_driver PRIVATE
    src ${CMAKE_SOURCE_DIR}/core/include)
  if(NOT WIN32 AND ODBC_INCLUDE_DIR)
    target_include_directories(informix_driver SYSTEM PRIVATE ${ODBC_INCLUDE_DIR})
  endif()
  # cjson supplies cJSON.h (DSN parsing), exactly as the other drivers do.
  target_link_libraries(informix_driver PRIVATE ${ODBC_LIBRARY} cjson)
  set_target_properties(informix_driver PROPERTIES PREFIX "" OUTPUT_NAME "informix")
  quaero_set_warnings(informix_driver)
else()
  message(STATUS "Informix driver: ODBC not found; plugin not built")
endif()
