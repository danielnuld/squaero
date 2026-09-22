# Informix driver, over DRDA (issue #557).
#
# The plugin talks to the server's DRDA listener (sqlhosts protocol drsoctcp, or
# drsocssl for TLS) through libdrda, fetched and linked statically by
# cmake/QuaeroLibdrda.cmake. No IBM Client SDK and no ODBC are involved, so the
# plugin builds on every platform and toolchain, x64 included.
#
# The pure helpers (DSN parsing, DRDA and native type mapping, transaction
# statements, DML builder) are unit-tested on their own, without a server.

include(QuaeroLibdrda)

# --- pure unit tests --------------------------------------------------------
if(BUILD_TESTING)
  add_executable(informix_types_test
    tests/types_test.c
    src/utils/types.c)
  target_include_directories(informix_types_test PRIVATE
    src/utils ${CMAKE_SOURCE_DIR}/core/include)
  quaero_set_warnings(informix_types_test)
  add_test(NAME informix_types_test COMMAND informix_types_test)

  add_executable(informix_drda_types_test
    tests/drda_types_test.c
    src/utils/drda_types.c)
  target_include_directories(informix_drda_types_test PRIVATE
    src/utils ${CMAKE_SOURCE_DIR}/core/include)
  quaero_set_warnings(informix_drda_types_test)
  add_test(NAME informix_drda_types_test COMMAND informix_drda_types_test)

  add_executable(informix_dsn_test
    tests/dsn_test.c
    src/utils/dsn.c)
  target_include_directories(informix_dsn_test PRIVATE src/utils)
  target_link_libraries(informix_dsn_test PRIVATE cjson)
  quaero_set_warnings(informix_dsn_test)
  add_test(NAME informix_dsn_test COMMAND informix_dsn_test)

  add_executable(informix_txsql_test
    tests/txsql_test.c
    src/utils/txsql.c)
  target_include_directories(informix_txsql_test PRIVATE src/utils)
  quaero_set_warnings(informix_txsql_test)
  add_test(NAME informix_txsql_test COMMAND informix_txsql_test)

  add_executable(informix_dml_test
    tests/dml_test.c
    src/utils/dml.c)
  target_include_directories(informix_dml_test PRIVATE
    src/utils ${CMAKE_SOURCE_DIR}/core/include)
  quaero_set_warnings(informix_dml_test)
  add_test(NAME informix_dml_test COMMAND informix_dml_test)
endif()

# --- driver plugin ------------------------------------------------------------
set(INFORMIX_DRIVER_SOURCES
  src/entry.c
  src/connection.c
  src/query.c
  src/metadata.c
  src/ddl.c
  src/edit.c
  src/utils/types.c
  src/utils/drda_types.c
  src/utils/dsn.c
  src/utils/txsql.c
  src/utils/dml.c)

add_library(informix_driver MODULE ${INFORMIX_DRIVER_SOURCES})
target_include_directories(informix_driver PRIVATE src ${CMAKE_SOURCE_DIR}/core/include)
# cjson supplies cJSON.h (DSN parsing), exactly as the other drivers do.
target_link_libraries(informix_driver PRIVATE cjson)
quaero_enable_libdrda(informix_driver)
# The cancel path guards the connection with a mutex; on POSIX that is a
# pthread mutex, so link the threads library there (a no-op on Windows).
find_package(Threads REQUIRED)
target_link_libraries(informix_driver PRIVATE Threads::Threads)
set_target_properties(informix_driver PROPERTIES PREFIX "" OUTPUT_NAME "informix")
quaero_set_warnings(informix_driver)

# Cancel wiring (contract + idle behavior), without a server: compiles the
# driver sources directly so dbc_driver_entry stays defined.
if(BUILD_TESTING)
  add_executable(informix_cancel_test tests/cancel_test.c ${INFORMIX_DRIVER_SOURCES})
  target_include_directories(informix_cancel_test PRIVATE src ${CMAKE_SOURCE_DIR}/core/include)
  target_link_libraries(informix_cancel_test PRIVATE cjson Threads::Threads)
  quaero_enable_libdrda(informix_cancel_test)
  quaero_set_warnings(informix_cancel_test)
  add_test(NAME informix_cancel_test COMMAND informix_cancel_test)
endif()
